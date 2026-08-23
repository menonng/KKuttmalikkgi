/**
 * 소스 레지스트리.
 *
 * sources/index.ts 가 모든 소스를 등록하고, 파이프라인은 여기서만 소스를 얻는다.
 * 덕분에 소스 파일 하나를 추가하는 것만으로 파이프라인이 확장된다.
 */
import type { DictionarySource } from './types.js';
import type { BuilderConfig } from '../core/config.js';
import { sourceConfigOf } from '../core/config.js';

const registry = new Map<string, DictionarySource>();

export function registerSource(source: DictionarySource): DictionarySource {
  if (registry.has(source.name)) {
    throw new Error(`소스 id 중복: ${source.name}`);
  }
  registry.set(source.name, source);
  return source;
}

export function getSource(name: string): DictionarySource | undefined {
  return registry.get(name);
}

export function allSources(): DictionarySource[] {
  return [...registry.values()];
}

/**
 * 설정에서 활성화된 소스를 우선순위 순으로 돌려준다.
 * @param only 지정하면 이 목록에 있는 소스만 사용한다(부분 빌드용).
 */
export function resolveSources(config: BuilderConfig, only?: string[]): DictionarySource[] {
  const filter = only && only.length > 0 ? new Set(only) : null;

  const selected = allSources().filter((source) => {
    if (filter) return filter.has(source.name);
    return sourceConfigOf(config, source.name, source.defaultPriority).enabled !== false;
  });

  if (filter) {
    for (const name of filter) {
      if (!registry.has(name)) throw new Error(`알 수 없는 소스: ${name}`);
    }
  }

  return selected.sort(
    (a, b) =>
      sourceConfigOf(config, a.name, a.defaultPriority).priority -
        sourceConfigOf(config, b.name, b.defaultPriority).priority ||
      a.name.localeCompare(b.name),
  );
}

/** 테스트에서 레지스트리를 격리하기 위한 용도. */
export function clearRegistry(): void {
  registry.clear();
}
