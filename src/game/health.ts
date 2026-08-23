/**
 * 캐릭터 체력/피격 연출 파라미터.
 *
 * 규칙(사용자 스펙):
 *  - 단어를 못 내면 피해를 입는다.
 *  - 피해량은 턴이 지날수록 커진다: 기본 10, 턴마다 +3, 최대 50.
 *  - 20 이하 피해 -> 망치로 "빠르게 여러 번" 맞는다(대미지가 클수록 더 빠르고 더 많이).
 *  - 20 초과 피해 -> 망치로 "크고 세게 한 번" 맞는다(대미지가 클수록 더 세게, 더 크게).
 *
 * pace.ts 와 같은 턴 번호(match.turn, 1부터 시작)를 그대로 입력받아 데미지 곡선이
 * 제한시간 단축과 같은 리듬으로 진행되게 한다 — 게임이 격해질수록 맞는 것도 아파진다.
 */

export const HEALTH_BASE_DAMAGE = 10;
export const HEALTH_DAMAGE_STEP = 3;
export const HEALTH_MAX_DAMAGE = 50;
/** 이 값을 넘으면 "크게 한 방", 이하면 "빠르게 여러 번". */
export const HEALTH_HEAVY_HIT_THRESHOLD = 20;
/** 캐릭터 기본 최대 체력. */
export const MAX_HP = 100;

/** turn 번째 실패에 대한 피해량. turn 은 1부터 시작. */
export function damageForTurn(turn: number): number {
  const safeTurn = Number.isFinite(turn) && turn >= 1 ? turn : 1;
  const raw = HEALTH_BASE_DAMAGE + HEALTH_DAMAGE_STEP * (safeTurn - 1);
  return Math.min(HEALTH_MAX_DAMAGE, Math.round(raw));
}

export interface HitPlan {
  /** true 면 "크게 한 방", false 면 "빠르게 여러 번". */
  heavy: boolean;
  /** 망치가 내려치는 횟수. */
  hits: number;
  /** 타격 사이 간격(ms). heavy 일 때는 의미 없음(0). */
  intervalMs: number;
  /**
   * 연출 배율(1 이상). light 모드에선 참고용, heavy 모드에선 망치 스윙 크기/
   * 캐릭터 반동 크기에 곱해 쓴다 — 대미지가 클수록 커진다.
   */
  amplitude: number;
}

/**
 * 피해량으로부터 피격 연출 파라미터를 계산한다. 실제 DOM 애니메이션 로직은
 * 웹 페이지 쪽에 있고, 여기는 "얼마나 빠르게/세게" 를 결정하는 순수 계산만 한다.
 */
export function hitPlan(damage: number): HitPlan {
  const clamped = Math.max(0, Math.min(HEALTH_MAX_DAMAGE, damage));

  if (clamped <= HEALTH_HEAVY_HIT_THRESHOLD) {
    // 10 -> 3회/약 190ms 간격, 20 -> 5회/약 100ms 간격 (커질수록 더 빠르고 더 많이).
    const hits = Math.max(1, Math.round(clamped / 4));
    const intervalMs = Math.max(70, 220 - clamped * 6);
    return { heavy: false, hits, intervalMs, amplitude: 1 };
  }

  // 20 -> amplitude 1.0, 50 -> amplitude 2.8 (한 방의 스윙/반동이 점점 커진다).
  const t = (clamped - HEALTH_HEAVY_HIT_THRESHOLD) / (HEALTH_MAX_DAMAGE - HEALTH_HEAVY_HIT_THRESHOLD);
  const amplitude = 1 + t * 1.8;
  return { heavy: true, hits: 1, intervalMs: 0, amplitude };
}
