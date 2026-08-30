# 끝말잇기 아레나 — Dictionary Builder

멀티플레이 끝말잇기 게임이 쓰는 사전 데이터베이스를 **자동으로 생성하고 유지**하는 파이프라인.

사전을 손으로 적지 않는다. 여러 출처에서 긁어오고, 정규화하고, 중복을 합치고,
설명(lore)을 붙이고, 검증한 뒤 게임이 읽는 JSON 으로 내보내는 **시스템**을 만든다.

일반 끝말잇기보다 훨씬 넓은 범위를 인정한다 — 표준 어휘, 고유명사, 역사·신화·종교 인물,
악마와 신, 게임/애니/만화 캐릭터, 라이트노벨·소설·영화·드라마 제목, 조직, 지명, 사용자 추가 단어.

```
벤티 · 종려 · 모락스 · 오디세우스 · 키르케 · 헤파이스토스 · 바엘 · 데카라비아
아나스타샤표도로브나스네즈나야 · 리제로부터시작하는이세계생활 · 륨침대
```

---

## 빠른 시작

```bash
npm install

# 오프라인 빌드 (시드 + 로컬 코퍼스만 사용, 네트워크 없음)
npm run dict:build

# 네트워크 수집까지 포함
npm run dict:build:online

# 결과 확인
npx tsx src/cli.ts lookup 모락스
npx tsx src/cli.ts stats
```

산출물은 `data/dist/` 에 생긴다.

```json
{"word":"모락스","normalized":"모락스","first":"모","last":"스","lore":"원신, 악마학","sources":["genshin","ars_goetia"]}
```

전체 예시는 [`examples/dictionary.sample.json`](examples/dictionary.sample.json).

---

## 아키텍처

```
 ┌──────────────┐
 │   소스 9종   │  korean_dict / wikipedia / mythology / ars_goetia /
 │              │  genshin / anime / light_novel / movie / custom
 └──────┬───────┘
        │ AsyncIterable<RawEntry>          ← 스트리밍(메모리에 통째로 올리지 않음)
        ▼
 ┌──────────────┐
 │  정규화      │  NFC · 공백 제거 · 제로폭/구분점 제거
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │  검증        │  빈 값 · 부호만 · 길이 · 문자 종류 · 연결 가능성 · 차단어
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │  중복 병합   │  Map 기반 O(1) · sources 누적 · lore 조각 수집
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │  lore 확정   │  태그 병합 · 포함 관계 정리 · 60자 예산
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │  내보내기    │  dictionary.json · index.json · manifest.json · rejects.jsonl · (sqlite)
 └──────────────┘
```

각 단계는 독립 모듈이고, 파이프라인(`src/core/pipeline.ts`)은 이들을 이어 붙이기만 한다.

| 모듈 | 역할 |
| --- | --- |
| `src/core/normalize.ts` | 단어 정규화, 첫/끝 글자 추출 |
| `src/core/validate.ts` | 검증 규칙 |
| `src/core/dedupe.ts` | 중복 병합 엔진 |
| `src/core/lore.ts` | lore 생성·병합·길이 관리 |
| `src/core/hangul.ts` | 자모 분해/합성, 두음법칙 |
| `src/core/incremental.ts` | 증분 빌드 캐시 |
| `src/core/export.ts` | 산출물 생성 |
| `src/core/store.ts` | **런타임 조회** — 게임 서버가 쓰는 쪽 |
| `src/net/httpCache.ts` | 디스크 캐시 + 재시도 + rate limit |
| `src/net/mediawiki.ts` | MediaWiki API 클라이언트 |

---

## 데이터 소스

