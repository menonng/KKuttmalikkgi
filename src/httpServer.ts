#!/usr/bin/env node
/**
 * 사전 조회 API 서버.
 *
 *   npm run serve
 *   npm run serve -- --port 8787
 *
 * 엔드포인트:
 *   GET  /api/lookup?word=벤티              단어 존재 판정 (+ lore/sources)
 *   POST /api/validate-turn  { word, previous?, used? }   끝말잇기 한 턴 판정
 *   GET  /api/dictionary                    dictionary.json 그대로 서빙(정적 사이트 fetch 용)
 *   GET  /healthz                           헬스체크
 *
 * 외부 라우팅 프레임워크 없이 node:http 만으로 동작한다 — 의존성을 늘리지 않기 위함.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './core/config.js';
import { createServerResolver } from './service/server.js';
import { Logger } from './core/logger.js';
import type { TurnContext } from './service/types.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: process.env.PORT ?? '8787' },
      config: { type: 'string' },
    },
  });

  const logger = new Logger('info');
  const config = await loadConfig(values.config);
  const { resolver } = await createServerResolver({
    distDir: config.paths.dist,
    ...(process.env.KOREAN_DICT_API_KEY ? { koreanDictApiKey: process.env.KOREAN_DICT_API_KEY } : {}),
  });

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      logger.error(`요청 처리 실패: ${String(error)}`);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 정적 페이지(다른 오리진의 GitHub Pages)에서 fetch 할 수 있도록 CORS 를 연다.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/dictionary' && req.method === 'GET') {
      try {
        const body = await readFile(path.join(config.paths.dist, 'dictionary.json'), 'utf8');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(body);
      } catch {
        sendJson(res, 404, { error: 'dictionary_not_built' });
      }
      return;
    }

    if (url.pathname === '/api/lookup' && req.method === 'GET') {
      const word = url.searchParams.get('word');
      if (!word) {
        sendJson(res, 400, { error: 'missing_word' });
        return;
      }
      const resolution = await resolver.resolve(word);
      sendJson(res, resolution.status === 'invalid' ? 400 : 200, resolution);
      return;
    }

    if (url.pathname === '/api/validate-turn' && req.method === 'POST') {
      const body = await readBody(req);
      let payload: { word?: string; previous?: string | null; used?: string[] };
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      if (!payload.word) {
        sendJson(res, 400, { error: 'missing_word' });
        return;
      }
      const context: TurnContext = {
        previous: payload.previous ?? null,
        used: new Set(payload.used ?? []),
      };
      const result = await resolver.validateTurn(payload.word, context);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  const port = Number(values.port);
  server.listen(port, () => {
    logger.info(`사전 API 서버 실행 중: http://localhost:${port}`);
    logger.info(`  GET  /api/lookup?word=벤티`);
    logger.info(`  POST /api/validate-turn`);
    logger.info(`  GET  /api/dictionary`);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    .end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
