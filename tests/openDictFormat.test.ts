import { describe, expect, it } from 'vitest';
import {
  buildLoreForHeadword,
  excludeByPos,
  formatDefinitions,
  groupByHeadword,
  pickRepresentativeDefinitions,
  type OpenDictItem,
} from '../src/net/openDictFormat.js';

describe('pickRepresentativeDefinitions', () => {
  it('동음이의어가 하나뿐이면 그 안의 뜻(작은 숫자)을 순서대로 최대 3개 뽑는다', () => {
    const group: OpenDictItem[] = [
      {
        word: '배',
        sup_no: '02',
        sense: [
          { sense_no: '2', definition: '두 번째 뜻' },
          { sense_no: '1', definition: '첫 번째 뜻' },
          { sense_no: '3', definition: '세 번째 뜻' },
          { sense_no: '4', definition: '네 번째 뜻(넘침)' },
        ],
      },
    ];
    expect(pickRepresentativeDefinitions(group)).toEqual([
      '첫 번째 뜻',
      '두 번째 뜻',
      '세 번째 뜻',
    ]);
  });

  it('동음이의어가 여럿이면 각 그룹의 대표(1번) 뜻을 sup_no 순으로 최대 3개 뽑는다', () => {
    const group: OpenDictItem[] = [
      { word: '배', sup_no: '03', sense: [{ sense_no: '1', definition: '교통수단' }] },
      { word: '배', sup_no: '01', sense: [{ sense_no: '1', definition: '신체 부위' }] },
      { word: '배', sup_no: '02', sense: [{ sense_no: '1', definition: '과일' }] },
      { word: '배', sup_no: '04', sense: [{ sense_no: '1', definition: '네 번째(넘침)' }] },
    ];
    expect(pickRepresentativeDefinitions(group)).toEqual(['신체 부위', '과일', '교통수단']);
  });

  it('동음이의어가 여럿이면 각 그룹의 다른 뜻(작은 숫자)이 아니라 대표 뜻만 쓴다', () => {
    const group: OpenDictItem[] = [
      {
        word: '배',
        sup_no: '01',
        sense: [
          { sense_no: '1', definition: '대표 뜻' },
          { sense_no: '2', definition: '이 그룹의 다른 뜻(안 씀)' },
        ],
      },
      { word: '배', sup_no: '02', sense: [{ sense_no: '1', definition: '두 번째 그룹 대표 뜻' }] },
    ];
    expect(pickRepresentativeDefinitions(group)).toEqual(['대표 뜻', '두 번째 그룹 대표 뜻']);
  });

  it('sense 가 배열이 아니라 단일 객체로 와도 처리한다', () => {
    const group: OpenDictItem[] = [{ word: '단어', sense: { sense_no: '1', definition: '뜻' } }];
    expect(pickRepresentativeDefinitions(group)).toEqual(['뜻']);
  });

  it('정의가 없는 항목은 건너뛴다', () => {
    const group: OpenDictItem[] = [{ word: '단어', sense: [{ sense_no: '1' }] }];
    expect(pickRepresentativeDefinitions(group)).toEqual([]);
  });

  it('빈 그룹은 빈 배열을 돌려준다', () => {
    expect(pickRepresentativeDefinitions([])).toEqual([]);
  });
});

describe('formatDefinitions', () => {
  it('뜻이 하나면 번호 없이 그대로 쓴다', () => {
    expect(formatDefinitions(['알루미늄 침대.'])).toBe('알루미늄 침대.');
  });

  it('뜻이 여럿이면 번호를 매겨 잇는다', () => {
    expect(formatDefinitions(['첫째', '둘째', '셋째'])).toBe('1. 첫째 2. 둘째 3. 셋째');
  });

  it('빈 배열은 undefined', () => {
    expect(formatDefinitions([])).toBeUndefined();
  });
});

describe('groupByHeadword', () => {
  it('같은 표제어끼리 묶는다', () => {
    const items: OpenDictItem[] = [
      { word: '배', sup_no: '01' },
      { word: '사과', sup_no: '01' },
      { word: '배', sup_no: '02' },
    ];
    const groups = groupByHeadword(items);
    expect(groups.get('배')?.length).toBe(2);
    expect(groups.get('사과')?.length).toBe(1);
  });

  it('word 가 없는 항목은 무시한다', () => {
    const groups = groupByHeadword([{ sense: [] }]);
    expect(groups.size).toBe(0);
  });
});

