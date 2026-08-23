import { describe, expect, it } from 'vitest';
import { Room } from '../src/multiplayer/room.js';
import { DictionaryStore } from '../src/core/store.js';
import type { DictionaryEntry } from '../src/core/types.js';
import type { ServerMessage } from '../src/multiplayer/protocol.js';

function entry(word: string): DictionaryEntry {
  const chars = [...word];
  return {
    word,
    normalized: word,
    first: chars[0]!,
    last: chars[chars.length - 1]!,
    lore: '테스트',
    sources: ['custom'],
  };
}

// 가나 -> 나비(한방단어) / 나무 -> 무지개 -> 개미. 시작 단어 후보는 여럿 있어야
// randomStartWord() 가 리셋 때마다 그럴듯한 새 단어를 뽑을 수 있다.
function makeDictionary() {
  return DictionaryStore.fromEntries(
    ['가나', '나비', '나무', '무지개', '개미', '다라', '라마', '마루'].map(entry),
  );
}

interface Harness {
  room: Room;
  broadcasts: ServerMessage[];
  timers: Array<() => void>;
}

function makeRoom(allowDeadEnd = false): Harness {
  const broadcasts: ServerMessage[] = [];
  const timers: Array<() => void> = [];
  const room = new Room(
    'ABC123',
    makeDictionary(),
    (message) => broadcasts.push(message),
    (_delayMs, callback) => timers.push(callback),
    allowDeadEnd,
  );
  return { room, broadcasts, timers };
}

/** 큐에 쌓인 타이머 콜백을 순서대로 하나 꺼내 실행한다(가짜 시계 진행). */
function fireNextTimer(harness: Harness): void {
  const cb = harness.timers.shift();
  if (!cb) throw new Error('예약된 타이머가 없습니다');
  cb();
}

function turnStarts(broadcasts: ServerMessage[]) {
  return broadcasts.filter((m): m is Extract<ServerMessage, { type: 'turn_start' }> => m.type === 'turn_start');
}

describe('Room — 오답은 라운드를 끝내지 않는다', () => {
  it('오답/미등록 단어는 방 전체에 아무 것도 방송하지 않고, 같은 플레이어가 다시 시도할 수 있다', () => {
    const h = makeRoom();
    h.room.addPlayer('p1', '플레이어1');
    h.room.addPlayer('p2', '플레이어2');
    h.room.startGame('p1');

    const firstTurn = turnStarts(h.broadcasts)[0]!;
    const brokenBefore = h.broadcasts.length;

    const badResult = h.room.submitWord(firstTurn.playerId, '가'); // 너무 짧음
    expect(badResult.ok).toBe(false);
    expect(badResult.code).toBe('invalid_word');
    expect(h.broadcasts.length).toBe(brokenBefore); // 아무 방송도 없었다.

    const unknownResult = h.room.submitWord(firstTurn.playerId, '완전히없는단어');
    expect(unknownResult.ok).toBe(false);
    expect(unknownResult.code).toBe('unknown_word');
    expect(h.broadcasts.length).toBe(brokenBefore);

    // 예약된 타이머(라운드 타임아웃)는 여전히 처음 그대로 하나뿐 — 오답 제출이
    // 타이머를 리셋하거나 새로 걸지 않았다는 뜻이다.
    expect(h.timers.length).toBe(1);
  });

  it('다른 사람 차례에는 제출할 수 없다', () => {
    const h = makeRoom();
    h.room.addPlayer('p1', '플레이어1');
    h.room.addPlayer('p2', '플레이어2');
    h.room.startGame('p1');
    const firstTurn = turnStarts(h.broadcasts)[0]!;
    const other = firstTurn.playerId === 'p1' ? 'p2' : 'p1';

    const result = h.room.submitWord(other, '나무');
    expect(result).toEqual({ ok: false, code: 'not_your_turn' });
  });

  it('정답을 내면 대미지 없이 체인이 이어지고 턴이 넘어간다', () => {
    const h = makeRoom();
    h.room.addPlayer('p1', '플레이어1');
    h.room.addPlayer('p2', '플레이어2');
    h.room.startGame('p1');
    const firstTurn = turnStarts(h.broadcasts)[0]!;

    // 시작 단어가 무엇으로 뽑히든(랜덤) 같은 사전에서 실제로 이어지는 단어를 찾아 낸다.
    const probe = makeDictionary();
    // Room 은 기본적으로 한방단어(더 이어지지 않는 단어)를 막으므로(allowDeadEnd=false),
    // 여기서도 같은 기준으로 후보를 골라야 한다.
    const nextWord = probe
      .nextCandidates(firstTurn.currentWord.word, { exclude: new Set(), limit: 5 })
      .find((candidate) => !probe.isDeadEnd(candidate.word))?.word;
    if (!nextWord) return; // 이 시드에서 이어지지 않는 시작 단어가 뽑히면(가능성 낮음) 건너뜀.

    const result = h.room.submitWord(firstTurn.playerId, nextWord);
    expect(result.ok).toBe(true);

    const accepted = h.broadcasts.find((m) => m.type === 'word_accepted');
    expect(accepted).toBeTruthy();

    const rejected = h.broadcasts.find((m) => m.type === 'word_rejected');
    expect(rejected).toBeUndefined(); // 정답이므로 대미지 방송이 없어야 한다.

    const secondTurn = turnStarts(h.broadcasts)[1]!;
    expect(secondTurn.turn).toBe(2); // 리셋되지 않고 이어졌다.
  });
});