| id | 이름 | 우선순위 | 기본 lore | 온라인 수집 방식 |
| --- | --- | --- | --- | --- |
| `custom` | 사용자 정의 | 0 | 항목별 | — (시드 전용) |
| `genshin` | 원신 | 10 | 원신 | 팬덤 위키 API |
| `ars_goetia` | 아르스 고에티아 | 20 | 악마학 | 위키백과 분류 |
| `mythology` | 신화 | 30 | 항목별 | 위키백과 분류 |
| `anime` | 애니메이션 | 40 | 애니메이션 | 위키백과 분류 |
| `light_novel` | 라이트노벨 | 50 | 라이트노벨 | 위키백과 분류 |
| `movie` | 영화·드라마 | 60 | 영화 | 위키백과 분류 |
| `wikipedia` | 위키백과 | 80 | 문서 요약 | 위키백과 분류 + extracts |
| `korean_dict` | 국어사전 | 90 | 뜻풀이 | 우리말샘 API + 로컬 코퍼스 |

우선순위는 **낮을수록 우선**이다. 같은 단어가 여러 소스에 있으면
표시 표기와 `lore`/`sources` 순서를 우선순위가 정한다.

```
모락스  genshin(10) + ars_goetia(20)
     -> lore    "원신, 악마학"
     -> sources ["genshin", "ars_goetia"]
```

### 소스는 3중 구조로 동작한다

1. **시드** (`data/seeds/*.yaml`) — 손으로 관리하는 최소 기준선. 오프라인에서도 항상 확보된다.
2. **온라인 수집** (`--online`) — 위키 분류를 크롤링해 대량으로 덧붙인다.
3. **실패 시 폴백** — 네트워크가 막히거나 API 가 죽으면 경고만 남기고 시드로 계속 간다.

한 소스가 죽어도 나머지 사전은 정상적으로 만들어진다.

### 대량 어휘 투입 경로

`korean_dict` 소스는 `data/corpus/*.tsv` 를 **스트리밍으로** 읽는다.

```
단어<TAB>뜻풀이
```

10만 줄이든 100만 줄이든 메모리에는 한 줄씩만 올라간다. 자세한 내용은
[`data/corpus/README.md`](data/corpus/README.md).

우리말샘 오픈 API 를 쓰려면 키를 환경변수로 준다.

```bash
export KOREAN_DICT_API_KEY=발급받은_키
npm run dict:build:online
```

---

## 새 소스 추가하기

`DictionarySource` 인터페이스만 구현하면 된다.

```ts
export interface DictionarySource {
  readonly name: string;            // export 의 sources 에 그대로 들어간다
  readonly label: string;
  readonly defaultLore?: string;
  readonly defaultPriority: number;
  fingerprint(ctx: SourceContext): Promise<string>;   // 증분 빌드용 지문
  collect(ctx: SourceContext): AsyncIterable<RawEntry>;
}
```

1. `src/sources/내소스.ts` 작성
2. `src/sources/index.ts` 의 `registerBuiltinSources()` 에 한 줄 추가
3. `config/builder.config.json` 에 설정 추가

끝. 파이프라인·CLI·통계·증분 빌드에 자동으로 반영된다.

동작하는 예제: [`examples/custom-source.ts`](examples/custom-source.ts)

```bash
npx tsx examples/custom-source.ts
```

위키 계열이면 `MediaWikiSource` 를, 시드만 쓰면 `SeedSource` 를 상속하는 게 빠르다.

---

## 규칙

### 정규화

| 입력 | 저장 |
| --- | --- |
| `"  벤티  "` | `벤티` |
| `"리 제로부터 시작하는 이세계 생활"` | `리제로부터시작하는이세계생활` |
| `"레오나르도·다·빈치"` | `레오나르도다빈치` |
| NFD 자모 분리 입력 | NFC 완성형 |

- 앞뒤 공백 제거, **내부 공백 전부 제거**
- 전각 공백·제로폭 문자·소프트하이픈 제거
- 가운뎃점 등 장식 구분점 제거
- 멱등: `normalize(normalize(x)) === normalize(x)`

### 검증

