#!/usr/bin/env node
/**
 * Dictionary Builder CLI.
 *
 *   dictbuild build [--online] [--incremental] [--sqlite] [--dry-run] [--only genshin,custom]
 *   dictbuild sources
 *   dictbuild stats
 *   dictbuild lookup 벤티
 *   dictbuild chain 벤티 티라미수
 *   dictbuild add 슈퍼노바 --lore "사용자 추가"
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from './core/pipeline.js';
import { loadConfig, sourceConfigOf } from './core/config.js';
import { Logger, type LogLevel } from './core/logger.js';
import { DictionaryStore } from './core/store.js';
import { registerBuiltinSources } from './sources/index.js';
import { allSources } from './sources/registry.js';
import { appendCustomEntry } from './sources/custom.js';
import type { BuildManifest } from './core/types.js';

const USAGE = `
끝말잇기 사전 빌더

사용법:
  dictbuild build [옵션]      사전을 빌드해 data/dist 에 내보냅니다
  dictbuild sources           등록된 소스 목록을 봅니다
  dictbuild stats             마지막 빌드 요약을 봅니다
  dictbuild lookup <단어>     단어를 조회합니다
  dictbuild chain <앞> <뒤>   끝말잇기 연결 가능 여부를 확인합니다
  dictbuild add <단어>        사용자 정의 사전에 단어를 추가합니다

build 옵션:
  --online          네트워크 수집을 켭니다(기본: 시드/캐시만)
  --incremental     지문이 같은 소스는 이전 수집 결과를 재사용합니다
  --sqlite          dictionary.sqlite 도 함께 만듭니다
  --dry-run         파일을 쓰지 않고 통계만 냅니다
  --only <a,b>      지정한 소스만 빌드합니다
  --config <경로>   설정 파일 경로 (기본: config/builder.config.json)
  --log-level <lv>  silent|error|warn|info|debug (기본: info)

add 옵션:
  --lore <설명>     짧은 설명
  --tags <a,b>      분류 태그
`.trim();

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case 'build':
      return commandBuild(rest);
    case 'sources':
      return commandSources(rest);
    case 'stats':
      return commandStats(rest);
    case 'lookup':
      return commandLookup(rest);
    case 'chain':
      return commandChain(rest);
    case 'add':
      return commandAdd(rest);
    default:
      console.error(`알 수 없는 명령: ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

async function commandBuild(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      online: { type: 'boolean', default: false },
      incremental: { type: 'boolean', default: false },
      sqlite: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      only: { type: 'string' },
      config: { type: 'string' },
      'log-level': { type: 'string', default: 'info' },
    },
  });

  const logger = new Logger(values['log-level'] as LogLevel);
  const result = await build({
    online: values.online,
    incremental: values.incremental,
    sqlite: values.sqlite,
    dryRun: values['dry-run'],
    ...(values.only ? { only: values.only.split(',').map((s) => s.trim()) } : {}),
    ...(values.config ? { configPath: values.config } : {}),
    logger,
  });

  printStats(result.stats);
  return 0;
}

async function commandSources(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string' } } });
  const config = await loadConfig(values.config);
  registerBuiltinSources();

  const rows = allSources()
    .map((source) => {
      const sourceConfig = sourceConfigOf(config, source.name, source.defaultPriority);
      return {
        id: source.name,
        이름: source.label,
        우선순위: sourceConfig.priority,
        활성: sourceConfig.enabled === false ? 'no' : 'yes',
        기본lore: sourceConfig.lore ?? source.defaultLore ?? '(항목별)',
      };
    })
    .sort((a, b) => a.우선순위 - b.우선순위);

  console.table(rows);
  return 0;
}

async function commandStats(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string' } } });
  const config = await loadConfig(values.config);
  const file = path.join(config.paths.dist, 'manifest.json');

  try {
    const manifest = JSON.parse(await readFile(file, 'utf8')) as BuildManifest;
    console.log(`빌드 시각 : ${manifest.builtAt}`);
    console.log(`엔트리    : ${manifest.entryCount.toLocaleString('ko-KR')}`);
    console.log(`체크섬    : ${manifest.checksum.slice(0, 16)}…`);
    printStats(manifest.stats);
    return 0;
  } catch {
    console.error(`빌드 결과가 없습니다: ${file}\n먼저 'dictbuild build' 를 실행하세요.`);
    return 1;
  }
}

async function commandLookup(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { config: { type: 'string' } },
    allowPositionals: true,
  });
  const word = positionals[0];
  if (!word) {
    console.error('조회할 단어를 입력하세요.');
    return 1;
  }

  const config = await loadConfig(values.config);
  const store = await DictionaryStore.load(config.paths.dist);
  const entry = store.get(word);
  if (!entry) {
    console.log(`'${word}' 은(는) 사전에 없습니다.`);
    return 1;
  }

  console.log(JSON.stringify(entry, null, 2));
  const candidates = store.nextCandidates(entry.word, { limit: 5 });
  console.log(
    `다음 단어 후보: ${candidates.map((item) => item.word).join(', ') || '(없음 — 한방단어)'}`,
  );
  return 0;
}

async function commandChain(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { config: { type: 'string' } },
    allowPositionals: true,
  });
  const [previous, next] = positionals;
  if (!previous || !next) {
    console.error('두 단어를 입력하세요: dictbuild chain <앞> <뒤>');
    return 1;
  }

  const config = await loadConfig(values.config);
  const store = await DictionaryStore.load(config.paths.dist);
  const ok = store.canFollow(previous, next);
  console.log(`${previous} -> ${next}: ${ok ? '가능' : '불가'}`);
  return ok ? 0 : 1;
}

async function commandAdd(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      lore: { type: 'string' },
      tags: { type: 'string' },
      config: { type: 'string' },
    },
    allowPositionals: true,
  });
  const word = positionals[0];
  if (!word) {
    console.error('추가할 단어를 입력하세요.');
    return 1;
  }

  const config = await loadConfig(values.config);
  const added = await appendCustomEntry(config.paths.seeds, {
    word,
    ...(values.lore ? { lore: values.lore } : {}),
    ...(values.tags ? { tags: values.tags.split(',').map((s) => s.trim()) } : {}),
  });

  console.log(
    added
      ? `추가했습니다: ${word} — 다시 빌드하려면 'dictbuild build --incremental'`
      : `이미 있는 단어입니다: ${word}`,
  );
  return 0;
}

function printStats(stats: {
  collected: number;
  accepted: number;
  rejected: number;
  merged: number;
  total: number;
  durationMs: number;
  perSource: Record<string, { collected: number; accepted: number; rejected: number; unique: number; cached: boolean }>;
  rejectionsByCode: Record<string, number>;
}): void {
  console.log('');
  console.log(
    `수집 ${stats.collected} → 통과 ${stats.accepted} → 병합 -${stats.merged} → 최종 ${stats.total} (${stats.durationMs}ms)`,
  );

  const rows = Object.entries(stats.perSource).map(([name, stat]) => ({
    소스: name,
    수집: stat.collected,
    통과: stat.accepted,
    탈락: stat.rejected,
    고유: stat.unique,
    캐시: stat.cached ? 'yes' : '',
  }));
  if (rows.length > 0) console.table(rows);

  const rejections = Object.entries(stats.rejectionsByCode);
  if (rejections.length > 0) {
    console.log(`탈락 사유: ${rejections.map(([code, n]) => `${code}=${n}`).join(', ')}`);
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
