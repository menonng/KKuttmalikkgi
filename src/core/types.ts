/**
 * 파이프라인 전역에서 쓰이는 데이터 모델.
 *
 * 흐름: RawEntry(소스 수집) -> 정규화/검증 -> DictionaryEntry(병합 결과) -> export
 */

/** 소스가 수집해서 내보내는 원시 항목. 정규화 이전 상태다. */
export interface RawEntry {
  /** 원본 표기. 공백/괄호 등이 남아 있어도 된다. */
  word: string;
  /** 이 항목에 대한 짧은 설명. 없으면 소스의 기본 lore가 쓰인다. */
  lore?: string;
  /** 수집 소스 id. 소스가 채우지 않으면 파이프라인이 채운다. */
  source?: string;
  /** 같은 대상의 다른 표기(별칭). 각각 독립 엔트리로 확장된다. */
  aliases?: string[];
  /** 분류 태그. 통계/필터용이며 export 형식에는 포함되지 않는다. */
  tags?: string[];
  /**
   * 품사(우리말샘 API 의 pos 필드 등). 알 수 없으면 비워둔다.
   * "동사"/"형용사"면 검증 단계에서 걸러진다 — 사전 인용형("먹다")은
   * 실제 대화에서 단독으로 쓰이는 단어가 아니라 끝말잇기에 부적합하다.
   */
  pos?: string;
  /** 소스별 부가 정보(원본 URL, 페이지 id 등). 디버깅/증분 빌드용. */
  extra?: Record<string, unknown>;
}

/** 병합까지 끝난 최종 사전 항목. dictionary.json 에 그대로 직렬화된다. */
export interface DictionaryEntry {
  /** 표시용 단어(= 정규화된 표기). */
  word: string;
  /** 정규화 형태. 현재 스키마에서는 word와 동일하지만 스키마 호환을 위해 유지한다. */
  normalized: string;
  /** 첫 글자 — 끝말잇기 앞말 매칭용. */
  first: string;
  /** 끝 글자 — 끝말잇기 뒷말 매칭용. */
  last: string;
  /** 짧은 설명. 여러 소스에서 온 경우 ", "로 이어진다. */
  lore: string;
  /** 이 단어를 제공한 소스 id 목록(우선순위 순). */
  sources: string[];
}

/** 검증에 걸려 버려진 항목. rejects.jsonl 로 남는다. */
export interface RejectedEntry {
  word: string;
  source: string;
  /** 기계 판독용 사유 코드. */
  code: RejectCode;
  /** 사람이 읽는 사유. */
  reason: string;
}

export type RejectCode =
  | 'empty'
  | 'punctuation_only'
  | 'too_short'
  | 'too_long'
  | 'illegal_characters'
  | 'blocked'
  | 'no_chain_head'
  | 'no_chain_tail'
  | 'excluded_pos';

/** 빌드 1회에 대한 요약 통계. manifest.json 에 기록된다. */
export interface BuildStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** 소스가 내놓은 원시 항목 수(별칭 전개 포함). */
  collected: number;
  /** 검증 통과 항목 수. */
  accepted: number;
  /** 검증 탈락 항목 수. */
  rejected: number;
  /** 중복 병합으로 사라진 항목 수. */
  merged: number;
  /** 최종 고유 단어 수. */
  total: number;
  perSource: Record<string, SourceStats>;
  rejectionsByCode: Record<string, number>;
}

export interface SourceStats {
  collected: number;
  accepted: number;
  rejected: number;
  /** 이 소스가 처음 발견한(다른 소스에 없던) 단어 수. */
  unique: number;
  /** 증분 빌드에서 캐시를 재사용했는지 여부. */
  cached: boolean;
  durationMs: number;
  error?: string;
}

/** 빌드 산출물 매니페스트. */
export interface BuildManifest {
  schemaVersion: number;
  builtAt: string;
  /** dictionary.json 의 sha256. 게임 서버가 갱신 여부를 싸게 판단할 수 있다. */
  checksum: string;
  entryCount: number;
  sources: string[];
  stats: BuildStats;
}
