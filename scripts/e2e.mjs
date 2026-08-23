#!/usr/bin/env node
/**
 * 브라우저 사전 UI 종단간(E2E) 스모크 테스트.
 *
 *   npm run test:e2e
 *
 * GitHub Pages 배포와 동일한 구조로 site/ 를 조립하고, 실제 Chromium 으로
 * DICTIONARY 모달을 열어 검색을 수행한다. 이 저장소 컨테이너처럼 아웃바운드가
 * 막힌 환경에서는 온라인 검색이 'unknown' 으로 안전하게 귀결되는지만 확인하고,
 * GitHub Actions 처럼 인터넷이 열린 환경에서는 온라인 검색이 실제로
 * 'resolved' 되는지까지 검증한다(둘 다 실패로 보지 않는다).
 *
 * 사전 빌드(npm run dict:build) 와 TS 컴파일(npm run build) 을 먼저 실행해 둬야 한다.
 */
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json' };

function assert(condition, message) {
  if (!condition) throw new Error(`assert 실패: ${message}`);
}

async function assembleSite() {
  const site = await mkdtemp(path.join(tmpdir(), 'dictbuild-e2e-'));
  await mkdir(path.join(site, 'dist'), { recursive: true });
  await mkdir(path.join(site, 'data'), { recursive: true });
  await cp(path.join(ROOT, 'web/index.html'), path.join(site, 'index.html'));
  await cp(path.join(ROOT, 'dist'), path.join(site, 'dist'), { recursive: true });
  await cp(path.join(ROOT, 'data/dist/dictionary.json'), path.join(site, 'data/dictionary.json'));
  return site;
}

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const file = path.join(root, url.pathname === '/' ? '/index.html' : url.pathname);
      await stat(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function main() {
  const site = await assembleSite();
  const port = 4174;
  const server = await serve(site, port);
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  );

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });

    await page.waitForFunction(
      () => document.getElementById('featuredWord')?.textContent !== '불러오는 중…',
      { timeout: 10_000 },
    );
    console.log('✓ 오늘의 단어 로드:', await page.textContent('#featuredWord'));

    await page.click('[data-modal="dictionary"]');
    await page.waitForSelector('#dictionaryInput', { timeout: 5_000 });

    // 1) 등록된 단어 — 즉시 known 이어야 한다.
    await page.fill('#dictionaryInput', '벤티');
    await page.click('#dictionarySearchButton');
    await page.waitForSelector('.lookup-badge.ok', { timeout: 10_000 });
    console.log('✓ 등록된 단어(벤티) 조회 성공');

    // 2) 형식이 잘못된 입력 — 네트워크 없이 즉시 invalid.
    await page.fill('#dictionaryInput', 'ㄱ');
    await page.click('#dictionarySearchButton');
    await page.waitForSelector('.lookup-badge.warn', { timeout: 5_000 });
    console.log('✓ 형식 오류(ㄱ) 즉시 거부');

    // 3) 시드/코퍼스 어디에도 없는, 실재하는 인물 — 온라인 환경이면 위키 검색으로
    //    새로 확인(origin=online)돼야 한다. data/seeds 에 없는지 미리 확인한 단어다.
    await page.fill('#dictionaryInput', '페르세포네');
    await page.click('#dictionarySearchButton');
    await page.waitForSelector('.lookup-card', { timeout: 20_000 });
    const persephoneBadge = await page.getAttribute('.lookup-badge', 'class');
    if (persephoneBadge?.includes(' ok')) {
      const resultText = await page.textContent('#dictionaryResults');
      assert(
        resultText.includes('실시간 검색으로 확인됨'),
        `빌드된 사전에 없는 단어인데 origin 이 online 이 아님: ${resultText}`,
      );
      console.log('✓ 온라인 환경: 위키 검색으로 미등록 단어(페르세포네) 신규 확인됨');
    } else {
      console.log('△ 오프라인/차단 환경: 온라인 검색이 실패해 unknown 으로 귀결됨(허용)');
    }

    // 4) 완전히 존재하지 않는 단어 — 어느 환경에서도 unknown 이어야 한다.
    await page.fill('#dictionaryInput', '완전히존재하지않는가짜단어테스트야');
    await page.click('#dictionarySearchButton');
    await page.waitForSelector('.lookup-card', { timeout: 20_000 });
    const fakeBadge = await page.getAttribute('.lookup-badge', 'class');
    assert(fakeBadge?.includes(' ng'), `존재하지 않는 단어는 ng 여야 함 (실제: ${fakeBadge})`);
    console.log('✓ 완전 가짜 단어는 어디서도 확인되지 않음');

    // 5) 이스터에그 — 정확한 4색 팔레트로 전환돼야 한다.
    await page.click('#closeModal');
    for (const ch of '19911018mafumafu') await page.keyboard.press(ch);
    await page.waitForTimeout(300);
    const secretBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(secretBg === 'rgb(240, 217, 228)', `secret 배경이 #f0d9e4 여야 함 (실제: ${secretBg})`);
    console.log('✓ 이스터에그 팔레트(#f0d9e4) 적용 확인');
    for (const ch of '19911018mafumafu') await page.keyboard.press(ch);

    const fatal = pageErrors.filter((message) => !/net::ERR_|Failed to load resource/u.test(message));
    assert(fatal.length === 0, `예상치 못한 페이지 오류: ${fatal.join(', ')}`);

    console.log('\n모든 E2E 점검 통과.');
  } finally {
    await browser.close();
    server.close();
    await rm(site, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('E2E 실패:', error);
  process.exitCode = 1;
});