| 코드 | 조건 |
| --- | --- |
| `empty` | 빈 문자열 |
| `punctuation_only` | 글자·숫자가 하나도 없음 |
| `too_short` / `too_long` | 설정 길이 범위 밖 (기본 2~40자) |
| `illegal_characters` | 허용 문자 집합 위반, 한글 미포함 |
| `no_chain_head` / `no_chain_tail` | 첫/끝 글자가 한글 음절이 아님 (예: `응답하라1988`) |
| `blocked` | 차단 목록 |

탈락 항목은 `data/dist/rejects.jsonl` 에 사유와 함께 남는다.
**중복은 탈락이 아니라 병합**이므로 여기 오지 않는다.

### lore

- 고유명사 → 출처 태그: `벤티` → `원신`, `바엘` → `악마학`
- 일반 어휘 → 사전 뜻풀이: `륨침대` → `주로 알루미늄을 뼈대로 하는 간이 침대.`
- 여러 소스 → `", "` 로 연결: `모락스` → `원신, 악마학`
- 중복·포함 관계 정리: `원신` + `원신 캐릭터` → `원신 캐릭터`
- 기본 60자 예산. 넘으면 우선순위 낮은 조각부터 버리고, 그래도 길면 잘라 `…` 을 붙인다.

**동음이의어·다의어(`korean_dict`, `src/net/openDictFormat.ts`)** — 우리말샘은 표제어를
두 단계로 번호 매긴다: 표기는 같지만 어원이 다른 **동음이의어**(큰 숫자, `배01`/`배02`/`배03`)와
그 안에서 갈라지는 **다의어 뜻**(작은 숫자, 「1」「2」「3」). 규칙:

- 동음이의어가 여럿이면 → 각 동음이의어의 대표(1번) 뜻을 번호순으로 최대 3개
  (`배` → `1. 신체 부위 2. 과일 3. 교통수단`)
- 동음이의어가 하나뿐이면 → 그 안의 다의어 뜻을 최대 3개
  (`먹다` → `1. 음식을 씹어 삼키다. 2. 연기나 가스 따위를 들이마시다. 3. 겁, 충격 따위를 느끼게 되다.`)
- 뜻이 하나뿐인 가장 흔한 경우는 번호 없이 그대로(`륨침대` → 예시 그대로)

### 두음법칙

끝말잇기 판정에는 두음법칙이 적용된다 (`src/core/hangul.ts`).

```
연락 -> 낙타   (락 -> 낙)   O
관리 -> 이순신 (리 -> 이)   O
```

`dictionary.index.json` 의 `chainHeads` 에 글자별 허용 시작 글자가 미리 계산돼 있다.

---

## 산출물

| 파일 | 내용 |
| --- | --- |
| `dictionary.json` | 최종 사전. 엔트리 하나당 한 줄(10만 건에서도 diff 가 읽힌다) |
| `dictionary.index.json` | 첫/끝 글자 → 인덱스 배열, 두음법칙 매핑 |
| `manifest.json` | 빌드 시각, 엔트리 수, sha256 체크섬, 소스별 통계 |
| `rejects.jsonl` | 검증 탈락 표본 |
| `dictionary.sqlite` | (선택, `--sqlite`) 서버측 조회용 |

엔트리 스키마:

```json
{
  "word": "벤티",
  "normalized": "벤티",
  "first": "벤",
  "last": "티",
  "lore": "원신",
  "sources": ["genshin"]
}
```

`manifest.json` 의 `checksum` 으로 게임 서버가 사전 갱신 여부를 싸게 판단할 수 있다.

---

## 게임 서버에서 쓰기

```ts
import { DictionaryStore } from './src/core/store.js';

// 서버 부팅 시 1회
const store = await DictionaryStore.load('data/dist');

store.has('벤티');                        // true
store.get(' 벤 티 ');                     // 입력을 정규화해서 조회
store.canFollow('벤티', '티라미수');       // true (두음법칙 포함)
store.nextCandidates('벤티', { exclude: used, limit: 5 });  // 봇/힌트용
store.isDeadEnd('음악');                  // 한방단어 판정
```

