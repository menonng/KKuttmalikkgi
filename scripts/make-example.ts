/**
 * examples/dictionary.sample.json 생성기.
 *
 *   npx tsx scripts/make-example.ts
 *
 * 전체 사전을 그대로 커밋하는 대신, 소스별 대표 항목만 뽑아
 * "출력 형식이 어떻게 생겼는지" 보여주는 예시 파일을 만든다.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DictionaryEntry } from '../src/core/types.js';

/** 명세에 나온 단어들 — 예시에 반드시 포함시킨다. */
const HIGHLIGHTS = [
  '벤티',
  '종려',
  '모락스',
  '바르바토스',
  '유메미즈키미즈키',
  '아나스타샤표도로브나스네즈나야',
  '키릴추도미로비치플린스',
  '오디세우스',
  '키르케',
  '네오프톨레모스',
  '헤파이스토스',
  '제우스',
  '아스모데우스',
  '바엘',
  '데카라비아',
  '안드레알푸스',
  '리제로부터시작하는이세계생활',
  '륨침대',
];

async function main(): Promise<void> {
  const dist = path.resolve('data/dist/dictionary.json');
  const entries = JSON.parse(await readFile(dist, 'utf8')) as DictionaryEntry[];
  const byWord = new Map(entries.map((entry) => [entry.word, entry]));

  const picked: DictionaryEntry[] = [];
  const seen = new Set<string>();

  for (const word of HIGHLIGHTS) {
    const entry = byWord.get(word);
    if (entry && !seen.has(entry.word)) {
      picked.push(entry);
      seen.add(entry.word);
    }
  }

  // 소스마다 한 건씩 더 붙여 커버리지를 보여준다.
  const coveredSources = new Set(picked.flatMap((entry) => entry.sources));
  for (const entry of entries) {
    const fresh = entry.sources.filter((source) => !coveredSources.has(source));
    if (fresh.length === 0 || seen.has(entry.word)) continue;
    picked.push(entry);
    seen.add(entry.word);
    for (const source of entry.sources) coveredSources.add(source);
  }

  picked.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));

  const out = path.resolve('examples/dictionary.sample.json');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    `[\n${picked.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`,
    'utf8',
  );
  console.log(`예시 ${picked.length}건 -> ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
