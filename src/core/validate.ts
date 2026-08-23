/**
 * 검증 규칙. 정규화된 단어만 들어온다고 가정한다.
 *
 * 중복은 여기서 걸러지지 않고 병합 엔진(dedupe.ts)에서 처리한다.
 * "정규화 후 중복"은 탈락이 아니라 병합이기 때문이다.
 */
import type { RejectCode } from './types.js';
import type { ValidationConfig } from './config.js';
import { charLength, firstChar, lastChar } from './normalize.js';
import { hasHangul, isHangulSyllable } from './hangul.js';

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: RejectCode; reason: string };

const OK: ValidationResult = { ok: true };

/** 글자/숫자가 하나라도 있는지. 없으면 문장부호 덩어리다. */
const HAS_ALNUM = /[\p{L}\p{N}]/u;

export class Validator {
  private readonly blocked: Set<string>;
  private readonly allowedPattern: RegExp;

  constructor(private readonly config: ValidationConfig) {
    this.blocked = new Set(config.blocklist.map((w) => w.toLowerCase()));

    // 허용 문자 집합을 설정에서 조립한다. 공백은 정규화 단계에서 이미 사라졌다.
    const classes = ['\\p{Script=Hangul}'];
    if (config.allowLatin) classes.push('a-zA-Z');
    if (config.allowDigits) classes.push('0-9');
    this.allowedPattern = new RegExp(`^[${classes.join('')}]+$`, 'u');
  }

  validate(word: string): ValidationResult {
    if (!word) {
      return { ok: false, code: 'empty', reason: '빈 문자열' };
    }
    if (!HAS_ALNUM.test(word)) {
      return { ok: false, code: 'punctuation_only', reason: '문장부호로만 구성됨' };
    }
    if (this.blocked.has(word.toLowerCase())) {
      return { ok: false, code: 'blocked', reason: '차단 목록에 포함됨' };
    }

    const length = charLength(word);
    if (length < this.config.minLength) {
      return {
        ok: false,
        code: 'too_short',
        reason: `최소 길이 ${this.config.minLength}자 미만 (${length}자)`,
      };
    }
    if (length > this.config.maxLength) {
      return {
        ok: false,
        code: 'too_long',
        reason: `최대 길이 ${this.config.maxLength}자 초과 (${length}자)`,
      };
    }

    if (!this.allowedPattern.test(word)) {
      return { ok: false, code: 'illegal_characters', reason: '허용되지 않은 문자 포함' };
    }
    if (this.config.requireHangul && !hasHangul(word)) {
      return { ok: false, code: 'illegal_characters', reason: '한글이 하나도 없음' };
    }

    if (this.config.requireChainable) {
      if (!isHangulSyllable(firstChar(word))) {
        return { ok: false, code: 'no_chain_head', reason: '첫 글자가 한글 음절이 아님' };
      }
      if (!isHangulSyllable(lastChar(word))) {
        return { ok: false, code: 'no_chain_tail', reason: '끝 글자가 한글 음절이 아님' };
      }
    }

    return OK;
  }
}
