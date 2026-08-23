/**
 * 턴 진행 속도(pace) 엔진.
 *
 * 규칙: 턴 제한 시간은 13초에서 시작해 턴마다 0.3초씩 줄어들고 최소 2초에서 멈춘다.
 * 배경음악 재생 속도와 특수 단어 연출 속도는 이 시간 단축과 "같은 비율"로 빨라진다 —
 * 제한시간이 절반이 되면 BGM/연출도 정확히 2배 빨라진다.
 *
 * 순수 함수만 모아둔 모듈이라 Node(서버/테스트)와 브라우저 어디서나 그대로 쓴다.
 * (dist/game/pace.js 는 node: 의존이 전혀 없어 <script>에서 import() 로 바로 로드된다.)
 */

/** 첫 턴 제한 시간(초). */
export const PACE_BASE_SECONDS = 13;
/** 턴마다 줄어드는 시간(초). */
export const PACE_STEP_SECONDS = 0.3;
/** 더 이상 줄어들지 않는 하한(초). */
export const PACE_MIN_SECONDS = 2;

/** 반복 뺄셈으로 생기는 부동소수점 오차(12.699999999999998 등)를 지운다. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * turn 번째 턴의 제한 시간(초). turn 은 1부터 시작한다.
 *
 *   turnDurationSeconds(1)  -> 13
 *   turnDurationSeconds(2)  -> 12.7
 *   turnDurationSeconds(38) -> 2   (그 이후로도 계속 2)
 */
export function turnDurationSeconds(turn: number): number {
  const safeTurn = Number.isFinite(turn) && turn >= 1 ? turn : 1;
  const raw = PACE_BASE_SECONDS - PACE_STEP_SECONDS * (safeTurn - 1);
  return Math.max(PACE_MIN_SECONDS, round1(raw));
}

/**
 * 첫 턴 대비 지금 턴이 몇 배 빨라졌는지. 1.0(첫 턴) ~ PACE_BASE_SECONDS/PACE_MIN_SECONDS(하한 도달) 사이.
 * BGM 의 `audio.playbackRate` 와 특수 단어 연출의 애니메이션 배속에 그대로 곱한다.
 */
export function paceSpeedRatio(turn: number): number {
  return PACE_BASE_SECONDS / turnDurationSeconds(turn);
}

/** 제한 시간이 처음으로 하한(2초)에 도달하는 턴 번호. */
export function turnAtFloor(): number {
  return Math.ceil((PACE_BASE_SECONDS - PACE_MIN_SECONDS) / PACE_STEP_SECONDS) + 1;
}

/** 최대 배속(하한에서의 speedRatio). BGM/연출 쪽에서 상한 표시용으로 쓸 수 있다. */
export const PACE_MAX_SPEED_RATIO = PACE_BASE_SECONDS / PACE_MIN_SECONDS;
