import { describe, expect, it } from 'vitest';
import {
  HEALTH_MAX_DAMAGE,
  HEAVY_HIT_MIN_MS,
  HEAVY_HIT_AMPLITUDE_MS,
  damageForTurn,
  estimateHitSequenceMs,
  hitPlan,
} from '../src/game/health.js';

describe('damageForTurn', () => {
  it('첫 실패는 기본 10 피해', () => {
    expect(damageForTurn(1)).toBe(10);
  });

  it('턴마다 3씩 늘어난다', () => {
    expect(damageForTurn(2)).toBe(13);
    expect(damageForTurn(5)).toBe(22);
  });

  it('최대 50에서 멈춘다', () => {
    expect(damageForTurn(100)).toBe(HEALTH_MAX_DAMAGE);
    // 10 + 3*(n-1) = 50 -> n = 14.33.. 이므로 15턴째 이미 50으로 클램프.
    expect(damageForTurn(15)).toBe(HEALTH_MAX_DAMAGE);
  });

  it('턴이 1보다 작으면 1턴으로 취급한다', () => {
    expect(damageForTurn(0)).toBe(10);
    expect(damageForTurn(-3)).toBe(10);
  });

  it('턴이 지날수록 단조 증가한다', () => {
    let previous = damageForTurn(1);
    for (let turn = 2; turn <= 30; turn += 1) {
      const current = damageForTurn(turn);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('hitPlan', () => {
  it('20 이하는 "빠르게 여러 번"(heavy=false)', () => {
    expect(hitPlan(10).heavy).toBe(false);
    expect(hitPlan(20).heavy).toBe(false);
  });

  it('20 초과는 "크게 한 방"(heavy=true, hits=1)', () => {
    const plan = hitPlan(21);
    expect(plan.heavy).toBe(true);
    expect(plan.hits).toBe(1);
  });

  it('light 모드: 대미지가 클수록 타격 횟수가 늘고 간격은 짧아진다', () => {
    const low = hitPlan(10);
    const high = hitPlan(20);
    expect(high.hits).toBeGreaterThanOrEqual(low.hits);
    expect(high.intervalMs).toBeLessThanOrEqual(low.intervalMs);
  });

  it('heavy 모드: 대미지가 클수록 amplitude 가 커진다', () => {
    const low = hitPlan(21);
    const high = hitPlan(50);
    expect(high.amplitude).toBeGreaterThan(low.amplitude);
  });

  it('경계값 0과 50을 안전하게 처리한다', () => {
    expect(() => hitPlan(0)).not.toThrow();
    expect(() => hitPlan(50)).not.toThrow();
    expect(hitPlan(0).hits).toBeGreaterThanOrEqual(1);
  });

  it('범위를 벗어난 입력은 클램프한다', () => {
    expect(hitPlan(-10)).toEqual(hitPlan(0));
    expect(hitPlan(999)).toEqual(hitPlan(50));
  });
});

describe('estimateHitSequenceMs', () => {
  it('light 모드는 hits * intervalMs 와 같다', () => {
    const plan = hitPlan(10);
    expect(estimateHitSequenceMs(plan)).toBe(plan.hits * plan.intervalMs);
  });

  it('heavy 모드는 클라이언트와 같은 공식(최소 1000ms + amplitude 에 비례)을 쓴다', () => {
    const plan = hitPlan(50);
    expect(estimateHitSequenceMs(plan)).toBeCloseTo(
      HEAVY_HIT_MIN_MS + (plan.amplitude - 1) * HEAVY_HIT_AMPLITUDE_MS,
      5,
    );
  });

  it('20 초과(heavy) 는 항상 1000ms 이상 걸린다', () => {
    for (const damage of [21, 25, 35, 50]) {
      expect(estimateHitSequenceMs(hitPlan(damage))).toBeGreaterThanOrEqual(HEAVY_HIT_MIN_MS);
    }
  });

  it('heavy 모드는 대미지(amplitude)가 클수록 더 오래 걸린다', () => {
    const low = estimateHitSequenceMs(hitPlan(21));
    const high = estimateHitSequenceMs(hitPlan(50));
    expect(high).toBeGreaterThan(low);
  });

  it('항상 양수다', () => {
    for (const damage of [0, 5, 10, 20, 21, 35, 50]) {
      expect(estimateHitSequenceMs(hitPlan(damage))).toBeGreaterThan(0);
    }
  });
});
