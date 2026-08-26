/**
 * 방(Room) — 멀티플레이 한 판의 서버 권위 상태 머신.
 *
 * 이 클래스는 네트워크(WebSocket)를 전혀 모른다 — 순수하게 "메시지를 넣으면
 * 다음 상태와 방송할 이벤트가 나온다"만 담당한다. 그래서 서버 없이도(예:
 * 테스트에서) 완전히 검증할 수 있다. 실제 소켓 배선은 server.ts 가 한다.
 *
 * 단어 판정은 DictionaryIndex(빌드된 dictionary.json 을 메모리에 올린 것)를
 * 그대로 쓴다 — AI 대전과 완전히 같은 사전, 같은 두음법칙, 같은 "동사 제외"
 * 규칙이 적용된다.
 */
import type { DictionaryEntry } from '../core/types.js';
import type { DictionaryIndex } from '../core/dictionaryIndex.js';
import { turnDurationSeconds, paceSpeedRatio } from '../game/pace.js';
import {
  damageForTurn,
  hitPlan,
  estimateHitSequenceMs,
  DEATH_SEQUENCE_MS,
  ROUND_TRANSITION_MS,
  MAX_HP,
} from '../game/health.js';
import { pickRandomAvailableColor, isColorAvailable, type PaletteColor } from '../game/characterColor.js';
import type { PlayerView, RoomPhase, ServerMessage } from './protocol.js';

export interface RoomPlayer {
  id: string;
  nickname: string;
  color: PaletteColor;
  hp: number;
  alive: boolean;
  connected: boolean;
  /** 로비 "대기실"에서의 준비 상태. 게임이 시작되면 의미가 없어진다. */
  ready: boolean;
}

export type SubmitFailureCode =
  | 'not_your_turn'
  | 'invalid_word'
  | 'unknown_word'
  | 'already_used'
  | 'not_chained'
  | 'one_shot_blocked';

export interface SubmitResult {
  ok: boolean;
  /**
   * ok=false 일 때 사유 코드. 이 실패들은 전부 "다시 시도 가능"이다 — 시간도
   * 체력도 건드리지 않는다(단일 플레이 규칙과 동일: "단어를 한번 잘못
   * 입력해도 시간은 그대로 가고 체력도 깎이면 안돼"). 라운드를 끝내는 유일한
   * 사건은 타임아웃이며, 그건 submitWord 를 거치지 않고 서버 내부
   * 타이머(beginTurn)에서 바로 처리된다.
   */
  code?: SubmitFailureCode;
}

const MAX_PLAYERS = 8;
const MIN_PLAYERS_TO_START = 2;

export class Room {
  readonly code: string;
  private readonly players = new Map<string, RoomPlayer>();
  private hostId: string | null = null;
  private phase: RoomPhase = 'lobby';

  private turn = 1;
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private current: DictionaryEntry | null = null;
  private used = new Set<string>();

  /** onBroadcast(msg) 는 방 전체에, onBroadcast(msg, [id]) 는 그 id들에게만 보낸다. */
  constructor(
    code: string,
    private readonly dictionary: DictionaryIndex,
    private readonly onBroadcast: (message: ServerMessage, onlyTo?: string[]) => void,
    private readonly onScheduleTimer: (delayMs: number, callback: () => void) => void,
    private readonly allowDeadEnd = false,
  ) {
    this.code = code;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get currentPhase(): RoomPhase {
    return this.phase;
  }

  /** 새 플레이어를 로비에 추가한다. 방이 꽉 찼거나 이미 시작됐으면 실패. */
  addPlayer(id: string, nickname: string): { ok: true } | { ok: false; reason: string } {
    if (this.phase !== 'lobby') return { ok: false, reason: '이미 시작된 방입니다.' };
    if (this.players.size >= MAX_PLAYERS) return { ok: false, reason: '방이 가득 찼습니다.' };

    const color = pickRandomAvailableColor(new Set([...this.players.values()].map((p) => p.color.hex)));
    if (!color) return { ok: false, reason: '더 이상 배정할 색이 없습니다.' };

    this.players.set(id, {
      id,
      nickname: nickname.slice(0, 20) || `플레이어${this.players.size + 1}`,
      color,
      hp: MAX_HP,
      alive: true,
      connected: true,
      ready: false,
    });
    if (!this.hostId) this.hostId = id;
    this.broadcastRoomState();
    return { ok: true };
  }

  /** 접속이 끊긴 플레이어를 표시한다. 로비에서는 아예 제거한다. */
  disconnectPlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;

    if (this.phase === 'lobby') {
      this.players.delete(id);
      if (this.hostId === id) {
        this.hostId = this.players.keys().next().value ?? null;
      }
    } else {
      player.connected = false;
    }
    this.broadcastRoomState();
  }

