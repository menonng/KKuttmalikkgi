/**
 * 사전 조회 서비스의 타입.
 *
 * 빌드된 사전(dictionary.json)에 없는 단어를 만났을 때
 * 외부 출처를 검색해 실재하는 단어인지 판정하고, 있으면 사전에 편입한다.
 * 브라우저(GitHub Pages)와 Node 서버 양쪽에서 같은 코드를 쓴다.
 */
import type { DictionaryEntry, RejectCode } from '../core/types.js';

/** 외부 출처 하나에서 확인된 단어. */
export interface ProviderHit {
  /** 출처에서 확인된 실제 표기(정규화 전). */
  title: string;
  /** 이 출처가 제공하는 설명. 없으면 프로바이더 기본 lore 를 쓴다. */
  lore?: string;
  /** 근거 URL. 클라이언트가 "출처 보기" 링크로 쓴다. */
  reference?: string;
}

/**
 * 외부 출처 조회기.
 *
 * 정확히 그 단어가 존재하는지만 판단한다.
 * 비슷한 단어를 억지로 맞추지 않는다 — 없으면 null 이 정답이다.
 */
export interface LookupProvider {
  /** 엔트리의 sources 에 기록될 id. */
  readonly id: string;
  readonly label: string;
  /** 낮을수록 우선. lore 와 sources 순서를 결정한다. */
  readonly priority: number;
  /** 항목이 설명을 주지 않을 때 쓰는 기본 lore. */
  readonly defaultLore?: string;
  lookup(word: string): Promise<ProviderHit | null>;
}

export type ResolutionStatus =
  /** 이미 빌드된 사전에 있음. */
  | 'known'
  /** 사전에 없었지만 외부 검색으로 실재가 확인됨. */
  | 'resolved'
  /** 어디에도 없음. */
  | 'unknown'
  /** 단어 형식 자체가 규칙 위반(빈 값, 너무 짧음, 허용되지 않는 문자 등). */
  | 'invalid';

export interface Resolution {
  status: ResolutionStatus;
  /** 정규화된 입력. */
  word: string;
  entry?: DictionaryEntry;
  /** 결과를 어디서 얻었는지. */
  origin: 'dictionary' | 'online' | 'cache';
  /** invalid / unknown 사유. */
  reason?: string;
  code?: RejectCode;
  /** 조회에 걸린 시간(ms). 서버 로그/클라이언트 표시용. */
  elapsedMs?: number;
}

/** 끝말잇기 한 턴 판정 결과. */
export interface TurnValidation {
  valid: boolean;
  code:
    | 'ok'
    | 'invalid_word'
    | 'unknown_word'
    | 'not_chained'
    | 'already_used';
  message: string;
  entry?: DictionaryEntry;
  resolution: Resolution;
}

export interface TurnContext {
  /** 직전 단어. 없으면 첫 턴이라 연결 검사를 건너뛴다. */
  previous?: string | null;
  /** 이미 사용된 단어들(정규화된 표기). */
  used?: ReadonlySet<string>;
}

/** 조회 결과 캐시. 긍정/부정 모두 저장해 같은 질의를 반복하지 않는다. */
export interface ResolutionCache {
  get(word: string): Promise<Resolution | null>;
  set(word: string, resolution: Resolution): Promise<void>;
}

/** 새로 확인된 단어를 영구 보관하는 훅(다음 빌드에 편입시키기 위함). */
export type LearnHandler = (entry: DictionaryEntry) => void | Promise<void>;