동작하는 예제: [`examples/game-server-usage.ts`](examples/game-server-usage.ts)

---

## 사전 조회 API — 미등록 단어 실시간 검색

빌드된 `dictionary.json` 은 스냅샷일 뿐이다. **플레이어가 사전에 없는 실재하는 단어**
(방금 나온 애니메이션 캐릭터, 위키백과에는 있지만 아직 시드에 못 넣은 신화 인물 등)를
입력하면, `DictionaryResolver` 가 그 자리에서 위키 계열 출처를 검색해 실재 여부를 확인한다.
확인되면 즉시 게임에 쓰이고, 다음 정식 빌드(`--incremental`)에 자연스럽게 편입된다.

```
빌드된 사전 조회 → (없으면) 조회 캐시 → (없으면) 온라인 프로바이더를 우선순위 순으로 검색
  genshin(10) → wiktionary(95)                             [브라우저]
  genshin(10) → korean_dict API(90, 키 있을 때) → wiktionary(95)   [서버]
```

한국어 위키백과는 프로바이더에 없다("단어는 위키피디아에서 찾아보지 마" — 실시간 확인은
원신 위키·위키낱말사전, 그리고 서버 쪽은 우리말샘(국립국어원)까지). 우리말샘·네이버 국어사전
API 는 둘 다 인증 키가 필요한데 브라우저 JS 에 키를 그대로 두면 노출되므로, 브라우저
리졸버에는 절대 넣지 않는다(서버 프로세스 환경변수로만 전달). 네이버 쪽은 설령 키를
서버에 둔다 해도 공식 API가 브라우저 직접 호출을 위한 CORS 를 열어 주지 않아 클라이언트
쪽 프로바이더로는 애초에 못 쓴다.

프로바이더는 **정확히 그 표기의 문서가 존재할 때만** 인정한다(제목 직접 조회 →
안 되면 검색 후 제목이 정규화 후 정확히 일치하는 것만) — 비슷한 단어로 오탐하지 않는다.
찾은 문서 요약은 `loreClassifier`가 "그리스 신화", "원신", "악마학" 같은 짧은 태그로
자동 분류하고(실패하면 요약 원문을 그대로 lore 로 쓴다), 여러 소스가 동시에 확인하면
기존 병합 규칙 그대로 `lore`/`sources` 가 합쳐진다.

### 브라우저에서 (GitHub Pages, 번들러 없이)

`dist/service/browser.js` 는 순수 ESM이고 `node:` 의존이 전혀 없어서 정적 페이지에서
`<script>` 없이 `import()` 로 바로 로드된다 — 이 저장소의 `web/index.html` DICTIONARY
창이 실제로 이렇게 동작한다.

```html
<script>
  const { createBrowserResolver } = await import('./dist/service/browser.js');
  const { resolver, dictionary } = await createBrowserResolver({
    dictionaryUrl: './data/dictionary.json',
  });

  const result = await resolver.resolve('페르세포네');
  // { status: 'resolved', entry: { word: '페르세포네', lore: '그리스 신화', sources: ['wikipedia'] }, origin: 'online' }
</script>
```

- `resolve()` 는 `known`(빌드된 사전) / `resolved`(온라인 확인) / `unknown`(어디에도 없음) /
  `invalid`(형식 위반, 네트워크를 아예 타지 않음) 중 하나를 돌려준다.
- 결과는 `BrowserResolutionCache` 로 `localStorage` 에 캐시된다(긍정 24h, 부정 1h TTL).
- 국어사전 오픈 API 는 키가 필요해 브라우저에는 포함하지 않는다 — 일반 어휘의 최종
  폴백은 한국어 위키낱말사전이 담당한다.

### 서버에서 (Node, 국어사전 API 포함)

