/**
 * 런타임 조회 스토어 — 게임 서버(Node)가 쓰는 쪽.
 *
 * 조회/판정 로직 자체는 DictionaryIndex 를 그대로 쓰고, 여기서는
 * "파일에서 어떻게 읽어오는가"(node:fs)만 더한다. 브라우저용은
 * src/service/browserStore.ts 의 BrowserDictionary(fetch 기반)를 쓴다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DictionaryEntry } from './types.js';
import { DictionaryIndex } from './dictionaryIndex.js';

export class DictionaryStore extends DictionaryIndex {
  static fromEntries(entries: DictionaryEntry[]): DictionaryStore {
    return new DictionaryStore(entries);
  }

  /** data/dist/dictionary.json 을 읽어 스토어를 만든다. */
  static async load(distDir: string): Promise<DictionaryStore> {
    const file = path.join(distDir, 'dictionary.json');
    const entries = JSON.parse(await readFile(file, 'utf8')) as DictionaryEntry[];
    return new DictionaryStore(entries);
  }
}

export type { NextCandidateOptions } from './dictionaryIndex.js';
