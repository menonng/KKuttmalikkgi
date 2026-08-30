import { describe, expect, it } from 'vitest';
import { allHangulSyllables } from '../src/sources/koreanDict.js';

describe('allHangulSyllables (sweepAllSyllables 옵션의 핵심 — "수십만 단위" 수집 경로)', () => {
  it('완성형 한글 음절 가~힣 을 정확히 11,172개 만든다', () => {
    const syllables = [...allHangulSyllables()];
    expect(syllables).toHaveLength(11_172);
  });

  it('첫 음절은 "가", 마지막 음절은 "힣" 이다', () => {
    const syllables = [...allHangulSyllables()];
    expect(syllables[0]).toBe('가');
    expect(syllables[syllables.length - 1]).toBe('힣');
  });

  it('중복이 없다', () => {
    const syllables = [...allHangulSyllables()];
    expect(new Set(syllables).size).toBe(syllables.length);
  });

  it('받침이 있는 음절도 포함한다(예: "각", "간") — 189개짜리 받침 없는 부분집합보다 훨씬 넓다', () => {
    const syllables = new Set(allHangulSyllables());
    expect(syllables.has('각')).toBe(true);
    expect(syllables.has('간')).toBe(true);
    expect(syllables.has('강')).toBe(true);
  });
});
