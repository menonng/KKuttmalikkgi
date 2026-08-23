/**
 * lore(짧은 설명) 생성/병합.
 *
 * 규칙:
 *  - 고유명사는 출처 태그가 곧 lore ("벤티" -> "원신")
 *  - 일반 어휘는 사전 뜻풀이가 lore ("륨침대" -> "주로 알루미늄을 …")
 *  - 여러 소스에 걸친 단어는 태그를 ", "로 잇는다 ("원신, 악마학")
 *  - 기본 60자를 넘지 않는다
 */
import { collapseWhitespace } from './normalize.js';

/** 위키 각주 표식 [1], [출처 필요] 등. */
const CITATION = /\[[^\]]{0,20}\]/gu;
/** 뜻풀이 앞에 붙는 번호 매김 "1. ", "「1」" 등. */
const LEADING_NUMBERING = /^\s*(?:[0-9]{1,2}[.)]\s*|[「『]\s*[0-9]{1,2}\s*[」』]\s*)/u;

export interface LoreOptions {
  maxLength: number;
  /** 아무 lore 도 못 구했을 때의 최종 대체값. */
  fallback: string;
}

export class LoreEngine {
  constructor(private readonly options: LoreOptions) {}

  /**
   * 조각 하나를 정리한다. 의미 없는 값이면 null.
   * 길면 이 단계에서 미리 잘라 병합 비용을 줄인다.
   */
  clean(raw: string | undefined | null): string | null {
    if (!raw) return null;
    let text = collapseWhitespace(String(raw).replace(CITATION, ''));
    text = text.replace(LEADING_NUMBERING, '').trim();
    text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '').trim();
    text = text.replace(/[,;·]+$/u, '').trim();
    if (!text) return null;
    return this.truncate(text);
  }

  /**
   * 우선순위 순으로 들어온 조각들을 하나의 lore 로 합친다.
   *  - 중복/포함 관계인 조각은 긴 쪽만 남긴다 ("원신" ⊂ "원신 캐릭터")
   *  - 길이 예산을 넘으면 우선순위가 낮은 조각부터 버린다
   */
  merge(fragments: Array<string | undefined | null>): string {
    const cleaned: string[] = [];
    for (const fragment of fragments) {
      const value = this.clean(fragment);
      if (!value) continue;
      if (cleaned.some((kept) => kept.toLowerCase() === value.toLowerCase())) continue;

      // 이미 담긴 조각이 새 조각에 포함되면 더 구체적인 쪽으로 교체한다.
      const containedIndex = cleaned.findIndex((kept) => value.includes(kept));
      if (containedIndex >= 0) {
        cleaned[containedIndex] = value;
        continue;
      }
      if (cleaned.some((kept) => kept.includes(value))) continue;
      cleaned.push(value);
    }

    if (cleaned.length === 0) return this.options.fallback;

    let joined = cleaned.join(', ');
    while (joined.length > this.options.maxLength && cleaned.length > 1) {
      cleaned.pop();
      joined = cleaned.join(', ');
    }
    return this.truncate(joined);
  }

  /** 길이 예산에 맞춰 자른다. 가능하면 단어 경계에서 자르고 말줄임표를 붙인다. */
  private truncate(text: string): string {
    const max = this.options.maxLength;
    if (text.length <= max) return text;

    const head = text.slice(0, max - 1);
    const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf(','));
    const cut = boundary > max * 0.6 ? head.slice(0, boundary) : head;
    return `${cut.replace(/[\s,;·]+$/u, '')}…`;
  }
}
