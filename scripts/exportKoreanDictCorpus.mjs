#!/usr/bin/env node
/**
 * data/dist/dictionary.json 에서 korean_dict 단독 출처 항목(다른 소스와
 * 병합되지 않은 순수 일반 어휘)만 뽑아 data/corpus/korean-words.tsv 로
 * 내보낸다.
 *
 * 왜 필요한가: 온라인(--online) 빌드로 우리말샘 API 를 훑은 결과는
 * data/dist/ 에만 남고(빌드 산출물, gitignore), 그 어디에도 저장소에
 * 커밋되지 않는다. 그래서 GitHub Pages 배포(pages.yml)는 항상 오프라인
 * 빌드만 하므로 실제 배포된 사이트에는 이 온라인 수집 결과가 절대 반영되지
 * 않는다. 이 스크립트가 그 수집 결과를 코퍼스 파일로 뽑아 저장소에 커밋될
 * 수 있게 해서(.github/workflows/dictionary.yml 의 refresh 잡이 매주
 * 실행+커밋), 이후 오프라인 빌드에도 그대로 실린다.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIST_FILE = path.resolve(process.cwd(), 'data/dist/dictionary.json');
const OUT_FILE = path.resolve(process.cwd(), 'data/corpus/korean-words.tsv');

async function main() {
  const raw = await readFile(DIST_FILE, 'utf8');
  const entries = JSON.parse(raw);

  const rows = entries
    .filter(
      (entry) =>
        Array.isArray(entry.sources) &&
        entry.sources.length === 1 &&
        entry.sources[0] === 'korean_dict',
    )
    .map((entry) => {
      const lore = String(entry.lore ?? '').replace(/[\t\r\n]+/gu, ' ').trim();
      return `${entry.word}\t${lore}`;
    })
    .sort((a, b) => a.localeCompare(b, 'ko'));

  const header = [
    '# 단어<TAB>뜻풀이 — 우리말샘 온라인 수집 결과(자동 생성 파일, 손으로 고치지 마세요).',
    '# scripts/exportKoreanDictCorpus.mjs 가 .github/workflows/dictionary.yml 의',
    '# refresh 잡(매주 월요일 + 수동 실행)에서 자동으로 다시 만들어 커밋합니다.',
  ].join('\n');

  await writeFile(OUT_FILE, `${header}\n${rows.join('\n')}\n`, 'utf8');
  console.log(`[exportKoreanDictCorpus] ${rows.length}건 -> ${OUT_FILE}`);
}

main().catch((error) => {
  console.error('[exportKoreanDictCorpus] 실패:', error);
  process.exitCode = 1;
});
