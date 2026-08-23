/**
 * 검증 규칙. 정규화된 단어만 들어온다고 가정한다.
 *
 * 중복은 여기서 걸러지지 않고 병합 엔진(dedupe.ts)에서 처리한다.
 * "정규화 후 중복"은 탈락이 아니라 병합이기 때문이다.
 */
import type { RejectCode } from './types.js';
import { charLength, firstChar, lastChar } from './normalize.js';
import { hasHangul, isHangulSyllable } from './hangul.js';

/** 검증 임계값. config.ts 와 브라우저 리졸버(src/service/*)가 공유한다. */
export interface ValidationConfig {
  /** 이 길이 미만이면 탈락. 끝말잇기는 보통 2글자 이상. */
  minLength: number;
  maxLength: number;
  /** 라틴 문자를 허용할지. */
  allowLatin: boolean;
  /** 숫자를 허용할지. */
  allowDigits: boolean;
  /** 한글 음절을 최소 1개 포함해야 하는지. */
  requireHangul: boolean;
  /** 첫/끝 글자가 한글이어야 하는지(끝말잇기 연결 가능성). */
  requireChainable: boolean;
  /** 완전 차단 단어(정규화 형태로 비교). */
  blocklist: string[];
  /**
   * 이 품사에 해당하는 항목은 사전에서 제외한다(POS 정보를 아는 소스만 해당).
   * 기본값 ["동사"] — 사전 인용형("먹다")은 실제로 단독 사용되는 명사형 단어가
   * 아니라 끝말잇기에 부적합하다. POS 를 모르는 소스(시드/코퍼스)의 항목은
   * 걸러지지 않는다 — 판단할 근거가 없기 때문이다.
   */
  excludedPos: string[];
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: RejectCode; reason: string };

const OK: ValidationResult = { ok: true };

/** 글자/숫자가 하나라도 있는지. 없으면 문장부호 덩어리다. */
const HAS_ALNUM = /[\p{L}\p{N}]/u;

export class Validator {
  private readonly blocked: Set<string>;
  private readonly excludedPos: Set<string>;
  private readonly allowedPattern: RegExp;

  constructor(private readonly config: ValidationConfig) {
    this.blocked = new Set(config.blocklist.map((w) => w.toLowerCase()));
    this.excludedPos = new Set(config.excludedPos ?? []);

    // 허용 문자 집합을 설정에서 조립한다. 공백은 정규화 단계에서 이미 사라졌다.
    const classes = ['\\p{Script=Hangul}'];
    if (config.allowLatin) classes.push('a-zA-Z');
    if (config.allowDigits) classes.push('0-9');
    this.allowedPattern = new RegExp(`^[${classes.join('')}]+$`, 'u');
  }

  /** pos 가 제외 대상 품사인지. pos 를 모르면(undefined) 통과시킨다. */
  isExcludedPos(pos: string | undefined): boolean {
    return pos !== undefined && this.excludedPos.has(pos);
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
