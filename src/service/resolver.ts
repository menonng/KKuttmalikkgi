/**
 * DictionaryResolver — 사전 조회 API 의 핵심.
 *
 * "이 단어가 유효한가?" 를 하나의 절차로 통일한다.
 *
 *   1. 형식 검증 (빈 값 / 너무 짧음 / 허용 문자 등) — 여기서 걸리면 네트워크도 안 탄다
 *   2. 빌드된 사전(DictionaryStore)에서 조회 — 있으면 즉시 'known'
 *   3. 조회 캐시 확인 — 이전에 온라인으로 확인/실패했던 기록
 *   4. 외부 프로바이더를 우선순위 순으로 조회 — 하나라도 확인되면 'resolved'
 *   5. 전부 실패하면 'unknown'
 *
 * 'resolved' 로 확정된 단어는 onLearn 훅으로 흘려보내
 * 다음 정식 빌드(dictbuild build --incremental)에 편입시킬 수 있게 한다.
 * 즉, 이 리졸버 자체가 "빌더가 놓친 단어를 채워 넣는 실시간 소스"다.
 */
import { normalizeWord, firstChar, lastChar } from '../core/normalize.js';
import { Validator, type ValidationConfig } from '../core/validate.js';
import { LoreEngine } from '../core/lore.js';
import { DEFAULT_VALIDATION, DEFAULT_MAX_LORE_LENGTH, DEFAULT_FALLBACK_LORE } from '../core/defaults.js';
import { chainHeads } from '../core/hangul.js';
import type { DictionaryEntry } from '../core/types.js';
import type {
  LearnHandler,
  LookupProvider,
  Resolution,
  ResolutionCache,
  TurnContext,
  TurnValidation,
} from './types.js';
import { pickLore } from './loreClassifier.js';

/** 최소한의 사전 조회 인터페이스 — DictionaryStore 가 이를 만족한다. */
export interface KnownWordSource {
  get(word: string): DictionaryEntry | undefined;
}

export interface DictionaryResolverOptions {
  /** 정식 빌드 산출물. 없어도(정적 시드 없이) 동작은 한다. */
  dictionary?: KnownWordSource;
  /** 우선순위 순으로 정렬해 저장한다(생성자가 정렬). */
  providers: LookupProvider[];
  cache?: ResolutionCache;
  validation?: ValidationConfig;
  onLearn?: LearnHandler;
  /** lore 최대 길이. */
  maxLoreLength?: number;
}

export class DictionaryResolver {
  private readonly dictionary: KnownWordSource | undefined;
  private readonly providers: LookupProvider[];
  private readonly cache: ResolutionCache | undefined;
  private readonly validator: Validator;
  private readonly loreEngine: LoreEngine;
  private readonly onLearn: LearnHandler | undefined;
  /** 동시에 같은 단어를 여러 번 조회하지 않도록 in-flight 요청을 공유한다. */
  private readonly inFlight = new Map<string, Promise<Resolution>>();

  constructor(options: DictionaryResolverOptions) {
    this.dictionary = options.dictionary;
    this.providers = [...options.providers].sort((a, b) => a.priority - b.priority);
    this.cache = options.cache;
    this.onLearn = options.onLearn;
    this.validator = new Validator(options.validation ?? DEFAULT_VALIDATION);
    this.loreEngine = new LoreEngine({
      maxLength: options.maxLoreLength ?? DEFAULT_MAX_LORE_LENGTH,
      fallback: DEFAULT_FALLBACK_LORE,
    });
  }

  /** 단어 하나를 판정한다. 존재 여부 + 사전 엔트리를 함께 돌려준다. */
  async resolve(rawWord: string): Promise<Resolution> {
    const started = Date.now();
    const word = normalizeWord(rawWord);

    const format = this.validator.validate(word);
    if (!format.ok) {
      return {
        status: 'invalid',
        word,
        origin: 'dictionary',
        reason: format.reason,
        code: format.code,
        elapsedMs: Date.now() - started,
      };
    }

    const known = this.dictionary?.get(word);
    if (known) {
      return { status: 'known', word, entry: known, origin: 'dictionary', elapsedMs: Date.now() - started };
    }

    // 동시에 들어온 같은 단어 조회는 하나의 네트워크 요청으로 합친다.
    const pending = this.inFlight.get(word);
    if (pending) return pending;

    const task = this.resolveOnline(word, started);
    this.inFlight.set(word, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(word);
    }
  }

