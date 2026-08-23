/**
 * 사용자 정의 소스.
 *
 * 운영 중에 "이 단어도 인정해 달라"는 요청을 받아 넣는 자리다.
 * 우선순위가 가장 높아(0) 다른 소스와 충돌하면 여기 표기와 lore 가 이긴다.
 * CLI 의 `dictbuild add` 가 이 파일을 갱신한다.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseDocument, YAMLSeq, Document } from 'yaml';
import { SeedSource } from './seedSource.js';
import type { SourceContext } from './types.js';
import type { RawEntry } from '../core/types.js';

export interface CustomEntryInput {
  word: string;
  lore?: string;
  tags?: string[];
}

export class CustomSource extends SeedSource {
  constructor() {
    super({
      name: 'custom',
      label: '사용자 정의',
      defaultPriority: 0,
    });
  }

  override async *collect(ctx: SourceContext): AsyncIterable<RawEntry> {
    const files = this.seedFiles(ctx);
    if (files.length === 0) {
      // 커스텀 시드가 없는 것은 정상이다(아직 아무도 추가하지 않은 상태).
      ctx.logger.debug(`${this.name}: 커스텀 시드 없음 — 건너뜁니다`);
      return;
    }
    yield* super.collect(ctx);
  }
}

/**
 * 커스텀 시드에 항목을 추가한다. 주석과 기존 서식을 보존하려고
 * 문서 트리(parseDocument)를 직접 다룬다.
 *
 * @returns 실제로 추가됐으면 true, 이미 있으면 false
 */
export async function appendCustomEntry(
  seedDir: string,
  entry: CustomEntryInput,
  fileName = 'custom.yaml',
): Promise<boolean> {
  const file = path.resolve(seedDir, fileName);
  await mkdir(path.dirname(file), { recursive: true });

  const doc = existsSync(file)
    ? parseDocument(await readFile(file, 'utf8'))
    : newCustomDocument();

  let entries = doc.get('entries');
  if (!(entries instanceof YAMLSeq)) {
    entries = new YAMLSeq();
    doc.set('entries', entries);
  }
  const seq = entries as YAMLSeq;

  const exists = seq.items.some((item) => {
    const value = doc.createNode(item).toJSON() as string | { word?: string };
    const word = typeof value === 'string' ? value : value?.word;
    return word === entry.word;
  });
  if (exists) return false;

  seq.add(
    doc.createNode({
      word: entry.word,
      ...(entry.lore ? { lore: entry.lore } : {}),
      ...(entry.tags?.length ? { tags: entry.tags } : {}),
    }),
  );

  await writeFile(file, doc.toString({ lineWidth: 0 }), 'utf8');
  return true;
}

function newCustomDocument(): Document {
  const doc = parseDocument('source: custom\nentries: []\n');
  doc.commentBefore = ' 사용자 정의 단어. dictbuild add 로 추가되거나 직접 편집한다.';
  return doc;
}