describe('buildLoreForHeadword (통합)', () => {
  it('전체 규칙: 동음이의어 3개 초과, 뜻 다수 -> 대표 뜻 3개만 번호 매겨 반환', () => {
    const group: OpenDictItem[] = [
      { word: '배', sup_no: '01', sense: [{ sense_no: '1', definition: '신체 부위' }] },
      {
        word: '배',
        sup_no: '02',
        sense: [
          { sense_no: '1', definition: '과일' },
          { sense_no: '2', definition: '배나무(안 씀)' },
        ],
      },
      { word: '배', sup_no: '03', sense: [{ sense_no: '1', definition: '교통수단' }] },
      { word: '배', sup_no: '04', sense: [{ sense_no: '1', definition: '넘치는 항목' }] },
    ];
    expect(buildLoreForHeadword(group)).toBe('1. 신체 부위 2. 과일 3. 교통수단');
  });

  it('동음이의어 없이 뜻 하나뿐인 가장 흔한 경우: 번호 없이 뜻풀이만', () => {
    const group: OpenDictItem[] = [
      { word: '륨침대', sense: [{ sense_no: '1', definition: '주로 알루미늄을 뼈대로 하는 간이 침대.' }] },
    ];
    expect(buildLoreForHeadword(group)).toBe('주로 알루미늄을 뼈대로 하는 간이 침대.');
  });
});

describe('excludeByPos (동사 제외)', () => {
  it('기본값(동사)에 해당하는 동음이의어를 걸러낸다', () => {
    const items: OpenDictItem[] = [
      { word: '가리다', sup_no: '01', sense: [{ sense_no: '1', definition: '보이지 않게 막다.', pos: '동사' }] },
      { word: '가리다', sup_no: '02', sense: [{ sense_no: '1', definition: '음식을 골라 먹다.', pos: '동사' }] },
    ];
    expect(excludeByPos(items)).toEqual([]);
  });

  it('동사가 아닌 동음이의어는 남긴다', () => {
    const items: OpenDictItem[] = [
      { word: '배', sup_no: '01', sense: [{ sense_no: '1', definition: '신체 부위', pos: '명사' }] },
      { word: '배', sup_no: '02', sense: [{ sense_no: '1', definition: '떠나다', pos: '동사' }] },
    ];
    const result = excludeByPos(items);
    expect(result.length).toBe(1);
    expect(result[0]?.sup_no).toBe('01');
  });

  it('품사를 모르면 통과시킨다(판단 근거가 없으므로)', () => {
    const items: OpenDictItem[] = [{ word: '단어', sense: [{ sense_no: '1', definition: '뜻' }] }];
    expect(excludeByPos(items)).toEqual(items);
  });

  it('excludedPos 를 커스터마이즈할 수 있다', () => {
    const items: OpenDictItem[] = [
      { word: '예쁘다', sense: [{ sense_no: '1', definition: '아름답다.', pos: '형용사' }] },
    ];
    expect(excludeByPos(items, [])).toEqual(items);
    expect(excludeByPos(items, ['형용사'])).toEqual([]);
  });
});

describe('buildLoreForHeadword: 동사만 있는 단어는 전부 제외', () => {
  it('동음이의어 전부가 동사면 undefined', () => {
    const items: OpenDictItem[] = [
      { word: '가다', sense: [{ sense_no: '1', definition: '이동하다.', pos: '동사' }] },
    ];
    expect(buildLoreForHeadword(items)).toBeUndefined();
  });

  it('동사 동음이의어를 뺀 나머지로 정상 동작한다', () => {
    const items: OpenDictItem[] = [
      { word: '배', sup_no: '01', sense: [{ sense_no: '1', definition: '신체 부위', pos: '명사' }] },
      { word: '배', sup_no: '02', sense: [{ sense_no: '1', definition: '떠나다', pos: '동사' }] },
    ];
    expect(buildLoreForHeadword(items)).toBe('신체 부위');
  });
});
