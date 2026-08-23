/**
 * 방 코드 생성/정규화.
 *
 * 알파벳에서 혼동되는 문자(0, O, 1, I)를 아예 빼서, 코드 자체에 그런 모호함이
 * 생기지 않게 한다 — 그래서 정규화는 대문자화 + 공백 제거만 하면 충분하다.
 * 순수 함수라 서버(Node)와 테스트 어디서나 그대로 쓴다.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './protocol.js';

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** 사용자가 붙여넣거나 입력한 방 코드를 비교 가능한 형태로 정규화한다. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

/** 코드가 우리가 생성하는 형식(길이 + 허용 문자)과 맞는지. */
export function isWellFormedRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}
