# 대량 어휘 코퍼스

`korean_dict` 소스가 이 디렉터리의 TSV 파일을 스트리밍으로 읽는다.
10만 단위 어휘를 넣는 정식 경로다.

## 형식

```
단어<TAB>뜻풀이
```

- 한 줄에 한 단어
- 뜻풀이는 생략 가능(생략하면 `fallbackLore` 가 쓰인다)
- `#` 으로 시작하는 줄은 주석
- UTF-8, 개행은 LF

## 파일 배치

| 파일 | 용도 |
| --- | --- |
| `korean-words.tsv` | 실제 대량 어휘. 저장소에는 커밋하지 않는다(.gitignore). |
| `korean-words.sample.tsv` | 형식 예시 겸 기본 빌드용 최소 데이터. |

`config/builder.config.json` 의 `sources.korean_dict.options.corpusFiles` 로
읽을 파일 목록을 바꿀 수 있다.

## 어디서 채우나

- 우리말샘 오픈 API — `KOREAN_DICT_API_KEY` 를 설정하고 `--online` 으로 빌드
- 국립국어원에서 배포하는 사전 덤프를 위 TSV 형식으로 변환
- 기존 게임 로그에서 뽑아낸 어휘 목록

파일이 커도 메모리에는 한 줄씩만 올라가므로 크기 제한은 사실상 디스크뿐이다.
