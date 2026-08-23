import { describe, expect, it } from 'vitest';
import { generateRoomCode, isWellFormedRoomCode, normalizeRoomCode } from '../src/multiplayer/roomCode.js';
import { ROOM_CODE_LENGTH } from '../src/multiplayer/protocol.js';

describe('generateRoomCode', () => {
  it(`길이 ${ROOM_CODE_LENGTH}자를 생성한다`, () => {
    expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('혼동되는 문자(0, O, 1, I)를 쓰지 않는다', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateRoomCode()).not.toMatch(/[01OI]/u);
    }
  });

  it('시드된 난수 함수로 결정적으로 생성할 수 있다', () => {
    const random = () => 0;
    expect(generateRoomCode(random)).toBe('A'.repeat(ROOM_CODE_LENGTH));
  });
});

describe('normalizeRoomCode', () => {
  it('공백을 제거하고 대문자화한다', () => {
    expect(normalizeRoomCode('  abcd23  ')).toBe('ABCD23');
  });

  it('허용되지 않는 문자를 제거한다', () => {
    expect(normalizeRoomCode('ab-cd 23!')).toBe('ABCD23');
  });
});

describe('isWellFormedRoomCode', () => {
  it('생성된 코드는 항상 유효하다', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isWellFormedRoomCode(generateRoomCode())).toBe(true);
    }
  });

  it('길이가 다르거나 금지 문자가 있으면 무효', () => {
    expect(isWellFormedRoomCode('ABCDE')).toBe(false);
    expect(isWellFormedRoomCode('ABCDE0')).toBe(false);
    expect(isWellFormedRoomCode('ABCDEI')).toBe(false);
  });
});
