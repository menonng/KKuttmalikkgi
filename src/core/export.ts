/**
 * 내보내기 파이프라인.
 *
 * 산출물:
 *  - dictionary.json        게임이 읽는 최종 사전(엔트리 배열)
 *  - dictionary.index.json  첫/끝 글자 인덱스 + 두음법칙 매핑
 *  - manifest.json          빌드 메타데이터(체크섬 포함)
 *  - rejects.jsonl          검증 탈락 표본(데이터 품질 점검용)
 *  - dictionary.sqlite      (선택) 10만+ 규모에서의 서버측 조회용
 *
 * dictionary.json 은 엔트리를 한 줄에 하나씩 써서 10만 건에서도
 * git diff 가 읽히고 스트리밍 파싱이 가능하도록 한다.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BuildManifest, BuildStats, DictionaryEntry, RejectedEntry } from './types.js';
import { chainHeads } from './hangul.js';
import type { Logger } from './logger.js';

export const SCHEMA_VERSION = 1;

export interface ExportOptions {
  distDir: string;
  logger: Logger;
  /** node:sqlite 가 쓸 수 있으면 SQLite 도 만든다. */
  sqlite?: boolean;
  /** rejects.jsonl 에 남길 최대 표본 수. */
  maxRejectSamples?: number;
}

export interface DictionaryIndex {
  schemaVersion: number;
  count: number;
  /** 첫 글자 -> dictionary.json 상의 인덱스 배열. */
  byFirst: Record<string, number[]>;
  /** 끝 글자 -> dictionary.json 상의 인덱스 배열. */
  byLast: Record<string, number[]>;
  /** 끝 글자 -> 다음 단어가 시작할 수 있는 글자들(두음법칙 포함). */
  chainHeads: Record<string, string[]>;
}

/** dictionary.json 을 스트리밍으로 쓰고 sha256 을 돌려준다. */
export async function writeDictionary(
  file: string,
  entries: DictionaryEntry[],
): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  const hash = createHash('sha256');
  const stream = createWriteStream(file, 'utf8');

  const push = async (chunk: string): Promise<void> => {
    hash.update(chunk);
    if (!stream.write(chunk)) {
      await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
    }
  };

  await push('[\n');
  for (let i = 0; i < entries.length; i += 1) {
    const suffix = i === entries.length - 1 ? '\n' : ',\n';
    await push(`  ${JSON.stringify(entries[i])}${suffix}`);
  }
  await push(']\n');

  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error) => (error ? reject(error) : resolve()));
  });
  return hash.digest('hex');
}

/** 첫/끝 글자 인덱스를 만든다. 게임 서버는 이걸로 O(1) 후보 조회를 한다. */
export function buildIndex(entries: DictionaryEntry[]): DictionaryIndex {
  const byFirst: Record<string, number[]> = {};
  const byLast: Record<string, number[]> = {};
  const heads: Record<string, string[]> = {};

  entries.forEach((entry, index) => {
    (byFirst[entry.first] ??= []).push(index);
    (byLast[entry.last] ??= []).push(index);
    if (!heads[entry.last]) heads[entry.last] = chainHeads(entry.last);
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    count: entries.length,
    byFirst,
    byLast,
    chainHeads: heads,
  };
}

/** 전체 산출물을 쓴다. */
export async function exportAll(
  entries: DictionaryEntry[],
  stats: BuildStats,
  rejects: RejectedEntry[],
  options: ExportOptions,
): Promise<BuildManifest> {
  const { distDir, logger } = options;
  await mkdir(distDir, { recursive: true });

  const dictionaryFile = path.join(distDir, 'dictionary.json');
  const checksum = await writeDictionary(dictionaryFile, entries);
  logger.info(`사전 저장: ${dictionaryFile} (${entries.length.toLocaleString('ko-KR')}건)`);

  const index = buildIndex(entries);
  await writeFile(
    path.join(distDir, 'dictionary.index.json'),
    `${JSON.stringify(index)}\n`,
    'utf8',
  );

  const sampleLimit = options.maxRejectSamples ?? 2_000;
  await writeFile(
    path.join(distDir, 'rejects.jsonl'),
    rejects
      .slice(0, sampleLimit)
      .map((item) => JSON.stringify(item))
      .join('\n')
      .concat(rejects.length > 0 ? '\n' : ''),
    'utf8',
  );

  const manifest: BuildManifest = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    checksum,
    entryCount: entries.length,
    sources: Object.keys(stats.perSource),
    stats,
  };
  await writeFile(
    path.join(distDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  if (options.sqlite) {
    await exportSqlite(path.join(distDir, 'dictionary.sqlite'), entries, logger);
  }

  return manifest;
}

/**
 * SQLite 내보내기(선택). node:sqlite 는 아직 실험적이라
 * 사용할 수 없는 런타임에서는 경고만 남기고 건너뛴다.
 */
export async function exportSqlite(
  file: string,
  entries: DictionaryEntry[],
  logger: Logger,
): Promise<boolean> {
  let DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): unknown };
    close(): void;
  };

  try {
    ({ DatabaseSync } = (await import('node:sqlite')) as never);
  } catch {
    logger.warn('node:sqlite 를 쓸 수 없어 SQLite 내보내기를 건너뜁니다 (Node 22+ --experimental-sqlite)');
    return false;
  }

  const { rm } = await import('node:fs/promises');
  await rm(file, { force: true });

  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE words (
      word TEXT PRIMARY KEY,
      normalized TEXT NOT NULL,
      first TEXT NOT NULL,
      last TEXT NOT NULL,
      lore TEXT NOT NULL,
      sources TEXT NOT NULL
    );
    CREATE INDEX idx_words_first ON words(first);
    CREATE INDEX idx_words_last ON words(last);
  `);

  db.exec('BEGIN');
  const insert = db.prepare(
    'INSERT OR REPLACE INTO words (word, normalized, first, last, lore, sources) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const entry of entries) {
    insert.run(
      entry.word,
      entry.normalized,
      entry.first,
      entry.last,
      entry.lore,
      entry.sources.join(','),
    );
  }
  db.exec('COMMIT');
  db.close();

  logger.info(`SQLite 저장: ${file}`);
  return true;
}
