import { describe, expect, it, vi } from 'vitest';
import { OpenDictProvider } from '../src/service/providers/openDict.js';

function mockFetch(payload: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe('OpenDictProvider', () => {
  it('동음이의어가 여럿이면 각 대표 뜻을 최대 3개까지 모아 lore 로 돌려준다', async () => {
    const fetchImpl = mockFetch({
      channel: {
        item: [
          { word: '배', sup_no: '01', link: 'https://example/1', sense: [{ sense_no: '1', definition: '신체 부위' }] },
          { word: '배', sup_no: '02', sense: [{ sense_no: '1', definition: '과일' }] },
          { word: '배', sup_no: '03', sense: [{ sense_no: '1', definition: '교통수단' }] },
          { word: '배', sup_no: '04', sense: [{ sense_no: '1', definition: '넘치는 항목' }] },
        ],
      },
    });
    const provider = new OpenDictProvider({ apiKey: 'test-key', fetchImpl });

    const hit = await provider.lookup('배');
    expect(hit).toEqual({
      title: '배',
      lore: '1. 신체 부위 2. 과일 3. 교통수단',
      reference: 'https://example/1',
    });
  });

  it('동음이의어가 하나뿐이면 그 안의 다의어 뜻을 최대 3개까지 모은다', async () => {
    const fetchImpl = mockFetch({
      channel: {
        item: [
          {
            word: '먹다-',
            sense: [
              { sense_no: '1', definition: '음식을 씹어 삼키다.' },
              { sense_no: '2', definition: '연기나 가스 따위를 들이마시다.' },
              { sense_no: '3', definition: '겁, 충격 따위를 느끼게 되다.' },
              { sense_no: '4', definition: '넘치는 뜻' },
            ],
          },
        ],
      },
    });
    const provider = new OpenDictProvider({ apiKey: 'test-key', fetchImpl });

    const hit = await provider.lookup('먹다');
    expect(hit?.title).toBe('먹다');
    expect(hit?.lore).toBe(
      '1. 음식을 씹어 삼키다. 2. 연기나 가스 따위를 들이마시다. 3. 겁, 충격 따위를 느끼게 되다.',
    );
  });

  it('뜻이 하나뿐인 가장 흔한 경우는 번호 없이 그대로 쓴다', async () => {
    const fetchImpl = mockFetch({
      channel: {
        item: [{ word: '륨침대', sense: [{ sense_no: '1', definition: '주로 알루미늄을 뼈대로 하는 간이 침대.' }] }],
      },
    });
    const provider = new OpenDictProvider({ apiKey: 'test-key', fetchImpl });

    const hit = await provider.lookup('륨침대');
    expect(hit?.lore).toBe('주로 알루미늄을 뼈대로 하는 간이 침대.');
  });

  it('요청 단어와 정확히 일치하지 않는 항목은(발음 표시 제외) 무시한다', async () => {
    const fetchImpl = mockFetch({
      channel: { item: [{ word: '다른단어', sense: [{ sense_no: '1', definition: '엉뚱한 뜻' }] }] },
    });
    const provider = new OpenDictProvider({ apiKey: 'test-key', fetchImpl });

    expect(await provider.lookup('배')).toBeNull();
  });

  it('응답이 비어 있으면 null', async () => {
    const fetchImpl = mockFetch({ channel: {} });
    const provider = new OpenDictProvider({ apiKey: 'test-key', fetchImpl });
    expect(await provider.lookup('배')).toBeNull();
  });
});
