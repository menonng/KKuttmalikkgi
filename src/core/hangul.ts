/**
 * 한글 음절 처리 유틸.
 *
 * 끝말잇기는 "앞 단어의 끝 글자 == 뒷 단어의 첫 글자" 규칙이므로
 * 두음법칙(랑구 -> 낭구, 리을 -> 이을)까지 다뤄야 실제 게임에서 자연스럽다.
 * 사전 export 스키마는 건드리지 않고, 인덱스 단계에서만 변형을 사용한다.
 */

export const SYLLABLE_BASE = 0xac00;
export const SYLLABLE_LAST = 0xd7a3;
const JUNG_COUNT = 21;
const JONG_COUNT = 28;

export const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

export const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const;

export const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

export interface Jamo {
  /** 초성 인덱스 (CHOSEONG) */
  cho: number;
  /** 중성 인덱스 (JUNGSEONG) */
  jung: number;
  /** 종성 인덱스 (JONGSEONG, 0 = 받침 없음) */
  jong: number;
}

/** 완성형 한글 음절(가~힣)인지. */
export function isHangulSyllable(ch: string): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0)!;
  return code >= SYLLABLE_BASE && code <= SYLLABLE_LAST;
}

/** 문자열이 한글 음절을 하나라도 포함하는지. */
export function hasHangul(text: string): boolean {
  for (const ch of text) if (isHangulSyllable(ch)) return true;
  return false;
}

/** 음절을 자모 인덱스로 분해한다. 한글이 아니면 null. */
export function decompose(ch: string): Jamo | null {
  if (!isHangulSyllable(ch)) return null;
  const offset = ch.codePointAt(0)! - SYLLABLE_BASE;
  return {
    cho: Math.floor(offset / (JUNG_COUNT * JONG_COUNT)),
    jung: Math.floor(offset / JONG_COUNT) % JUNG_COUNT,
    jong: offset % JONG_COUNT,
  };
}

/** 자모 인덱스를 음절로 합성한다. */
export function compose({ cho, jung, jong }: Jamo): string {
  return String.fromCodePoint(
    SYLLABLE_BASE + (cho * JUNG_COUNT + jung) * JONG_COUNT + jong,
  );
}

const CHO_R = CHOSEONG.indexOf('ㄹ');
const CHO_N = CHOSEONG.indexOf('ㄴ');
const CHO_IEUNG = CHOSEONG.indexOf('ㅇ');

/** ㄹ/ㄴ 뒤에서 ㅇ 으로 바뀌는 중성(ㅑㅕㅛㅠㅣㅖ). */
const YOTIZED = new Set(
  ['ㅑ', 'ㅕ', 'ㅛ', 'ㅠ', 'ㅣ', 'ㅖ'].map((v) => JUNGSEONG.indexOf(v as never)),
);
/** ㄹ 뒤에서 ㄴ 으로 바뀌는 중성(ㅏㅐㅗㅚㅜㅡ). */
const PLAIN = new Set(
  ['ㅏ', 'ㅐ', 'ㅗ', 'ㅚ', 'ㅜ', 'ㅡ'].map((v) => JUNGSEONG.indexOf(v as never)),
);

/**
 * 두음법칙을 한 글자에 적용한다. 바뀌지 않으면 null.
 *
 * 라->나, 로->노, 려->여, 리->이, 녀->여, 니->이 …
 */
export function applyDueum(ch: string): string | null {
  const jamo = decompose(ch);
  if (!jamo) return null;
  if (jamo.cho === CHO_R) {
    if (YOTIZED.has(jamo.jung)) return compose({ ...jamo, cho: CHO_IEUNG });
    if (PLAIN.has(jamo.jung)) return compose({ ...jamo, cho: CHO_N });
    return null;
  }
  if (jamo.cho === CHO_N && YOTIZED.has(jamo.jung)) {
    return compose({ ...jamo, cho: CHO_IEUNG });
  }
  return null;
}

/**
 * 어떤 단어의 끝 글자가 주어졌을 때, 다음 단어가 시작할 수 있는 글자들.
 * 원 글자 + 두음법칙 변형을 중복 없이 돌려준다.
 */
export function chainHeads(lastChar: string): string[] {
  const heads = [lastChar];
  const dueum = applyDueum(lastChar);
  if (dueum && dueum !== lastChar) heads.push(dueum);
  return heads;
}

/**
 * 역방향: 어떤 글자로 시작하는 단어를 찾을 때 매칭시켜야 할 끝 글자들.
 * (이 -> 이, 리) 처럼 두음법칙을 되돌린 후보를 포함한다.
 */
export function chainTails(firstChar: string): string[] {
  const tails = new Set([firstChar]);
  const jamo = decompose(firstChar);
  if (jamo) {
    if (jamo.cho === CHO_IEUNG && YOTIZED.has(jamo.jung)) {
      tails.add(compose({ ...jamo, cho: CHO_R }));
      tails.add(compose({ ...jamo, cho: CHO_N }));
    } else if (jamo.cho === CHO_N && PLAIN.has(jamo.jung)) {
      tails.add(compose({ ...jamo, cho: CHO_R }));
    }
  }
  return [...tails];
}
