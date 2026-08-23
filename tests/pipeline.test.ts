import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/core/pipeline.js';
import { Logger } from '../src/core/logger.js';
import type { DictionaryEntry } from '../src/core/types.js';
import type { DictionaryIndex } from '../src/core/export.js';

const logger = new Logger('silent');
let root: string;

/** 저장소 데이터와 격리된 임시 프로젝트를 만든다. */
async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dictbuild-'));
  await mkdir(path.join(dir, 'data/seeds'), { recursive: true });
  await mkdir(path.join(dir, 'config'), { recursive: true });

  await writeFile(
    path.join(dir, 'data/seeds/genshin.yaml'),
    'source: genshin\nlore: 원신\nentries:\n  - word: 모락스\n    aliases: [종려]\n  - 벤티\n  - 컵\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'data/seeds/ars_goetia.yaml'),
    'source: ars_goetia\nlore: 악마학\nentries:\n  - 모락스\n  - 바엘\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'data/seeds/light_novel.yaml'),
    'source: light_novel\nlore: 라이트노벨\nentries:\n  - 리 제로부터 시작하는 이세계 생활\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'config/builder.config.json'),
    JSON.stringify({
      sources: {
        genshin: { enabled: true, priority: 10, lore: '원신' },
        ars_goetia: { enabled: true, priority: 20, lore: '악마학' },
        light_novel: { enabled: true, priority: 50, lore: '라이트노벨' },
      },
    }),
    'utf8',
  );
  return dir;
}

beforeEach(async () => {
  root = await fixture();
});

afterEach(() => {
  process.chdir(process.cwd());
});

const only = ['genshin', 'ars_goetia', 'light_novel'];

describe('build 파이프라인', () => {
  it('수집 → 정규화 → 검증 → 병합 → 내보내기를 끝까지 수행한다', async () => {
    const result = await build({ rootDir: root, only, logger });

    const words = result.entries.map((entry) => entry.word);
    expect(words).toContain('모락스');
    expect(words).toContain('종려');
    expect(words).toContain('리제로부터시작하는이세계생활');
    // 한 글자는 검증에서 탈락한다.
    expect(words).not.toContain('컵');
    expect(result.stats.rejectionsByCode['too_short']).toBe(1);
  });

  it('여러 소스의 같은 단어를 하나로 병합한다', async () => {
    const result = await build({ rootDir: root, only, logger });
    const morax = result.entries.find((entry) => entry.word === '모락스');

    expect(morax).toEqual({
      word: '모락스',
      normalized: '모락스',
      first: '모',
      last: '스',
      lore: '원신, 악마학',
      sources: ['genshin', 'ars_goetia'],
    });
  });

  it('산출물 파일을 모두 만든다', async () => {
    const result = await build({ rootDir: root, only, logger });
    const dist = path.join(root, 'data/dist');

    const entries = JSON.parse(
      await readFile(path.join(dist, 'dictionary.json'), 'utf8'),
    ) as DictionaryEntry[];
    expect(entries.length).toBe(result.entries.length);

    const index = JSON.parse(
      await readFile(path.join(dist, 'dictionary.index.json'), 'utf8'),
    ) as DictionaryIndex;
    expect(index.count).toBe(entries.length);
    expect(index.byFirst['모']).toBeDefined();

    const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.entryCount).toBe(entries.length);
  });

  it('두 번 빌드해도 결과가 동일하다(결정적 출력)', async () => {
    const first = await build({ rootDir: root, only, logger });
    const second = await build({ rootDir: root, only, logger });
    expect(second.entries).toEqual(first.entries);
    expect(second.manifest?.checksum).toBe(first.manifest?.checksum);
  });

  it('증분 빌드에서 변경 없는 소스는 캐시를 재사용한다', async () => {
    await build({ rootDir: root, only, incremental: true, logger });
    const second = await build({ rootDir: root, only, incremental: true, logger });

    expect(second.stats.perSource['genshin']?.cached).toBe(true);
    expect(second.entries.length).toBeGreaterThan(0);
  });

  it('시드가 바뀌면 그 소스만 다시 수집한다', async () => {
    await build({ rootDir: root, only, incremental: true, logger });
    await writeFile(
      path.join(root, 'data/seeds/genshin.yaml'),
      'source: genshin\nlore: 원신\nentries:\n  - 벤티\n  - 나히다\n',
      'utf8',
    );

    const second = await build({ rootDir: root, only, incremental: true, logger });
    expect(second.stats.perSource['genshin']?.cached).toBe(false);
    expect(second.stats.perSource['ars_goetia']?.cached).toBe(true);
    expect(second.entries.map((entry) => entry.word)).toContain('나히다');
  });

  it('dry-run 은 파일을 쓰지 않는다', async () => {
    const result = await build({ rootDir: root, only, dryRun: true, logger });
    expect(result.manifest).toBeUndefined();
    await expect(
      readFile(path.join(root, 'data/dist/dictionary.json'), 'utf8'),
    ).rejects.toThrow();
  });
});
