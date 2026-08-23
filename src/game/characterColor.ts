/**
 * 캐릭터 색상 팔레트.
 *
 * 멀티플레이 로비에서 같은 색 중복을 막고, AI 대전/프로필에서 색을 고르는 데 쓴다.
 * (로비 자체는 아직 구현 전이지만, 팔레트·중복회피 로직은 순수 함수로 미리
 * 만들어 둔다 — 로비를 붙일 때 이 모듈을 그대로 재사용한다.)
 */

export interface PaletteColor {
  hex: string;
  /** 눈(스클레라) 색. 기본은 흰자+검은 눈동자라 거의 항상 흰색이지만,
   *  아주 어두운 색(사실상 "검정")은 명시적으로 흰 눈을 강제한다. */
  eyeColor: string;
}

/** 사용자가 지정한 14색 팔레트. */
export const CHARACTER_PALETTE: readonly PaletteColor[] = [
  { hex: '#e60012', eyeColor: '#ffffff' },
  { hex: '#f0d9e4', eyeColor: '#ffffff' },
  { hex: '#ff7e00', eyeColor: '#ffffff' },
  { hex: '#ffcc11', eyeColor: '#ffffff' },
  { hex: '#ffee11', eyeColor: '#ffffff' },
  { hex: '#55bb44', eyeColor: '#ffffff' },
  { hex: '#39c5bb', eyeColor: '#ffffff' },
  { hex: '#3355bb', eyeColor: '#ffffff' },
  { hex: '#660099', eyeColor: '#ffffff' },
  { hex: '#ffb4cc', eyeColor: '#ffffff' },
  { hex: '#f1c5c2', eyeColor: '#ffffff' },
  { hex: '#eaf6ff', eyeColor: '#ffffff' },
  { hex: '#962b28', eyeColor: '#ffffff' },
  // 팔레트에서 사실상 "검정"에 해당하는 색 — 흰 눈을 명시적으로 강제한다.
  { hex: '#1d2327', eyeColor: '#ffffff' },
] as const;

const BY_HEX = new Map(CHARACTER_PALETTE.map((color) => [color.hex.toLowerCase(), color]));

/** 알 수 없는 색(직접 입력 등)을 위한 안전한 기본값. */
const FALLBACK: PaletteColor = { hex: '#f0d9e4', eyeColor: '#ffffff' };

/** hex 코드로 팔레트 항목을 찾는다. 팔레트 밖의 색이면 fallback. */
export function paletteColorOf(hex: string | undefined | null): PaletteColor {
  if (!hex) return FALLBACK;
  return BY_HEX.get(hex.toLowerCase()) ?? { hex, eyeColor: '#ffffff' };
}

/**
 * 겹치지 않는 무작위 색을 고른다 — 로비 입장 시 기본 배정에 쓴다.
 * 팔레트가 이미 다 찼으면(참가자가 색보다 많으면) null.
 */
export function pickRandomAvailableColor(excluded: ReadonlySet<string>): PaletteColor | null {
  const excludedLower = new Set([...excluded].map((hex) => hex.toLowerCase()));
  const available = CHARACTER_PALETTE.filter((color) => !excludedLower.has(color.hex.toLowerCase()));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)]!;
}

/** 같은 로비 안에서 이 색을 골라도 되는지("같은 색 불허"). */
export function isColorAvailable(hex: string, excluded: ReadonlySet<string>): boolean {
  const excludedLower = new Set([...excluded].map((h) => h.toLowerCase()));
  return !excludedLower.has(hex.toLowerCase());
}