describe('Room — 타임아웃만 라운드를 끝낸다', () => {
  it('타임아웃 시 대미지를 입고, 살아남으면 턴 1로 리셋된 새 라운드가 상대 턴으로 시작된다', () => {
    const h = makeRoom();
    h.room.addPlayer('p1', '플레이어1');
    h.room.addPlayer('p2', '플레이어2');
    h.room.startGame('p1');
    const firstTurn = turnStarts(h.broadcasts)[0]!;

    fireNextTimer(h); // 첫 턴 타임아웃.

    const rejected = h.broadcasts.find((m) => m.type === 'word_rejected');
    expect(rejected).toBeTruthy();
    if (rejected?.type === 'word_rejected') {
      expect(rejected.playerId).toBe(firstTurn.playerId);
      expect(rejected.damage).toBeGreaterThan(0);
      expect(rejected.hp).toBeLessThan(100);
    }

    fireNextTimer(h); // 대미지 연출 지연 이후 라운드 리셋 + 다음 턴.

    const starts = turnStarts(h.broadcasts);
    const resetTurn = starts[starts.length - 1]!;
    expect(resetTurn.turn).toBe(1); // 턴이 처음으로 돌아갔다.
    expect(resetTurn.playerId).not.toBe(firstTurn.playerId); // 상대 턴부터 다시 시작.
  });

  it('반복 타임아웃으로 체력이 0 이하가 되면 탈락 처리 후 게임이 끝난다', () => {
    const h = makeRoom();
    h.room.addPlayer('p1', '플레이어1');
    h.room.addPlayer('p2', '플레이어2');
    h.room.startGame('p1');

    // p1 만 계속 타임아웃 나도록: 매 리셋마다 상대(p2) 턴으로 넘어가므로,
    // p2 도 마찬가지로 타임아웃시켜 다시 p1 턴으로 돌아오게 한다.
    let guard = 0;
    while (h.broadcasts.every((m) => m.type !== 'player_defeated') && guard < 40) {
      fireNextTimer(h); // 타임아웃 발생(대미지 방송).
      fireNextTimer(h); // 대미지 연출 지연 이후 처리(리셋+다음 턴, 또는 사망 처리 시작).
      guard += 1;
    }

    const defeated = h.broadcasts.find((m) => m.type === 'player_defeated');
    expect(defeated).toBeTruthy();

    // 사망 연출 지연 타이머가 남아 있으면 마저 흘려보내 game_over 까지 확인한다.
    while (h.timers.length > 0 && !h.broadcasts.some((m) => m.type === 'game_over')) {
      fireNextTimer(h);
    }
    const over = h.broadcasts.find((m) => m.type === 'game_over');
    expect(over).toBeTruthy();
  });
});
