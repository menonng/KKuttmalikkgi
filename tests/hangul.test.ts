import { describe, expect, it } from 'vitest';
import {
  applyDueum,
  chainHeads,
  chainTails,
  compose,
  decompose,
  hasHangul,
  isHangulSyllable,
} from '../src/core/hangul.js';

describe('음절 분해/합성', () => {
  it('분해 후 합성하면 원래 글자로 돌아온다', () => {
    for (const ch of ['가', '벤', '활', '힣']) {
      expect(compose(decompose(ch)!)).toBe(ch);
    }
  });

  it('한글 여부를 판별한다', () => {
    expect(isHangulSyllable('벤')).toBe(true);
    expect(isHangulSyllable('a')).toBe(false);
    expect(isHangulSyllable('ㄱ')).toBe(false);
    expect(hasHangul('SAO온라인')).toBe(true);
  });
});

describe('두음법칙', () => {
  it('ㄹ + 단모음은 ㄴ 으로 바뀐다', () => {
    expect(applyDueum('라')).toBe('나');
    expect(applyDueum('로')).toBe('노');
    expect(applyDueum('락')).toBe('낙');
  });

  it('ㄹ/ㄴ + 이중모음은 ㅇ 으로 바뀐다', () => {
    expect(applyDueum('려')).toBe('여');
    expect(applyDueum('리')).toBe('이');
    expect(applyDueum('녀')).toBe('여');
  });

  it('해당 없는 글자는 그대로 둔다', () => {
    expect(applyDueum('벤')).toBeNull();
    expect(applyDueum('가')).toBeNull();
  });

  it('연결 가능한 첫 글자 후보를 만든다', () => {
    expect(chainHeads('락')).toEqual(['락', '낙']);
    expect(chainHeads('티')).toEqual(['티']);
  });

  it('역방향 후보도 만든다', () => {
    expect(chainTails('이')).toContain('리');
    expect(chainTails('나')).toContain('라');
  });
});