```bash
export KOREAN_DICT_API_KEY=발급받은_키   # 선택 — 있으면 일반 어휘 판정이 보강된다
npm run serve                          # http://localhost:8787
```

```
GET  /api/lookup?word=벤티              단어 존재 판정 (+ lore/sources)
POST /api/validate-turn                 { "word": "...", "previous": "...", "used": [...] }
GET  /api/dictionary                    dictionary.json 그대로 서빙
```

`validateTurn()` 은 존재 여부 + 중복 사용 + (두음법칙을 반영한) 앞 단어와의 연결까지
한 번에 판정한다 — 게임 서버가 한 턴을 승인/거절할 때 그대로 쓰면 된다.

### 단어 검증 규칙 (요약)

| 판정 | 조건 |
| --- | --- |
| `invalid` | 정규화 후 형식 검증 실패(빈 값/너무 짧음/허용 안 되는 문자 등) — 네트워크 안 탐 |
| `known` | 빌드된 `dictionary.json` 에 있음 |
| `resolved` | 사전엔 없지만 온라인 프로바이더가 실재를 확인함 |
| `unknown` | 형식은 맞지만 사전에도, 어떤 출처에도 없음 |

---

## AI 대전 — 턴 페이스 엔진

`web/index.html` 의 AI MODE 는 실제로 동작하는 1인용 대전이다. 난이도를 고르면 사전에서 무작위 시작 단어를 뽑아 플레이어와
AI(`src/game/ai.ts`)가 번갈아 잇는다 — 단어 판정은 위 사전 조회 API 의 `validateTurn()`
을 그대로 쓴다(한 글자 단어는 검증 규칙의 `minLength: 2` 로 항상 거부된다).

### 턴 페이스 규칙 (`src/game/pace.ts`)

```
제한 시간(초) = max(2, 13 − 0.3 × (턴 − 1))     // 턴은 1부터
배속          = 13 / 제한시간(턴)                // 첫 턴 1.0배 ~ 하한에서 6.5배
```

턴을 거듭할수록(성공이든 실패든) 제한 시간이 13초에서 턴당 0.3초씩 줄어 최소 2초에서
멈춘다. **배경음악 재생 속도와 특수 단어(원신·신화·악마학 등 `korean_dict` 이외 출처)
연출 속도는 이 배속과 정확히 같은 비율로 빨라진다** — `applyPace()` 가 매 턴마다 이
배속을 계산해 절차적 BGM 시퀀서의 스케줄 간격과 `--pace-ratio` CSS 변수(펄스 애니메이션이
`calc(900ms / var(--pace-ratio))` 로 참조)에 동시에 적용한다.

- 외부 BGM 에셋은 포함하지 않는다(제공된 트랙이 없고, 라이선스 없는 음원을 넣을 수 없다).
  대신 Web Audio 로 짧은 아르페지오를 절차적으로 반복 재생해, "속도"가 실제로 귀에 들리게
  동작하는 것을 확인할 수 있다.
- AI 난이도(`easy`/`normal`/`hard`/`insane`)는 `chooseAiMove()` 가 담당한다 — 쉬움은
  무작위, 보통은 상대를 즉시 한방단어로 몰지 않는 후보 우선, 어려움/광기는 그 수를 두었을 때
  플레이어에게 남는 후속 후보가 가장 적은 단어를 고른다(전방탐색 폭만 다름).

순수 로직(`pace.ts`, `ai.ts`)은 vitest 로, 실제 화면 배선(타이머 진행·HP 감소·승패 판정·
이스터에그)은 `npm run test:e2e` 의 Playwright 시나리오로 검증한다.

---

## 증분 업데이트

```bash
npx tsx src/cli.ts build --incremental
```

소스마다 지문(시드 내용 해시 + 옵션 + 온라인 여부)을 저장한다.
지문이 그대로면 이전 수집 결과(JSONL)를 그대로 다시 흘려보낸다.

