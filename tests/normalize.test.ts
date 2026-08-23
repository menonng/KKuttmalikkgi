import { describe, expect, it } from 'vitest';
import {
  charLength,
  collapseWhitespace,
  dedupeKey,
  firstChar,
  lastChar,
  normalizeWord,
  stripParenthetical,
  stripTitleBrackets,
} from '../src/core/normalize.js';

describe('normalizeWord', () => {
  it('앞뒤 공백과 내부 공백을 모두 제거한다', () => {
    expect(normalizeWord('  리 제로부터 시작하는 이세계 생활  ')).toBe(
      '리제로부터시작하는이세계생활',
    );
  });

  it('전각 공백과 제로폭 문자를 제거한다', () => {
    const raw = `벤${String.fromCodePoint(0x3000)}티${String.fromCodePoint(0x200b)}`;
    expect(normalizeWord(raw)).toBe('벤티');
  });

  it('자모 분리(NFD) 입력을 완성형으로 되돌린다', () => {
    expect(normalizeWord('벤티'.normalize('NFD'))).toBe('벤티');
  });

  it('가운뎃점 같은 장식 구분점을 제거한다', () => {
    expect(normalizeWord('레오나르도·다·빈치')).toBe('레오나르도다빈치');
  });

  it('멱등이다', () => {
    const once = normalizeWord(' 소드 아트 온라인 ');
    expect(normalizeWord(once)).toBe(once);
  });
});

describe('보조 함수', () => {
  it('대소문자만 다른 표기는 같은 dedupe 키를 갖는다', () => {
    expect(dedupeKey('Genshin')).toBe(dedupeKey('genshin'));
  });

  it('동음이의 꼬리표를 떼어낸다', () => {
    expect(stripParenthetical('벤티 (원신)')).toBe('벤티');
  });

  it('제목 괄호 장식을 떼어낸다', () => {
    expect(stripTitleBrackets('「기생충」')).toBe('기생충');
  });

  it('lore 공백은 한 칸으로 접되 유지한다', () => {
    expect(collapseWhitespace('주로  알루미늄을\n뼈대로 하는')).toBe(
      '주로 알루미늄을 뼈대로 하는',
    );
  });

  it('첫/끝 글자와 길이를 코드포인트 기준으로 센다', () => {
    expect(firstChar('벤티')).toBe('벤');
    expect(lastChar('벤티')).toBe('티');
    expect(charLength('리제로부터시작하는이세계생활')).toBe(14);
  });
});