  private async resolveOnline(word: string, started: number): Promise<Resolution> {
    const cached = await this.cache?.get(word);
    if (cached) return { ...cached, elapsedMs: Date.now() - started };

    const hits: Array<{ provider: LookupProvider; title: string; lore?: string }> = [];

    for (const provider of this.providers) {
      let hit;
      try {
        hit = await provider.lookup(word);
      } catch {
        continue; // 프로바이더 하나가 죽어도 나머지는 계속 시도한다.
      }
      if (!hit) continue;
      // 프로바이더가 확인한 표기가 입력과 정규화 후 다르면(동음이의 오탐 등) 버린다.
      if (normalizeWord(hit.title) !== word) continue;

      hits.push({
        provider,
        title: hit.title,
        ...(pickLore(hit.lore, provider.defaultLore) !== undefined
          ? { lore: pickLore(hit.lore, provider.defaultLore) }
          : {}),
      });
    }

    let resolution: Resolution;
    if (hits.length === 0) {
      resolution = {
        status: 'unknown',
        word,
        origin: 'online',
        reason: '등록된 사전과 외부 출처 어디에서도 확인되지 않았습니다.',
        elapsedMs: Date.now() - started,
      };
    } else {
      const entry = this.buildEntry(word, hits);
      resolution = { status: 'resolved', word, entry, origin: 'online', elapsedMs: Date.now() - started };
      if (this.onLearn) await this.onLearn(entry);
    }

    await this.cache?.set(word, resolution);
    return resolution;
  }

  private buildEntry(
    word: string,
    hits: Array<{ provider: LookupProvider; title: string; lore?: string }>,
  ): DictionaryEntry {
    hits.sort((a, b) => a.provider.priority - b.provider.priority);
    const display = hits[0]!.title;
    const lore = this.loreEngine.merge(hits.map((hit) => hit.lore));
    const sources = [...new Set(hits.map((hit) => hit.provider.id))];

    return {
      word: display,
      normalized: display,
      first: firstChar(display),
      last: lastChar(display),
      lore,
      sources,
    };
  }

  /**
   * 끝말잇기 한 턴을 판정한다: 존재 여부 + 중복 사용 + 앞 단어와의 연결까지.
   * 온라인 리졸브가 필요하면 자동으로 기다린다.
   */
  async validateTurn(rawWord: string, context: TurnContext = {}): Promise<TurnValidation> {
    const resolution = await this.resolve(rawWord);

    if (resolution.status === 'invalid') {
      return {
        valid: false,
        code: 'invalid_word',
        message: resolution.reason ?? '올바르지 않은 단어입니다.',
        resolution,
      };
    }
    if (resolution.status === 'unknown') {
      return {
        valid: false,
        code: 'unknown_word',
        message: '사전에 없는 단어입니다.',
        resolution,
      };
    }

    const entry = resolution.entry!;
    if (context.used?.has(entry.word)) {
      return {
        valid: false,
        code: 'already_used',
        message: '이미 사용한 단어입니다.',
        entry,
        resolution,
      };
    }

    if (context.previous) {
      const previous = this.dictionary?.get(context.previous) ?? (await this.resolve(context.previous)).entry;
      if (previous && !chainHeads(previous.last).includes(entry.first)) {
        return {
          valid: false,
          code: 'not_chained',
          message: `'${previous.last}'(으)로 시작하는 단어가 아닙니다.`,
          entry,
          resolution,
        };
      }
    }

    return { valid: true, code: 'ok', message: '통과', entry, resolution };
  }
}