> 원신 시드 한 줄만 고쳤다 → `genshin` 만 재수집, 위키백과 수천 건은 캐시 재사용.

HTTP 응답도 `data/cache/http/` 에 캐시되므로(기본 TTL 7일),
같은 크롤링을 반복해도 네트워크를 다시 때리지 않는다.

---

## 실제로 수십만 단어를 모으려면

이 저장소에 커밋된 `data/corpus/korean-words.sample.tsv` 는 예시용 소량 데이터다
(실존하는 단어를 직접 하나씩 확인해 손으로 적은 것이라 규모에 한계가 있다 —
사전 단어를 지어내지 않는다는 원칙 때문에 이 파일 자체를 부풀리는 방식으로는
"수십만"에 도달할 수 없다). 실제로 그 규모에 도달하는 경로는 두 가지다.

**1. 우리말샘 전체 음절 스윕(이미 구현됨, 키만 있으면 됨)**

`korean_dict` 소스의 `sweepAllSyllables: true` (기본 켜짐, `config/builder.config.json`)
는 완성형 한글 음절 가~힣 11,172개를 전부 우리말샘 검색 API 질의어로 써서 훑는다.
필요한 건 단 하나 — [opendict.korean.go.kr](https://opendict.korean.go.kr) 에서 무료로
발급받은 키를 저장소 시크릿 `KOREAN_DICT_API_KEY` 로 등록하는 것뿐이다.

```bash
# 로컬에도, GitHub Actions 시크릿에도 등록 가능:
KOREAN_DICT_API_KEY=발급받은키 npx tsx src/cli.ts build --online
```

주의할 점:
- 음절 수 × 페이지 수만큼 요청이 나간다(`perQuery: 1000` 이면 음절당 최대 10페이지,
  전체 최악 111,720회). `http.rateLimitMs`(150ms) 간격을 지키므로 처음 한 번은 몇 시간
  걸릴 수 있다 — GitHub Actions 에서 `workflow_dispatch` 로 수동 실행해 몰아서 돌리는
  걸 권장한다. 이후로는 `.github/workflows/dictionary.yml` 의 매주 스케줄이
  `--incremental` 로 이미 캐시된 요청(`data/cache/http/`, TTL 7일)은 건너뛰고 새로
  바뀐 부분만 갱신한다.
- 이 저장소를 다루는 이 세션(Claude Code) 자체는 조직 네트워크 정책으로
  `opendict.korean.go.kr` 에 직접 접속할 수 없다(egress 차단, 403). 그래서 이 스윕은
  이 세션이 대신 실행해 줄 수 없고, 실제 인터넷이 열려 있는 GitHub Actions 러너나
  사용자의 로컬 환경에서 키와 함께 실행해야 한다.
- `q=` 파라미터의 정확한 매칭 방식(완전 일치 vs 포함 검색)은 국립국어원 공식 문서로
  직접 확인해 보는 걸 권장한다 — 이 코드는 문서화되지 않은 부분을 추측하지 않고
  기본 요청 방식 그대로 음절을 보낸다.

**2. 국립국어원 우리말샘 전체 덤프 파일을 직접 넣기(더 빠름, 네트워크 불필요)**

국립국어원은 종종 우리말샘 전체를 XML/CSV 로 벌크 다운로드할 수 있게 제공한다
(모두의말뭉치/언어정보나눔터 등). 그런 파일을 구할 수 있다면, 페이지네이션 API 를
수만 번 두드릴 필요 없이 `data/corpus/korean-words.tsv`("단어\t뜻풀이" 형식, 이
파일은 `.gitignore` 에 있어 저장소 크기와 무관하게 얼마든지 커도 된다)로 변환해
넣기만 하면 된다 — 이후 완전히 오프라인으로 `npm run dict:build` 만 돌려도 그
전체가 즉시 반영된다. 이 세션은 그런 벌크 파일을 직접 내려받을 수 없으니, 사용자가
파일을 구해서 올려 주면 형식 변환(TSV 화)까지는 바로 도와줄 수 있다.

---

## 성능

`npm run bench` 로 직접 측정할 수 있다. (12만 건 합성 코퍼스, 이 저장소 컨테이너 기준)

```
== 빌드 ==
  수집       120,000
  병합 제거  41,365
  최종       78,635
  소요       1,739ms
  처리량     69,015 entries/s
  RSS        205.5MB
  dictionary.json 11.3MB

== 런타임 조회 ==
  로드       501ms (78,635건)
  처리량     381,254 lookups/s
```

- 수집은 `AsyncIterable` 스트리밍 — 소스 크기가 메모리를 결정하지 않는다
- 병합은 Map 기반 O(n)
- 런타임 조회는 Map 3개(단어/첫 글자/끝 글자)로 O(1)
- 10만 엔트리 기준 빌드 2초 미만, 로드 0.5초

---

## CLI

```
dictbuild build [옵션]      사전 빌드
dictbuild sources           등록된 소스 목록
dictbuild stats             마지막 빌드 요약
dictbuild lookup <단어>     단어 조회 + 다음 단어 후보
dictbuild chain <앞> <뒤>   끝말잇기 연결 판정
dictbuild add <단어>        사용자 정의 사전에 추가
```

build 옵션: `--online` `--incremental` `--sqlite` `--dry-run` `--only a,b` `--config <경로>` `--log-level <lv>`

```bash
npx tsx src/cli.ts add 슈퍼노바 --lore "사용자 추가" --tags custom
npx tsx src/cli.ts build --incremental
npx tsx src/cli.ts chain 벤티 티라미수      # 벤티 -> 티라미수: 가능
```

---

## 설정

`config/builder.config.json` 에서 검증 임계값, 소스 활성/우선순위/lore, HTTP 정책, 경로를 관리한다.

```jsonc
{
  "maxLoreLength": 60,
  "validation": { "minLength": 2, "maxLength": 40, "requireHangul": true, "blocklist": [] },
  "sources": {
    "genshin": {
      "enabled": true,
      "priority": 10,
      "lore": "원신",
      "options": { "categories": ["캐릭터", "지역"], "depth": 1, "limit": 2000 }
    }
  }
}
```

소스를 끄려면 `enabled: false`, 우선순위를 바꾸려면 `priority` 만 고치면 된다.

---

## 프로젝트 구조

```
config/builder.config.json   빌더 설정
data/
  seeds/*.yaml               소스별 시드(손으로 관리하는 최소 기준선)
  corpus/*.tsv               대량 어휘 투입 경로
  cache/                     HTTP 캐시 + 증분 수집 결과 (gitignore)
  dist/                      빌드 산출물 (gitignore)
src/
  core/                      정규화·검증·병합·lore·증분·내보내기·런타임 스토어·두음법칙(hangul.ts)
  net/                       HTTP 캐시, MediaWiki/우리말샘 포맷 유틸
  sources/                   소스 9종 + 인터페이스/레지스트리
  service/                   실시간 사전 조회 API(리졸버·프로바이더·캐시, 브라우저/서버 공용)
  game/                      AI 대전 엔진 — 턴 페이스(pace.ts), AI 난이도(ai.ts),
                             체력/피격 연출 계산(health.ts), 캐릭터 색상 팔레트(characterColor.ts)
  multiplayer/                서버 권위 방(Room) 상태 머신(room.ts), 프로토콜 타입(protocol.ts),
                             방 코드(roomCode.ts), 실제 WebSocket 서버(server.ts)
  cli.ts                     빌더 CLI
  httpServer.ts              사전 조회 API 서버 (node:http)
examples/                    예시 출력 JSON, 소스 추가 예제, 서버 사용 예제
scripts/                     벤치마크, 예시 생성기, E2E 스모크 테스트
tests/                       vitest
web/
  index.html                 게임 사이트 UI — DICTIONARY/AI MODE 가 전부 실제로 동작함
  multiplayer.html            MULTIPLAYER 가 새 창으로 여는 실제 멀티플레이 클라이언트
                             (src/multiplayer/server.ts 에 WebSocket 으로 접속)
.github/workflows/
  pages.yml                  GitHub Pages 배포(빌드+조립+배포, index.html + multiplayer.html 둘 다)
  dictionary.yml             타입체크·테스트·오프라인 빌드 + 매주 온라인 갱신
```

---

## 멀티플레이 서버 배포

`web/multiplayer.html` 은 정적 페이지라 GitHub Pages 에 같이 올라가지만, 실제 게임
상태를 들고 있는 `src/multiplayer/server.ts` 는 상태를 유지하는 Node 프로세스라
GitHub Pages(정적 호스팅)에는 올릴 수 없다 — Render, Fly.io, Railway 처럼 지속 실행
가능한 곳에 **따로** 배포해야 한다.

```bash
npm run build       # dist/ 컴파일
npm run dict:build  # data/dist/dictionary.json 생성(서버가 부팅 시 읽음)
PORT=8787 node dist/multiplayer/server.js
```

- `PORT` — 리스닝 포트(대부분의 PaaS 가 자동으로 주입한다). 기본 8787.
- `KKUTTMAL_DIST_DIR` — `dictionary.json` 이 있는 디렉터리. 기본 `data/dist`.
- `KKUTTMAL_ALLOW_DEAD_END` — `"true"` 로 주면 모든 방에서 한방단어를 기본 허용.
- 배포 플랫폼 대부분 무료 플랜은 컨테이너를 커밋해 두지 않으므로, 빌드 스텝에
  `npm ci && npm run build && npm run dict:build` 를, 시작 커맨드에
  `node dist/multiplayer/server.js` 를 지정하면 된다.
- 서버가 TLS 뒤에 있으면(플랫폼이 기본 제공하는 `https://` 도메인) 클라이언트는
  `wss://그주소` 로 접속해야 한다 — `web/multiplayer.html` 대기실 진입 화면의
  "서버 주소" 입력칸에 그대로 붙여 넣으면 된다(로컬 테스트는 `ws://localhost:8787`).

---

## 개발

```bash
npm test           # vitest
npm run typecheck  # tsc (src + tests + scripts + examples)
npm run build      # dist/ 로 컴파일 (브라우저가 로드하는 dist/service/browser.js, dist/multiplayer/server.js 포함)
npm run bench      # 대규모 빌드 벤치마크
npm run serve      # 사전 조회 API 서버 (http://localhost:8787)
node dist/multiplayer/server.js   # 멀티플레이 WebSocket 서버 (build 먼저 필요)
npm run test:e2e   # 실제 Chromium 으로 DICTIONARY/AI MODE 창까지 검증하는 E2E 스모크 테스트
```

`test:e2e` 는 `dict:build` + `build` 산출물을 GitHub Pages 와 동일한 구조로 임시
조립한 뒤 Playwright 로 열어, 등록 단어 조회 / 형식 오류 즉시 거부 / 미등록 단어
온라인 검색(가능한 환경이라면 `resolved` 까지, 막힌 환경이라면 안전한 `unknown` 까지) /
이스터에그 팔레트 전환을 실제 브라우저에서 확인한다.

### 네트워크가 막힌 환경에서

기본 빌드(`npm run dict:build`)는 네트워크를 전혀 쓰지 않는다.
`--online` 이 필요한 CI/샌드박스에서는 `ko.wikipedia.org`,
`genshin-impact.fandom.com`, `ko.wiktionary.org`, `opendict.korean.go.kr` 로의
아웃바운드가 열려 있어야 한다.
막혀 있으면 각 소스가 경고를 남기고 시드/캐시로 폴백하므로 빌드 자체는 성공한다.
