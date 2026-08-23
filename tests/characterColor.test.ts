import { describe, expect, it } from 'vitest';
import {
  CHARACTER_PALETTE,
  isColorAvailable,
  paletteColorOf,
  pickRandomAvailableColor,
} from '../src/game/characterColor.js';

describe('CHARACTER_PALETTE', () => {
  it('14색을 담고 있고 모두 눈 색이 흰색이다', () => {
    expect(CHARACTER_PALETTE).toHaveLength(14);
    expect(CHARACTER_PALETTE.every((c) => c.eyeColor === '#ffffff')).toBe(true);
  });

  it('중복된 hex 가 없다', () => {
    const hexes = CHARACTER_PALETTE.map((c) => c.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe('paletteColorOf', () => {
  it('팔레트 안의 색을 대소문자 무관하게 찾는다', () => {
    expect(paletteColorOf('#1D2327').hex).toBe('#1d2327');
    expect(paletteColorOf('#1d2327').eyeColor).toBe('#ffffff');
  });

  it('팔레트 밖의 색도 흰 눈으로 안전하게 처리한다', () => {
    expect(paletteColorOf('#123456')).toEqual({ hex: '#123456', eyeColor: '#ffffff' });
  });

  it('빈 값은 기본값을 돌려준다', () => {
    expect(paletteColorOf(undefined).hex).toBeTruthy();
    expect(paletteColorOf(null).hex).toBeTruthy();
  });
});

describe('pickRandomAvailableColor / isColorAvailable', () => {
  it('제외 목록에 없는 색만 고른다', () => {
    const excluded = new Set(CHARACTER_PALETTE.slice(0, 13).map((c) => c.hex));
    const picked = pickRandomAvailableColor(excluded);
    expect(picked?.hex).toBe(CHARACTER_PALETTE[13]!.hex);
  });

  it('전부 제외되면 null', () => {
    const excluded = new Set(CHARACTER_PALETTE.map((c) => c.hex));
    expect(pickRandomAvailableColor(excluded)).toBeNull();
  });

  it('대소문자와 무관하게 중복을 판정한다', () => {
    expect(isColorAvailable('#E60012', new Set(['#e60012']))).toBe(false);
    expect(isColorAvailable('#e60012', new Set(['#ff7e00']))).toBe(true);
  });
});
