/**
 * 브라우저에서도 안전하게 쓸 수 있는 기본값.
 *
 * config.ts 는 node:fs/node:path 를 가져오기 때문에 브라우저에서 그대로 쓸 수 없다.
 * 하지만 검증 규칙과 lore 기본값은 클라이언트 쪽 사전 리졸버(src/service/*)도
 * 그대로 필요하다. Node 전용 코드와 분리해 여기 한 곳에서만 정의한다.
 */
import type { ValidationConfig } from './validate.js';

export const DEFAULT_VALIDATION: ValidationConfig = {
  minLength: 2,
  maxLength: 40,
  allowLatin: true,
  allowDigits: true,
  requireHangul: true,
  requireChainable: true,
  blocklist: [],
  excludedPos: ['동사'],
};

export const DEFAULT_MAX_LORE_LENGTH = 60;
export const DEFAULT_FALLBACK_LORE = '일반 어휘';
