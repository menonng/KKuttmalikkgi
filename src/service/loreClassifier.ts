/**
 * lore 분류기.
 *
 * 위키 문서 요약은 한 문장이라도 길고 장황하다.
 *   "키르케는 그리스 신화에 나오는 마녀로, 아이아이에 섬에 살며…"
 * 사전의 lore 규칙은 짧은 태그를 원한다.
 *   키르케 -> 그리스 신화
 *
 * 요약에서 계통을 알아보면 태그로 바꾸고, 못 알아보면 요약을 그대로 쓴다
 * (일반 어휘의 뜻풀이는 그대로 두는 것이 맞기 때문).
 */

interface Rule {
  lore: string;
  /** 요약에서 이 패턴이 보이면 해당 태그로 분류한다. */
  pattern: RegExp;
}

/** 위에서부터 먼저 맞는 규칙이 이긴다 — 구체적인 것을 앞에 둔다. */
const RULES: Rule[] = [
  { lore: '원신', pattern: /원신|Genshin/iu },
  { lore: '악마학', pattern: /고에티아|솔로몬의?\s*(72\s*)?악마|악마학|레메게톤/u },
  { lore: '그리스 신화', pattern: /그리스\s*신화|그리스\s*로마\s*신화/u },
  { lore: '로마 신화', pattern: /로마\s*신화/u },
  { lore: '북유럽 신화', pattern: /북유럽\s*신화|노르드\s*신화/u },
  { lore: '이집트 신화', pattern: /이집트\s*신화/u },
  { lore: '메소포타미아 신화', pattern: /메소포타미아\s*신화|수메르\s*신화/u },
  { lore: '한국 신화', pattern: /한국\s*신화|단군\s*신화/u },
  { lore: '신화', pattern: /신화에?\s*(나오는|등장하는)|신화\s*속/u },
  { lore: '성경', pattern: /성경|성서|구약|신약/u },
  { lore: '라이트노벨', pattern: /라이트\s*노벨/u },
  { lore: '애니메이션', pattern: /애니메이션|애니메/u },
  { lore: '만화', pattern: /만화|망가/u },
  { lore: '게임', pattern: /비디오\s*게임|게임에?\s*(등장|나오)/u },
  { lore: '영화', pattern: /영화/u },
  { lore: '드라마', pattern: /드라마|텔레비전\s*시리즈/u },
  { lore: '소설', pattern: /소설/u },
  { lore: '역사 인물', pattern: /왕|황제|장군|정치가|독립운동가|학자|승려/u },
  { lore: '지명', pattern: /도시|지역|나라|국가|산맥|강|섬|수도/u },
  { lore: '조직', pattern: /기구|단체|기업|조직|협회/u },
];

/**
 * 요약을 짧은 lore 태그로 바꾼다. 분류에 실패하면 null.
 *
 * @param summary 위키 문서 도입부
 */
export function classifyLore(summary: string | undefined | null): string | null {
  if (!summary) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(summary)) return rule.lore;
  }
  return null;
}

/**
 * lore 후보를 고른다.
 *  1. 분류에 성공하면 태그
 *  2. 실패하면 요약(뜻풀이는 그대로 남겨야 하므로)
 *  3. 요약도 없으면 프로바이더 기본값
 */
export function pickLore(
  summary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return classifyLore(summary) ?? summary ?? fallback;
}