  setColor(id: string, hex: string): { ok: true } | { ok: false; reason: string } {
    const player = this.players.get(id);
    if (!player || this.phase !== 'lobby') return { ok: false, reason: '지금은 색을 바꿀 수 없습니다.' };

    const others = new Set([...this.players.values()].filter((p) => p.id !== id).map((p) => p.color.hex));
    if (!isColorAvailable(hex, others)) return { ok: false, reason: '이미 다른 플레이어가 쓰는 색입니다.' };

    const palette = [...this.players.values()].find((p) => p.color.hex === hex);
    player.color = palette ? palette.color : { hex, eyeColor: '#ffffff' };
    this.broadcastRoomState();
    return { ok: true };
  }

  /** "대기실"에서 준비 상태를 토글한다. 다른 참가자 화면에도 즉시 반영된다. */
  setReady(id: string, ready: boolean): { ok: true } | { ok: false; reason: string } {
    const player = this.players.get(id);
    if (!player || this.phase !== 'lobby') return { ok: false, reason: '지금은 준비 상태를 바꿀 수 없습니다.' };
    player.ready = ready;
    this.broadcastRoomState();
    return { ok: true };
  }

  startGame(requesterId: string): { ok: true } | { ok: false; reason: string } {
    if (requesterId !== this.hostId) return { ok: false, reason: '방장만 시작할 수 있습니다.' };
    if (this.phase !== 'lobby') return { ok: false, reason: '이미 시작됐습니다.' };
    if (this.players.size < MIN_PLAYERS_TO_START) {
      return { ok: false, reason: `최소 ${MIN_PLAYERS_TO_START}명이 필요합니다.` };
    }

    const starter = pickStartWord(this.dictionary);
    if (!starter) return { ok: false, reason: '사전이 비어 있어 시작할 수 없습니다.' };

    this.phase = 'playing';
    this.turn = 1;
    this.turnOrder = shuffle([...this.players.keys()]);
    this.turnIndex = 0;
    this.current = starter;
    this.used = new Set([starter.word]);

    this.onBroadcast({ type: 'game_started', turnOrder: this.turnOrder });
    this.beginTurn();
    return { ok: true };
  }

  private beginTurn(): void {
    const playerId = this.turnOrder[this.turnIndex];
    if (!playerId || !this.current) return;

    const duration = turnDurationSeconds(this.turn);
    this.onBroadcast({
      type: 'turn_start',
      playerId,
      turn: this.turn,
      durationSeconds: duration,
      speedRatio: paceSpeedRatio(this.turn),
      currentWord: this.current,
    });

    this.onScheduleTimer(duration * 1000, () => {
      // 그 사이 다른 사유로 라운드가 이미 넘어갔으면(레이스) 아무 것도 하지 않는다.
      if (this.phase === 'playing' && this.turnOrder[this.turnIndex] === playerId) {
        this.handleTimeout(playerId);
      }
    });
  }

  /**
   * 단어 제출. 오답/미등록/이미 사용/한방단어 금지 등은 여기서 바로 실패를
   * 돌려줄 뿐 그 무엇도 바꾸지 않는다 — 턴도, current 도, used 도, 타이머도
   * 그대로다. server.ts 는 이 결과를 제출한 본인에게만 보내면 되고, 방
   * 전체에 방송할 이벤트는 없다(같은 단어로 다시 시도할 수 있어야 하므로).
   */
  submitWord(playerId: string, rawWord: string): SubmitResult {
    if (this.phase !== 'playing') return { ok: false, code: 'not_your_turn' };
    if (this.turnOrder[this.turnIndex] !== playerId) return { ok: false, code: 'not_your_turn' };

    const word = (rawWord ?? '').trim();
    const failure = this.validate(word);
    if (failure) return { ok: false, code: failure };

    const found = this.dictionary.get(word)!; // validate() 가 이미 존재를 확인했다.
    this.used.add(found.word);
    this.current = found;
    this.turn += 1;
    this.onBroadcast({ type: 'word_accepted', playerId, entry: found });
    this.advanceTurnOrder();
    this.beginTurn();
    return { ok: true };
  }

  private validate(word: string): SubmitFailureCode | null {
    if ([...word].length < 2) return 'invalid_word';
    const found = this.dictionary.get(word);
    if (!found) return 'unknown_word';
    if (this.used.has(found.word)) return 'already_used';
    if (this.current && !this.dictionary.canFollow(this.current.word, found.word)) return 'not_chained';
    if (!this.allowDeadEnd && this.dictionary.isDeadEnd(found.word)) return 'one_shot_blocked';
    return null;
  }

