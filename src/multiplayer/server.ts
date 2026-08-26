/**
 * 멀티플레이 WebSocket 서버.
 *
 * Room(순수 상태 머신, room.ts)들을 방 코드로 관리하고, 실제 소켓 연결/방송/
 * 개인화(수신자마다 다른 selfId)를 담당한다. 게임 판정 로직은 전혀 갖지
 * 않는다 — 그건 전부 Room 이 한다. 이 파일은:
 *
 *   - createMultiplayerServer(): 재사용 가능한 조립 함수(테스트/임베딩용).
 *   - 직접 실행되면(`tsx src/multiplayer/server.ts` 또는 빌드된
 *     dist/multiplayer/server.js 를 node 로) data/dist/dictionary.json 을
 *     읽어 곧바로 서버를 띄운다. PORT 환경변수로 포트를 바꿀 수 있다
 *     (Render/Fly.io 등은 대부분 PORT 를 주입한다).
 */
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { DictionaryStore } from '../core/store.js';
import { Room, SUBMIT_FAILURE_REASON } from './room.js';
import { generateRoomCode, normalizeRoomCode, isWellFormedRoomCode } from './roomCode.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

export interface MultiplayerServerOptions {
  /** 판정에 쓸 사전. 서버 프로세스당 한 번만 메모리에 올려 모든 방이 공유한다. */
  dictionary: DictionaryStore;
  /** 한방단어 허용 여부(모든 방 공통). 기본 false(설정에서 켤 수 있는 값과 동일 기본값). */
  allowDeadEnd?: boolean;
  /** ws.Server 옵션 그대로. port 또는 기존 http.Server(server) 중 하나를 준다. */
  port?: number;
  server?: import('node:http').Server;
}

export interface MultiplayerServerHandle {
  wss: WebSocketServer;
  /** 테스트/모니터링용 — 현재 열려 있는 방 수. */
  roomCount(): number;
  close(): Promise<void>;
}

interface Connection {
  id: string;
  socket: WebSocket;
  roomCode: string | null;
}

/** Room.submitWord 의 실패 코드를 사용자에게 보여줄 문구로 바꾼다. */
function submitFailureMessage(code: string | undefined): string {
  if (code && code in SUBMIT_FAILURE_REASON) {
    return SUBMIT_FAILURE_REASON[code as keyof typeof SUBMIT_FAILURE_REASON];
  }
  return '제출할 수 없습니다.';
}

/**
 * WebSocket 서버를 조립한다. 네트워크 배선만 하고 게임 로직은 Room 에 위임한다.
 */
