/**
 * 증분 빌드 지원.
 *
 * 소스마다 (1) 지문과 (2) 수집 결과 JSONL 을 캐시에 남긴다.
 * 다음 빌드에서 지문이 같으면 네트워크/디스크 재수집 없이 JSONL 을 다시 흘린다.
 * 원신 시드 한 줄만 고쳤을 때 위키백과 5천 건을 다시 긁지 않기 위한 장치다.
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type { RawEntry } from './types.js';

interface SourceState {
  fingerprint: string;
  count: number;
  collectedAt: string;
}

interface CacheState {
  version: number;
  sources: Record<string, SourceState>;
}

const STATE_VERSION = 1;

export class IncrementalCache {
  private state: CacheState = { version: STATE_VERSION, sources: {} };
  private readonly stateFile: string;
  private readonly collectedDir: string;

  constructor(private readonly cacheDir: string) {
    this.stateFile = path.join(cacheDir, 'state.json');
    this.collectedDir = path.join(cacheDir, 'collected');
  }

  async load(): Promise<void> {
    if (!existsSync(this.stateFile)) return;
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, 'utf8')) as CacheState;
      if (parsed.version === STATE_VERSION) this.state = parsed;
    } catch {
      // 손상된 상태 파일은 조용히 무시하고 전체 재수집으로 되돌아간다.
    }
  }

  async save(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.stateFile, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
  }

  private entriesFile(source: string): string {
    return path.join(this.collectedDir, `${source}.jsonl`);
  }

  /** 지문이 일치하고 캐시 파일도 있으면 재사용 가능하다. */
  isFresh(source: string, fingerprint: string): boolean {
    const state = this.state.sources[source];
    return (
      state !== undefined &&
      state.fingerprint === fingerprint &&
      existsSync(this.entriesFile(source))
    );
  }

  /** 캐시된 수집 결과를 스트리밍으로 되읽는다. */
  async *read(source: string): AsyncIterable<RawEntry> {
    const file = this.entriesFile(source);
    const reader = createInterface({
      input: createReadStream(file, 'utf8'),
      crlfDelay: Infinity,
    });
    for await (const line of reader) {
      if (!line) continue;
      yield JSON.parse(line) as RawEntry;
    }
  }

  /**
   * 소스의 수집 스트림을 그대로 흘려보내면서 캐시에 기록한다.
   * 임시 파일에 쓴 뒤 rename 해서 중간에 죽어도 반쪽 캐시가 남지 않게 한다.
   */
  async *write(
    source: string,
    fingerprint: string,
    entries: AsyncIterable<RawEntry>,
  ): AsyncIterable<RawEntry> {
    await mkdir(this.collectedDir, { recursive: true });
    const target = this.entriesFile(source);
    const temp = `${target}.tmp`;
    const stream = createWriteStream(temp, 'utf8');

    let count = 0;
    try {
      for await (const entry of entries) {
        count += 1;
        if (!stream.write(`${JSON.stringify(entry)}\n`)) {
          await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
        }
        yield entry;
      }
      await new Promise<void>((resolve, reject) => {
        stream.end((error?: Error) => (error ? reject(error) : resolve()));
      });
      await rename(temp, target);
      this.state.sources[source] = {
        fingerprint,
        count,
        collectedAt: new Date().toISOString(),
      };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  /** 캐시에 기록된 수집 건수(통계 표시용). */
  countOf(source: string): number {
    return this.state.sources[source]?.count ?? 0;
  }
}