  /**
   * 타임아웃 — 유일하게 라운드를 끝내는 사건. 그 시점의 turn 기준으로 대미지를
   * 입힌다. 죽었으면 사망 처리로, 살아남았으면 라운드 리셋(새 무작위 시작
   * 단어 + 턴 1 + 배속 원래대로) 후 다음 라운드(상대 턴)로 넘어간다.
   */
  private handleTimeout(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const damage = damageForTurn(this.turn);
    player.hp = Math.max(0, player.hp - damage);
    this.onBroadcast({
      type: 'word_rejected',
      playerId,
      reason: FAILURE_REASON.timeout!,
      damage,
      hp: player.hp,
    });

    const delay = estimateHitSequenceMs(hitPlan(damage));

    if (player.hp <= 0) {
      player.alive = false;
      this.onScheduleTimer(delay, () => {
        this.onBroadcast({ type: 'player_defeated', playerId });
        this.onScheduleTimer(DEATH_SEQUENCE_MS, () => {
          this.advanceTurnOrder();
          this.afterDeathContinue();
        });
      });
      return;
    }

    // 살아남았을 때만 "라운드 전환" 페이싱을 적용한다 — 피격 연출 자체가 짧아도
    // (light 히트 등) 최소 ROUND_TRANSITION_MS(기본 5초)는 두고 다음 라운드로
    // 넘어간다("정신없다, 여유를 가지고 한 5초 정도로" 요구사항).
    this.onScheduleTimer(Math.max(delay, ROUND_TRANSITION_MS), () => {
      if (!this.resetRound()) return; // 사전이 비어 더 이상 시작 단어가 없으면 여기서 게임 종료.
      this.advanceTurnOrder();
      this.beginTurn();
    });
  }

  /** 새 무작위 시작 단어로 라운드를 리셋한다. 시작 단어를 못 찾으면 false. */
  private resetRound(): boolean {
    const starter = pickStartWord(this.dictionary);
    if (!starter) {
      this.phase = 'finished';
      this.onBroadcast({ type: 'game_over', winnerId: null });
      return false;
    }
    this.turn = 1;
    this.current = starter;
    this.used = new Set([starter.word]);
    return true;
  }

  private afterDeathContinue(): void {
    const aliveIds = [...this.players.values()].filter((p) => p.alive).map((p) => p.id);
    if (aliveIds.length <= 1) {
      this.phase = 'finished';
      this.onBroadcast({ type: 'game_over', winnerId: aliveIds[0] ?? null });
      return;
    }
    this.beginTurn();
  }

  /** turnOrder 를 그대로 순환하되, 탈락자는 건너뛴다. */
  private advanceTurnOrder(): void {
    if (this.turnOrder.length === 0) return;
    for (let i = 0; i < this.turnOrder.length; i += 1) {
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      const candidate = this.players.get(this.turnOrder[this.turnIndex]!);
      if (candidate?.alive) return;
    }
  }

  private broadcastRoomState(): void {
    const players: PlayerView[] = [];
    for (const player of this.players.values()) {
      players.push({
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        hp: player.hp,
        maxHp: MAX_HP,
        alive: player.alive,
        connected: player.connected,
        isHost: player.id === this.hostId,
        ready: player.ready,
      });
    }
    // selfId 는 수신자마다 달라야 하므로, server.ts 가 개인화해서 다시 보낸다.
    // 여기서는 우선 전체 상태만 만들어 콜백에 넘긴다(빈 selfId 는 서버가 채운다).
    this.onBroadcast({
      type: 'room_state',
      code: this.code,
      phase: this.phase,
      players,
      hostId: this.hostId ?? '',
      selfId: '',
    });
  }
}

/**
 * 실패 코드 -> 사용자에게 보여줄 한국어 문구. server.ts 가 submitWord 의
 * 실패 결과(제출한 사람에게만 보낼 에러)를 문구로 바꿀 때도 이걸 그대로 쓴다
 * — 문구를 두 곳에서 따로 관리하지 않게.
 */
export const SUBMIT_FAILURE_REASON: Record<SubmitFailureCode, string> = {
  not_your_turn: '지금은 당신의 차례가 아닙니다.',
  invalid_word: '너무 짧은 단어입니다.',
  unknown_word: '사전에 없는 단어입니다.',
  already_used: '이미 사용한 단어입니다.',
  not_chained: '끝말이 이어지지 않습니다.',
  one_shot_blocked: '한방단어는 허용되지 않습니다.',
};

const FAILURE_REASON: Record<'timeout', string> = {
  timeout: '시간 초과!',
};

function pickStartWord(dictionary: DictionaryIndex): DictionaryEntry | undefined {
  const withRandomStart = dictionary as DictionaryIndex & { randomStartWord?: () => DictionaryEntry | undefined };
  return withRandomStart.randomStartWord?.() ?? dictionary.random();
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
