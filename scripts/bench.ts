/**
 * 대규모 빌드 벤치마크.
 *
 *   npx tsx scripts/bench.ts [엔트리수]
 *
 * 합성 어휘 코퍼스를 만들어 전체 파이프라인을 돌리고
 * 빌드 시간 / 피크 메모리 / 산출물 크기 / 조회 처리량을 잰다.
 * 10만+ 요구사항이 실제로 성립하는지 확인하는 용도다.
 */
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../src/core/pipeline.js';
import { DictionaryStore } from '../src/core/store.js';
import { Logger } from '../src/core/logger.js';

const SYLLABLES = [...'가나다라마바사아자차카타파하고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후기니디리미비시이지치키티피히'];

function syntheticWord(random: () => number): string {
  const length = 2 + Math.floor(random() * 3);
  let word = '';
  for (let i = 0; i < length; i += 1) {
    word += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
  }
  return word;
}

/** 재현 가능한 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function writeCorpus(file: string, count: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const random = seeded(20260823);
  const stream = createWriteStream(file, 'utf8');

  for (let i = 0; i < count; i += 1) {
    const word = syntheticWord(random);
    const line = `${word}\t합성 어휘 ${i} 번 항목.\n`;
    if (!stream.write(line)) {
      await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
    }
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 120_000);
  const root = await mkdtemp(path.join(tmpdir(), 'dictbench-'));
  const corpus = path.join(root, 'corpus.tsv');

  console.log(`합성 코퍼스 생성 중: ${count.toLocaleString('ko-KR')}건`);
  const corpusStart = performance.now();
  await writeCorpus(corpus, count);
  console.log(`  생성 ${Math.round(performance.now() - corpusStart)}ms`);

  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(
    path.join(root, 'config/builder.config.json'),
    JSON.stringify({
      sources: {
        korean_dict: {
          enabled: true,
          priority: 90,
          options: { corpusFiles: [corpus], queries: [] },
        },
      },
    }),
    'utf8',
  );

  const buildStart = performance.now();
  const result = await build({
    rootDir: root,
    only: ['korean_dict'],
    logger: new Logger('warn'),
  });
  const buildMs = performance.now() - buildStart;

  const dictionaryFile = path.join(root, 'data/dist/dictionary.json');
  const size = (await stat(dictionaryFile)).size;
  const memory = process.memoryUsage();

  console.log('');
  console.log('== 빌드 ==');
  console.log(`  수집       ${result.stats.collected.toLocaleString('ko-KR')}`);
  console.log(`  병합 제거  ${result.stats.merged.toLocaleString('ko-KR')}`);
  console.log(`  최종       ${result.stats.total.toLocaleString('ko-KR')}`);
  console.log(`  소요       ${Math.round(buildMs).toLocaleString('ko-KR')}ms`);
  console.log(`  처리량     ${Math.round(result.stats.collected / (buildMs / 1000)).toLocaleString('ko-KR')} entries/s`);
  console.log(`  RSS        ${(memory.rss / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  힙 사용    ${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  dictionary.json ${(size / 1024 / 1024).toFixed(1)}MB`);

  const loadStart = performance.now();
  const store = await DictionaryStore.load(path.join(root, 'data/dist'));
  const loadMs = performance.now() - loadStart;

  const samples = result.entries
    .filter((_, index) => index % Math.max(1, Math.floor(result.entries.length / 10_000)) === 0)
    .map((entry) => entry.word);

  const lookupStart = performance.now();
  let hits = 0;
  for (let round = 0; round < 10; round += 1) {
    for (const word of samples) if (store.has(word)) hits += 1;
  }
  const lookupMs = performance.now() - lookupStart;
  const lookups = samples.length * 10;

  console.log('');
  console.log('== 런타임 조회 ==');
  console.log(`  로드       ${Math.round(loadMs).toLocaleString('ko-KR')}ms (${store.size.toLocaleString('ko-KR')}건)`);
  console.log(`  조회       ${lookups.toLocaleString('ko-KR')}회 / ${lookupMs.toFixed(1)}ms`);
  console.log(`  처리량     ${Math.round(lookups / (lookupMs / 1000)).toLocaleString('ko-KR')} lookups/s (적중 ${hits.toLocaleString('ko-KR')})`);

  await rm(root, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