export function createMultiplayerServer(options: MultiplayerServerOptions): MultiplayerServerHandle {
  const rooms = new Map<string, Room>();
  const connections = new Map<string, Connection>();
  const allowDeadEnd = options.allowDeadEnd ?? false;

  const wssOptions = options.server ? { server: options.server } : { port: options.port ?? 8787 };
  const wss = new WebSocketServer(wssOptions);

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function sendError(socket: WebSocket, message: string): void {
    send(socket, { type: 'error', message });
  }

  /** Room 이 요구하는 onBroadcast(msg, onlyTo?) — room_state 는 수신자별로 selfId 를 채워 보낸다. */
  function broadcastFor(code: string) {
    return (message: ServerMessage, onlyTo?: string[]): void => {
      for (const conn of connections.values()) {
        if (conn.roomCode !== code) continue;
        if (onlyTo && !onlyTo.includes(conn.id)) continue;
        if (message.type === 'room_state') {
          send(conn.socket, { ...message, selfId: conn.id });
        } else {
          send(conn.socket, message);
        }
      }
    };
  }

  function scheduleTimer(delayMs: number, callback: () => void): void {
    setTimeout(callback, Math.max(0, delayMs));
  }

  function getOrCreateRoom(code: string): Room {
    let room = rooms.get(code);
    if (!room) {
      room = new Room(code, options.dictionary, broadcastFor(code), scheduleTimer, allowDeadEnd);
      rooms.set(code, room);
    }
    return room;
  }

  function cleanupIfEmpty(code: string): void {
    const room = rooms.get(code);
    if (room && room.playerCount === 0) rooms.delete(code);
  }

  function newRoomCode(): string {
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();
    return code;
  }

  function handleMessage(connId: string, message: ClientMessage): void {
    const conn = connections.get(connId);
    if (!conn) return;

    switch (message.type) {
      case 'create_room': {
        if (conn.roomCode) {
          sendError(conn.socket, '이미 방에 들어가 있습니다.');
          return;
        }
        const code = newRoomCode();
        const room = getOrCreateRoom(code);
        // Room.addPlayer 는 성공하면 그 안에서 곧바로 room_state 를 방송한다
        // (broadcastFor(code) 가 connections 를 conn.roomCode === code 로 필터링
        // 하므로) — 그래서 addPlayer 를 부르기 "전에" 먼저 배정해 둬야 방금
        // 들어온 이 연결도 그 방송을 받는다. 실패하면 되돌린다.
        conn.roomCode = code;
        const result = room.addPlayer(connId, message.nickname);
        if (!result.ok) {
          conn.roomCode = null;
          cleanupIfEmpty(code);
          sendError(conn.socket, result.reason);
        }
        return;
      }

      case 'join_room': {
        if (conn.roomCode) {
          sendError(conn.socket, '이미 방에 들어가 있습니다.');
          return;
        }
        const code = normalizeRoomCode(message.code);
        const room = isWellFormedRoomCode(code) ? rooms.get(code) : undefined;
        if (!room) {
          sendError(conn.socket, '존재하지 않는 방 코드입니다.');
          return;
        }
        conn.roomCode = code; // 위 create_room 과 같은 이유로 addPlayer 전에 배정한다.
        const result = room.addPlayer(connId, message.nickname);
        if (!result.ok) {
          conn.roomCode = null;
          sendError(conn.socket, result.reason);
        }
        return;
      }

      case 'set_color': {
        const room = conn.roomCode ? rooms.get(conn.roomCode) : undefined;
        if (!room) return;
        const result = room.setColor(connId, message.hex);
        if (!result.ok) sendError(conn.socket, result.reason);
        return;
      }

      case 'set_ready': {
        const room = conn.roomCode ? rooms.get(conn.roomCode) : undefined;
        if (!room) return;
        const result = room.setReady(connId, message.ready);
        if (!result.ok) sendError(conn.socket, result.reason);
        return;
      }

      case 'start_game': {
        const room = conn.roomCode ? rooms.get(conn.roomCode) : undefined;
        if (!room) return;
        const result = room.startGame(connId);
        if (!result.ok) sendError(conn.socket, result.reason);
        return;
      }

      case 'submit_word': {
        const room = conn.roomCode ? rooms.get(conn.roomCode) : undefined;
        if (!room) return;
        // 실패(오답 등)는 room_state/word_rejected 처럼 방 전체로 방송되지
        // 않는다(단일 플레이 규칙과 동일 — 시간·체력에 영향 없는 무상태 재시도).
        // 그래서 실패 문구는 제출한 본인에게만 조용히 보낸다.
        const result = room.submitWord(connId, message.word);
        if (!result.ok) sendError(conn.socket, submitFailureMessage(result.code));
        return;
      }

      case 'leave_room': {
        if (!conn.roomCode) return;
        const code = conn.roomCode;
        rooms.get(code)?.disconnectPlayer(connId);
        conn.roomCode = null;
        cleanupIfEmpty(code);
        return;
      }

      default:
        return;
    }
  }

  wss.on('connection', (socket: WebSocket) => {
    const id = randomUUID();
    connections.set(id, { id, socket, roomCode: null });

    socket.on('message', (raw: RawData) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        sendError(socket, '잘못된 메시지 형식입니다.');
        return;
      }
      try {
        handleMessage(id, message);
      } catch (error) {
        // 메시지 하나 처리 중 예외가 나도 연결/서버 전체가 죽지 않게 막는다.
        console.error('[multiplayer] 메시지 처리 실패:', error);
        sendError(socket, '요청을 처리하지 못했습니다.');
      }
    });

    socket.on('close', () => {
      const conn = connections.get(id);
      if (conn?.roomCode) {
        const code = conn.roomCode;
        rooms.get(code)?.disconnectPlayer(id);
        cleanupIfEmpty(code);
      }
      connections.delete(id);
    });

    socket.on('error', () => {
      // 'close' 가 뒤이어 오므로 여기서는 별도 정리를 하지 않는다.
    });
  });

  return {
    wss,
    roomCount: () => rooms.size,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // wss.close() 는 "새 연결은 안 받되, 이미 열린 소켓은 알아서 끊기길"
        // 기다리기만 한다 — 클라이언트가 정상 종료 핸드셰이크 없이 그냥
        // 사라지면(브라우저 강제 종료 등) 영영 안 끝날 수 있으므로, 열려 있는
        // 소켓을 전부 강제로 끊어서 close() 가 확실히 끝나게 한다.
        for (const client of wss.clients) client.terminate();
        wss.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** `node dist/multiplayer/server.js` 로 직접 실행됐을 때만 서버를 띄운다(라이브러리로 import 될 땐 아무 것도 하지 않음). */
async function main(): Promise<void> {
  const distDir = process.env.KKUTTMAL_DIST_DIR ?? 'data/dist';
  const port = Number(process.env.PORT ?? 8787);
  const allowDeadEnd = process.env.KKUTTMAL_ALLOW_DEAD_END === 'true';

  const dictionary = await DictionaryStore.load(distDir);
  console.log(`[multiplayer] 사전 로드 완료: ${dictionary.size}건 (${distDir})`);

  const handle = createMultiplayerServer({ dictionary, allowDeadEnd, port });
  console.log(`[multiplayer] WebSocket 서버 대기 중 — ws://0.0.0.0:${port}`);

  const shutdown = async () => {
    console.log('[multiplayer] 종료 중…');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === new URL(`file://${entry}`).href;
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error('[multiplayer] 시작 실패:', error);
    process.exitCode = 1;
  });
}
