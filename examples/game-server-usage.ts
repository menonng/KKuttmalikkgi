/**
 * 예제: 멀티플레이 서버에서 사전 쓰기
 *
 *   npx tsx examples/game-server-usage.ts
 *
 * 서버는 빌드 산출물을 프로세스 시작 시 한 번 올리고,
 * 매 턴 판정은 메모리 Map 조회로만 처리한다.
 */
import path from 'node:path';
import { DictionaryStore } from '../src/core/store.js';

/** 한 판의 진행 상태. 실제 서버에서는 방(room)마다 하나씩 들고 있게 된다. */
interface GameState {
  used: Set<string>;
  lastWord: string | null;
}

type TurnResult =
  | { ok: true; word: string; lore: string }
  | { ok: false; reason: string };

function playTurn(store: DictionaryStore, state: GameState, input: string): TurnResult {
  const entry = store.get(input);
  if (!entry) return { ok: false, reason: '사전에 없는 단어입니다.' };
  if (state.used.has(entry.word)) return { ok: false, reason: '이미 사용한 단어입니다.' };
  if (state.lastWord && !store.canFollow(state.lastWord, entry.word)) {
    return { ok: false, reason: '끝말이 이어지지 않습니다.' };
  }

  state.used.add(entry.word);
  state.lastWord = entry.word;
  return { ok: true, word: entry.word, lore: entry.lore };
}

async function main(): Promise<void> {
  // 서버 부팅 시 1회. 10만 엔트리도 수백 ms 면 올라간다.
  const store = await DictionaryStore.load(path.resolve('data/dist'));
  console.log(`사전 로드 완료: ${store.size.toLocaleString('ko-KR')}건`);

  const state: GameState = { used: new Set(), lastWord: null };

  // 플레이어 입력에 공백이 섞여 있어도 정규화해서 판정한다.
  for (const input of ['벤티', '티라미수', '수박', '리 제로부터 시작하는 이세계 생활']) {
    const result = playTurn(store, state, input);
    console.log(
      result.ok
        ? `O ${input} -> ${result.word} (${result.lore})`
        : `X ${input} -> ${result.reason}`,
    );
  }

  // 봇 차례: 다음에 낼 수 있는 단어 후보를 사전에서 바로 받는다.
  if (state.lastWord) {
    const candidates = store.nextCandidates(state.lastWord, {
      exclude: state.used,
      limit: 5,
    });
    console.log(
      `봇 후보(${state.lastWord} 다음): ${candidates.map((entry) => entry.word).join(', ') || '없음'}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
