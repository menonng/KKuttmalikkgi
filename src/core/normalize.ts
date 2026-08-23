/**
 * 단어 정규화.
 *
 * 저장 규칙:
 *  - 유니코드 NFC 로 통일 (자모 분리 입력을 완성형으로)
 *  - 앞뒤 공백 제거
 *  - 내부 공백 전부 제거 ("리 제로부터 시작하는" -> "리제로부터시작하는")
 *  - 제로폭/구분점 같은 보이지 않거나 장식적인 문자 제거
 *
 * 눈에 보이지 않는 문자는 소스 코드에 직접 넣지 않고 코드포인트로 표기한다.
 */

/** JS 의 \s 는 NBSP(U+00A0), 전각 공백(U+3000), BOM 까지 포함한다. */
const WHITESPACE = /\s+/gu;

/** \s 가 잡지 못하는 제로폭/소프트하이픈 문자. */
const INVISIBLE_CODEPOINTS = new Set([
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0x00ad, // SOFT HYPHEN
]);

/** 표기 장식용 구분점. 단어 경계를 나누는 용도라 제거해도 의미가 보존된다. */
const DEFAULT_JOINER_CODEPOINTS = [
  0x00b7, // MIDDLE DOT
  0x30fb, // KATAKANA MIDDLE DOT
  0x2027, // HYPHENATION POINT
  0xff65, // HALFWIDTH KATAKANA MIDDLE DOT
  0x22c5, // DOT OPERATOR
  0x2010, // HYPHEN
  0x2011, // NON-BREAKING HYPHEN
];

const DEFAULT_JOINERS = DEFAULT_JOINER_CODEPOINTS.map((cp) => String.fromCodePoint(cp));

/** 괄호로 감싼 동음이의 꼬리표: "벤티 (원신)" -> "벤티" */
const TRAILING_PARENTHETICAL = /\s*[(（\[［{][^)）\]］}]*[)）\]］}]\s*$/u;

/** 제목 표기용 괄호/따옴표 장식. */
const TITLE_BRACKETS = /[《》「」『』〈〉〔〕【】"']/gu;

/** 곧은 따옴표로 정규화되지 않는 굽은 따옴표들. */
const CURLY_QUOTE_CODEPOINTS = [0x201c, 0x201d, 0x2018, 0x2019];

export interface NormalizeOptions {
  /** 제거할 장식 문자. 기본값은 구분점 세트. */
  joiners?: string[];
}

function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    if (!INVISIBLE_CODEPOINTS.has(ch.codePointAt(0)!)) out += ch;
  }
  return out;
}

/**
 * 저장용 정규화. 검증 이전에 항상 이 함수를 통과시킨다.
 * 멱등(normalizeWord(normalizeWord(x)) === normalizeWord(x))이다.
 */
export function normalizeWord(input: string, options: NormalizeOptions = {}): string {
  if (!input) return '';
  const joiners = options.joiners ?? DEFAULT_JOINERS;
  let out = stripInvisible(input.normalize('NFC')).replace(WHITESPACE, '');
  for (const joiner of joiners) out = out.split(joiner).join('');
  return out.trim();
}

/**
 * 중복 판정 키. 대소문자만 다른 라틴 표기를 같은 단어로 본다.
 * (한글에는 영향이 없지만 "Genshin"/"genshin" 같은 항목을 하나로 모은다.)
 */
export function dedupeKey(normalized: string): string {
  return normalized.toLowerCase();
}

/** 위키 문서 제목처럼 꼬리표가 붙은 표기를 다듬는다. */
export function stripParenthetical(title: string): string {
  return title.replace(TRAILING_PARENTHETICAL, '').trim();
}

/** 작품명 표기의 괄호/따옴표 장식을 제거한다. */
export function stripTitleBrackets(title: string): string {
  let out = title.replace(TITLE_BRACKETS, '');
  for (const cp of CURLY_QUOTE_CODEPOINTS) {
    out = out.split(String.fromCodePoint(cp)).join('');
  }
  return out.trim();
}

/** lore 텍스트 정리: 줄바꿈/중복 공백을 한 칸으로 접는다(공백 자체는 유지). */
export function collapseWhitespace(text: string): string {
  return stripInvisible(text.normalize('NFC')).replace(/\s+/gu, ' ').trim();
}

/** 첫 글자 — 서로게이트 페어 안전. */
export function firstChar(word: string): string {
  return [...word][0] ?? '';
}

/** 끝 글자 — 서로게이트 페어 안전. */
export function lastChar(word: string): string {
  const chars = [...word];
  return chars[chars.length - 1] ?? '';
}

/** 코드포인트 기준 길이(이모지/서로게이트 안전). */
export function charLength(word: string): number {
  return [...word].length;
}
