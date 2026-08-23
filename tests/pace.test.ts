import { describe, expect, it } from 'vitest';
import {
  PACE_BASE_SECONDS,
  PACE_MAX_SPEED_RATIO,
  PACE_MIN_SECONDS,
  paceSpeedRatio,
  turnAtFloor,
  turnDurationSeconds,
} from '../src/game/pace.js';

describe('turnDurationSeconds', () => {
  it('첫 턴은 13초다', () => {
    expect(turnDurationSeconds(1)).toBe(13);
  });

  it('턴마다 0.3초씩 줄어든다', () => {
    expect(turnDurationSeconds(2)).toBe(12.7);
    expect(turnDurationSeconds(3)).toBe(12.4);
    expect(turnDurationSeconds(10)).toBe(10.3);
  });

  it('부동소수점 오차 없이 정확히 0.1 단위로 떨어진다', () => {
    for (let turn = 1; turn <= 40; turn += 1) {
      const value = turnDurationSeconds(turn);
      expect(Math.round(value * 10)).toBe(value * 10);
    }
  });

  it('최소 2초 밑으로 내려가지 않는다', () => {
    expect(turnDurationSeconds(100)).toBe(2);
    expect(turnDurationSeconds(1000)).toBe(2);
  });

  it('턴 번호가 1보다 작거나 유효하지 않으면 1턴으로 취급한다', () => {
    expect(turnDurationSeconds(0)).toBe(13);
    expect(turnDurationSeconds(-5)).toBe(13);
    expect(turnDurationSeconds(Number.NaN)).toBe(13);
  });

  it('하한에 도달하는 턴 번호를 계산할 수 있다', () => {
    const floorTurn = turnAtFloor();
    expect(turnDurationSeconds(floorTurn)).toBe(PACE_MIN_SECONDS);
    expect(turnDurationSeconds(floorTurn - 1)).toBeGreaterThan(PACE_MIN_SECONDS);
  });
});

describe('paceSpeedRatio', () => {
  it('첫 턴은 1배속이다', () => {
    expect(paceSpeedRatio(1)).toBe(1);
  });

  it('언제나 기준 시간(13초) / 현재 제한시간과 같다', () => {
    for (const turn of [1, 5, 11, 23, 37]) {
      expect(paceSpeedRatio(turn)).toBeCloseTo(PACE_BASE_SECONDS / turnDurationSeconds(turn), 10);
    }
    // 턴11: 13 - 0.3*10 = 10초 -> 정확히 1.3배속.
    expect(turnDurationSeconds(11)).toBe(10);
    expect(paceSpeedRatio(11)).toBeCloseTo(1.3, 5);
  });

  it('하한에서 최대 배속(13/2 = 6.5배)이 된다', () => {
    expect(paceSpeedRatio(turnAtFloor())).toBeCloseTo(PACE_MAX_SPEED_RATIO, 5);
    expect(paceSpeedRatio(9999)).toBeCloseTo(6.5, 5);
  });

  it('턴이 진행될수록 배속은 단조 증가한다', () => {
    let previous = paceSpeedRatio(1);
    for (let turn = 2; turn <= 50; turn += 1) {
      const current = paceSpeedRatio(turn);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});
