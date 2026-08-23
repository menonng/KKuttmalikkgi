/**
 * 시드 파일 기반 소스.
 *
 * 시드는 "손으로 관리하는 최소한의 기준 데이터"다.
 * 큰 사전을 사람이 적는 게 아니라, 자동 수집이 놓치기 쉬운 항목과
 * 오프라인 빌드용 기준선을 담는 용도로만 쓴다.
 *
 * YAML 형식:
 *   source: genshin
 *   lore: 원신
 *   entries:
 *     - 벤티
 *     - word: 모락스
 *       aliases: [종려]
 *       tags: [character]
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RawEntry } from '../core/types.js';
import type { DictionarySource, SourceContext } from './types.js';

export interface SeedEntry {
  word: string;
  lore?: string;
  aliases?: string[];
  tags?: string[];
}

export interface SeedFile {
  /** 문서용 필드. 실제 소스 id 는 소스 클래스가 정한다. */
  source?: string;
  /** 이 파일 전체의 기본 lore. */
  lore?: string;
  entries: Array<string | SeedEntry>;
}

export interface SeedSourceOptions {
  name: string;
  label: string;
  defaultLore?: string;
  defaultPriority: number;
  /** 시드 파일 이름(확장자 포함). 기본값은 `${name}.yaml`. */
  seedFile?: string;
}

/** 시드 디렉터리에서 파일을 찾는다. .yaml / .yml / .json 을 지원한다. */
export function resolveSeedPath(seedDir: string, fileName: string): string | null {
  const direct = path.resolve(seedDir, fileName);
  if (existsSync(direct)) return direct;

  const base = fileName.replace(/\.(ya?ml|json)$/u, '');
  for (const ext of ['.yaml', '.yml', '.json']) {
    const candidate = path.resolve(seedDir, base + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function readSeedFile(file: string): Promise<SeedFile> {
  const text = await readFile(file, 'utf8');
  const data = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as SeedFile | null;
  if (!data || !Array.isArray(data.entries)) {
    throw new Error(`시드 파일 형식 오류(entries 배열 필요): ${file}`);
  }
  return data;
}

/** 시드 항목 하나를 RawEntry 로 편다. 별칭은 각각 독립 엔트리가 된다. */
export function* expandSeedEntry(
  entry: string | SeedEntry,
  source: string,
  fallbackLore?: string,
): Generator<RawEntry> {
  const normalized: SeedEntry = typeof entry === 'string' ? { word: entry } : entry;
  if (!normalized?.word) return;

  const lore = normalized.lore ?? fallbackLore;
  const base = { source, ...(lore ? { lore } : {}), ...(normalized.tags ? { tags: normalized.tags } : {}) };

  yield { ...base, word: normalized.word };
  for (const alias of normalized.aliases ?? []) {
    yield { ...base, word: alias, extra: { aliasOf: normalized.word } };
  }
}

export class SeedSource implements DictionarySource {
  readonly name: string;
  readonly label: string;
  readonly defaultLore?: string;
  readonly defaultPriority: number;
  protected readonly seedFile: string;

  constructor(options: SeedSourceOptions) {
    this.name = options.name;
    this.label = options.label;
    this.defaultPriority = options.defaultPriority;
    this.seedFile = options.seedFile ?? `${options.name}.yaml`;
    if (options.defaultLore !== undefined) this.defaultLore = options.defaultLore;
  }

  /** 이 소스가 읽을 시드 파일 목록. 설정으로 여러 개를 지정할 수 있다. */
  protected seedFiles(ctx: SourceContext): string[] {
    const configured = ctx.option<string[]>('seedFiles', [this.seedFile]);
    return configured
      .map((file) => resolveSeedPath(ctx.config.paths.seeds, file))
      .filter((file): file is string => file !== null);
  }

  async fingerprint(ctx: SourceContext): Promise<string> {
    const hash = createHash('sha1');
    hash.update(this.name);
    for (const file of this.seedFiles(ctx)) {
      hash.update(file);
      hash.update(await readFile(file));
    }
    return hash.digest('hex');
  }

  async *collect(ctx: SourceContext): AsyncIterable<RawEntry> {
    const files = this.seedFiles(ctx);
    if (files.length === 0) {
      ctx.logger.warn(`${this.name}: 시드 파일을 찾지 못했습니다 (${this.seedFile})`);
      return;
    }

    for (const file of files) {
      const seed = await readSeedFile(file);
      const fallbackLore = seed.lore ?? ctx.sourceConfig.lore ?? this.defaultLore;
      for (const entry of seed.entries) {
        yield* expandSeedEntry(entry, this.name, fallbackLore);
      }
    }
  }
}
