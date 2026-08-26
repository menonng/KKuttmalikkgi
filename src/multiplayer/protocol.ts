/**
 * 멀티플레이 WebSocket 메시지 프로토콜.
 *
 * 서버(src/multiplayer/server.ts, Node)와 클라이언트(web/index.html) 양쪽이
 * 이 파일을 그대로 가져다 쓴다 — dist/multiplayer/protocol.js 는 node: 의존이
 * 없는 순수 타입/상수 파일이라 브라우저에서 <script>로 바로 import() 된다.
 *
 * 서버가 게임 상태의 유일한 권위자다(authoritative). 클라이언트는 입력만
 * 보내고, 결과는 항상 서버가 방송(broadcast)한 상태 메시지로만 반영한다.
 */
import type { DictionaryEntry } from '../core/types.js';

export const PROTOCOL_VERSION = 1;

/** 방 코드 형식: 대문자+숫자 6자(혼동되는 0/O, 1/I 는 뺀다). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface PlayerView {
  id: string;
  nickname: string;
  color: PaletteColorLike;
  hp: number;
  maxHp: number;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  /** "대기실"에서의 준비 상태(로비 전용 — 게임이 시작되면 의미가 없어진다). */
  ready: boolean;
}

/** characterColor.ts 의 PaletteColor 와 같은 모양이지만 순환 의존을 피하려 별도 선언. */
export interface PaletteColorLike {
  hex: string;
  eyeColor: string;
}

export interface RoomStateMessage {
  type: 'room_state';
  code: string;
  phase: RoomPhase;
  players: PlayerView[];
  hostId: string;
  /** 이 값을 받는 클라이언트 자신의 플레이어 id. */
  selfId: string;
}

export interface GameStartedMessage {
  type: 'game_started';
  turnOrder: string[];
}

export interface TurnStartMessage {
  type: 'turn_start';
  playerId: string;
  turn: number;
  durationSeconds: number;
  speedRatio: number;
  currentWord: DictionaryEntry;
}

export interface WordAcceptedMessage {
  type: 'word_accepted';
  playerId: string;
  entry: DictionaryEntry;
}

/**
 * 라운드가 끝났음을 알리는 방송(타임아웃 전용). 오답/미등록 등 "다시 시도
 * 가능한" 실패는 이 메시지를 타지 않는다 — submitWord 가 그 자리에서
 * SubmitResult 실패를 돌려주고 방 전체엔 아무 것도 방송되지 않는다
 * (시간도 체력도 그대로 두고 같은 단어로 재시도할 수 있어야 하므로).
 */
export interface WordRejectedMessage {
  type: 'word_rejected';
  playerId: string;
  reason: string;
  damage: number;
  hp: number;
}

export interface PlayerDefeatedMessage {
  type: 'player_defeated';
  playerId: string;
}

export interface GameOverMessage {
  type: 'game_over';
  winnerId: string | null;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | RoomStateMessage
  | GameStartedMessage
  | TurnStartMessage
  | WordAcceptedMessage
  | WordRejectedMessage
  | PlayerDefeatedMessage
  | GameOverMessage
  | ErrorMessage;

export interface CreateRoomMessage {
  type: 'create_room';
  nickname: string;
}

export interface JoinRoomMessage {
  type: 'join_room';
  code: string;
  nickname: string;
}

export interface SetColorMessage {
  type: 'set_color';
  hex: string;
}

export interface SetReadyMessage {
  type: 'set_ready';
  ready: boolean;
}

export interface StartGameMessage {
  type: 'start_game';
}

export interface SubmitWordMessage {
  type: 'submit_word';
  word: string;
}

export interface LeaveRoomMessage {
  type: 'leave_room';
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | SetColorMessage
  | SetReadyMessage
  | StartGameMessage
  | SubmitWordMessage
  | LeaveRoomMessage;
