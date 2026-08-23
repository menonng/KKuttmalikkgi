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
  core/                      정규화·검증·병합·lore·증분·내보내기·런타임 스토어
  net/                       HTTP 캐시, MediaWiki 클라이언트
  sources/                   소스 9종 + 인터페이스/레지스트리
  cli.ts                     CLI
examples/                    예시 출력 JSON, 소스 추가 예제, 서버 사용 예제
scripts/                     벤치마크, 예시 생성기
tests/                       vitest (59 tests)
web/index.html               게임 사이트 UI 시안
```

---

## 개발

```bash
npm test           # vitest
npm run typecheck  # tsc (src + tests + scripts + examples)
npm run build      # dist/ 로 컴파일
npm run bench      # 대규모 빌드 벤치마크
```

### 네트워크가 막힌 환경에서

기본 빌드(`npm run dict:build`)는 네트워크를 전혀 쓰지 않는다.
`--online` 이 필요한 CI/샌드박스에서는 `ko.wikipedia.org`,
`genshin-impact.fandom.com`, `opendict.korean.go.kr` 로의 아웃바운드가 열려 있어야 한다.
막혀 있으면 각 소스가 경고를 남기고 시드/캐시로 폴백하므로 빌드 자체는 성공한다.
