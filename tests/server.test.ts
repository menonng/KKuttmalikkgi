import { describe, expect, it, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createMultiplayerServer, type MultiplayerServerHandle } from '../src/multiplayer/server.js';
import { DictionaryStore } from '../src/core/store.js';
import type { DictionaryEntry } from '../src/core/types.js';
import type { ClientMessage, ServerMessage } from '../src/multiplayer/protocol.js';

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

function makeDictionary() {
  return DictionaryStore.fromEntries(
    ['가나', '나비', '나무', '무지개', '개미', '다라', '라마', '마루'].map(entry),
  );
}

let handle: MultiplayerServerHandle | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  if (handle) {
    await handle.close();
    handle = null;
  }
});

async function startServer(): Promise<number> {
  handle = createMultiplayerServer({ dictionary: makeDictionary(), port: 0 });
  await new Promise<void>((resolve) => handle!.wss.once('listening', resolve));
  const address = handle.wss.address();
  if (typeof address === 'string' || !address) throw new Error('포트를 확인할 수 없습니다');
  return address.port;
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * type 이 일치하는 다음 메시지가 올 때까지 기다린다(중간에 다른 메시지가 껴도 무시).
 *
 * 반드시 그 메시지를 유발하는 send 호출보다 "먼저" 호출해 리스너를 걸어 둬야
 * 한다 — 서버가 한 액션에 대해 여러 소켓에 같은 동기 구간에서 함께 방송하는
 * 경우가 많은데, 리스너를 늦게 달면 그사이 이미 지나가 버린 이벤트를 영영
 * 못 받는다(EventEmitter 는 재생을 안 해준다).
 */
function waitFor(socket: WebSocket, type: ServerMessage['type']): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type === type) {
        socket.off('message', onMessage);
        resolve(message);
      }
    };
    socket.on('message', onMessage);
  });
}

function sendMsg(socket: WebSocket, message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

describe('createMultiplayerServer', () => {
  it('방을 만들고 다른 사람이 코드로 들어올 수 있다', async () => {
    const port = await startServer();
    const host = await connect(port);
    const guest = await connect(port);

    const hostStatePromise = waitFor(host, 'room_state');
    sendMsg(host, { type: 'create_room', nickname: '방장' });
    const hostState = (await hostStatePromise) as Extract<ServerMessage, { type: 'room_state' }>;
    expect(hostState.players).toHaveLength(1);
    expect(hostState.selfId).toBe(hostState.hostId);

    // 손님이 들어오면 방장/손님 양쪽에 각자 개인화된 room_state 가 함께
    // 방송되므로, 두 리스너를 먼저 걸어 둔 뒤에 join_room 을 보낸다.
    const guestStatePromise = waitFor(guest, 'room_state');
    const hostState2Promise = waitFor(host, 'room_state');
    sendMsg(guest, { type: 'join_room', code: hostState.code, nickname: '손님' });

    const guestState = (await guestStatePromise) as Extract<ServerMessage, { type: 'room_state' }>;
    expect(guestState.players).toHaveLength(2);
    expect(guestState.selfId).not.toBe(guestState.hostId); // 손님은 방장이 아니다.

    const hostState2 = (await hostState2Promise) as Extract<ServerMessage, { type: 'room_state' }>;
    expect(hostState2.players).toHaveLength(2);
  });

  it('존재하지 않는 방 코드는 에러를 받는다', async () => {
    const port = await startServer();
    const guest = await connect(port);
    const errorPromise = waitFor(guest, 'error');
    sendMsg(guest, { type: 'join_room', code: 'ZZZZZZ', nickname: '손님' });
    const error = (await errorPromise) as Extract<ServerMessage, { type: 'error' }>;
    expect(error.message).toContain('존재하지 않는');
  });

  it('방장만 게임을 시작할 수 있고, 시작하면 각자에게 개인화된 room_state 와 game_started 가 온다', async () => {
    const port = await startServer();
    const host = await connect(port);
    const guest = await connect(port);

    const hostStatePromise = waitFor(host, 'room_state');
    sendMsg(host, { type: 'create_room', nickname: '방장' });
    const hostState = (await hostStatePromise) as Extract<ServerMessage, { type: 'room_state' }>;

    const guestStatePromise = waitFor(guest, 'room_state');
    const hostJoinedPromise = waitFor(host, 'room_state');
    sendMsg(guest, { type: 'join_room', code: hostState.code, nickname: '손님' });
    await guestStatePromise;
    await hostJoinedPromise;

    // 손님이 시작을 시도하면 거부된다.
    const rejectedPromise = waitFor(guest, 'error');
    sendMsg(guest, { type: 'start_game' });
    const rejected = (await rejectedPromise) as Extract<ServerMessage, { type: 'error' }>;
    expect(rejected.message).toContain('방장만');

    const startedPromise = waitFor(host, 'game_started');
    const guestStartedPromise = waitFor(guest, 'game_started');
    const turnStartPromise = waitFor(host, 'turn_start');
    sendMsg(host, { type: 'start_game' });

    const started = (await startedPromise) as Extract<ServerMessage, { type: 'game_started' }>;
    expect(started.turnOrder).toHaveLength(2);
    await guestStartedPromise;

    const turnStart = (await turnStartPromise) as Extract<ServerMessage, { type: 'turn_start' }>;
    expect(started.turnOrder[0]).toBe(turnStart.playerId);
  });

  it('오답 제출은 제출한 사람에게만 에러가 가고 라운드는 그대로다', async () => {
    const port = await startServer();
    const host = await connect(port);
    const guest = await connect(port);

    const hostStatePromise = waitFor(host, 'room_state');
    sendMsg(host, { type: 'create_room', nickname: '방장' });
    const hostState = (await hostStatePromise) as Extract<ServerMessage, { type: 'room_state' }>;

    const guestStatePromise = waitFor(guest, 'room_state');
    const hostJoinedPromise = waitFor(host, 'room_state');
    sendMsg(guest, { type: 'join_room', code: hostState.code, nickname: '손님' });
    await guestStatePromise;
    await hostJoinedPromise;

    const startedPromise = waitFor(host, 'game_started');
    const guestStartedPromise = waitFor(guest, 'game_started');
    const turnStartPromise = waitFor(host, 'turn_start');
    sendMsg(host, { type: 'start_game' });
    const started = (await startedPromise) as Extract<ServerMessage, { type: 'game_started' }>;
    await guestStartedPromise;
    const turnStart = (await turnStartPromise) as Extract<ServerMessage, { type: 'turn_start' }>;

    const firstSocket = started.turnOrder[0] === hostState.selfId ? host : guest;
    const errorPromise = waitFor(firstSocket, 'error');
    sendMsg(firstSocket, { type: 'submit_word', word: '가' }); // 너무 짧음 -> 실패.
    const error = (await errorPromise) as Extract<ServerMessage, { type: 'error' }>;
    expect(error.message).toBeTruthy();
    expect(turnStart.turn).toBe(1); // 오답으로 턴이 바뀌지 않았다(원래 turn_start 그대로).
  });
});
