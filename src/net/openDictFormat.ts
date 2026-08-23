/**
 * 우리말샘 오픈 API 응답을 lore 문구로 바꾸는 공통 로직.
 *
 * 표준국어대사전/우리말샘은 표제어를 두 단계로 번호 매긴다.
 *  - 동음이의어 번호(sup_no, "큰 숫자") — 표기는 같지만 어원이 다른 별개의 단어.
 *    예: 배01(신체 부위), 배02(과일), 배03(교통수단) — 화면에서 "배¹·배²·배³" 로 표시되는 것.
 *  - 뜻풀이 번호(sense_no, "작은 숫자") — 동음이의어 하나 안에서 갈라지는 다의어 뜻.
 *    예: 배02 안의 「1」과일, 「2」배나무.
 *
 * 규칙:
 *  - 동음이의어(큰 숫자)가 여러 개면, 각 동음이의어의 대표 뜻(1번 뜻)을 최대 3개 모아 쓴다.
 *  - 동음이의어가 하나뿐이면, 그 안의 뜻(작은 숫자)을 최대 3개까지 모아 쓴다.
 *  - 둘 다 하나뿐이면(가장 흔한 경우) 번호 없이 뜻풀이 하나만 그대로 쓴다.
 */

export interface OpenDictSense {
  sense_no?: string;
  definition?: string;
  /** 품사("명사"/"동사"/"형용사" 등). 우리말샘 API 가 뜻풀이(sense)마다 붙여준다. */
  pos?: string;
}

export interface OpenDictItem {
  word?: string;
  /** 동음이의어 일련번호("01", "02", …). 우리말샘 API 가 실제로 쓰는 필드명. */
  sup_no?: string;
  sense?: OpenDictSense[] | OpenDictSense;
}

const DEFAULT_LIMIT = 3;
/** 사전에서 제외할 품사. 인용형("먹다")은 실제 대화에서 단독 사용되지 않아 끝말잇기에 부적합하다. */
const DEFAULT_EXCLUDED_POS = ['동사'];

function toSenseArray(sense: OpenDictItem['sense']): OpenDictSense[] {
  if (Array.isArray(sense)) return sense;
  return sense ? [sense] : [];
}

/** 한 동음이의어(item)의 품사. 우리말샘은 한 item 안의 모든 뜻이 같은 품사이므로 첫 뜻 것을 대표로 쓴다. */
function itemPos(item: OpenDictItem): string | undefined {
  return toSenseArray(item.sense).find((sense) => sense.pos)?.pos;
}

/**
 * 제외 대상 품사(기본: 동사)에 해당하는 동음이의어 그룹만 걸러낸다.
 * 품사를 모르는 항목은 통과시킨다(판단할 근거가 없으므로).
 */
export function excludeByPos(
  items: OpenDictItem[],
  excludedPos: readonly string[] = DEFAULT_EXCLUDED_POS,
): OpenDictItem[] {
  if (excludedPos.length === 0) return items;
  const blocked = new Set(excludedPos);
  return items.filter((item) => {
    const pos = itemPos(item);
    return pos === undefined || !blocked.has(pos);
  });
}

function parseOrdinal(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** item.word 를 기준으로 동음이의어 그룹을 묶는다(입력 순서를 보존한다). */
export function groupByHeadword(items: OpenDictItem[]): Map<string, OpenDictItem[]> {
  const groups = new Map<string, OpenDictItem[]>();
  for (const item of items) {
    if (!item.word) continue;
    const bucket = groups.get(item.word);
    if (bucket) bucket.push(item);
    else groups.set(item.word, [item]);
  }
  return groups;
}

/**
 * 이미 같은 표제어로 묶인 항목들에서 대표 뜻풀이를 최대 `limit` 개 뽑는다.
 *
 *  - homonymGroup.length > 1  -> 동음이의어별 대표 뜻(각 그룹의 1번 뜻) 우선
 *  - homonymGroup.length === 1 -> 그 안의 뜻풀이(작은 숫자)를 순서대로
 */
export function pickRepresentativeDefinitions(
  homonymGroup: OpenDictItem[],
  limit = DEFAULT_LIMIT,
): string[] {
  if (homonymGroup.length === 0) return [];

  if (homonymGroup.length > 1) {
    const bySupNo = [...homonymGroup].sort(
      (a, b) => parseOrdinal(a.sup_no) - parseOrdinal(b.sup_no),
    );
    const definitions: string[] = [];
    for (const item of bySupNo) {
      const senses = toSenseArray(item.sense).sort(
        (a, b) => parseOrdinal(a.sense_no) - parseOrdinal(b.sense_no),
      );
      const representative = senses.find((sense) => sense.definition)?.definition;
      if (representative) definitions.push(representative.trim());
      if (definitions.length >= limit) break;
    }
    return definitions;
  }

  const senses = toSenseArray(homonymGroup[0]!.sense).sort(
    (a, b) => parseOrdinal(a.sense_no) - parseOrdinal(b.sense_no),
  );
  const definitions: string[] = [];
  for (const sense of senses) {
    if (!sense.definition) continue;
    definitions.push(sense.definition.trim());
    if (definitions.length >= limit) break;
  }
  return definitions;
}

/**
 * 뜻풀이 목록을 lore 문자열로 합친다.
 * 뜻이 하나면 번호 없이 그대로, 여럿이면 "1. … 2. … 3. …" 로 매긴다.
 */
export function formatDefinitions(definitions: string[]): string | undefined {
  const cleaned = definitions.filter(Boolean);
  if (cleaned.length === 0) return undefined;
  if (cleaned.length === 1) return cleaned[0];
  return cleaned.map((definition, index) => `${index + 1}. ${definition}`).join(' ');
}

/**
 * groupByHeadword + 품사 필터링 + pickRepresentativeDefinitions + formatDefinitions 을 한 번에.
 * 동음이의어 중 제외 대상 품사(기본 동사)인 것은 먼저 걸러내고 남은 것으로 규칙을 적용한다.
 * 전부 걸러지면(= 이 단어가 통째로 동사뿐이면) undefined — 사전에서 아예 빠진다.
 */
export function buildLoreForHeadword(
  homonymGroup: OpenDictItem[],
  limit = DEFAULT_LIMIT,
  excludedPos: readonly string[] = DEFAULT_EXCLUDED_POS,
): string | undefined {
  const eligible = excludeByPos(homonymGroup, excludedPos);
  return formatDefinitions(pickRepresentativeDefinitions(eligible, limit));
}
