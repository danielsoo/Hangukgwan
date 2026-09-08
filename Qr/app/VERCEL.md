# 배포 설정 (`vercel.json`) — 왜 이렇게 되어 있나

`vercel.json` 은 **주석을 넣을 수 없다.** JSON 에 주석이 없어서
`"// outputDirectory"` 같은 키로 우회했더니 Vercel 스키마 검사가
`should NOT have additional property` 로 **배포를 실패**시켰다
(2026-09-08). 설명은 전부 이 파일에 둔다.

`test/deploy-config.test.js` 가 이 규칙과 아래 내용을 지킨다.

---

## `outputDirectory: "site"`

이게 없으면 아래 포괄 `rewrites` 가 모든 요청을 서버리스 함수로 넘기고,
함수 응답은 `s-maxage` 가 없으면 엣지에 캐시되지 않는다. 배포본을 재보니
파일명에 내용 해시가 박혀 절대 안 바뀌는 `/_next/static/*` 조차 요청마다
`x-vercel-cache: MISS` 였다 — 방문자마다, 파일마다 함수가 깨어났다.

`site/` 를 정적 출력으로 올리면 Vercel 이 파일시스템을 먼저 보고 CDN 에서
바로 내보낸다. 합치기 전 홈페이지가 정적 배포라 빨랐던 상태로 돌아가면서,
한 주소·한 쿠키 구조는 그대로다.

`scripts/build-site.js` 가 `Web/` 을 못 찾아도 `site/` 를 **항상** 만든다.
안 만들면 Vercel 이 outputDirectory 를 못 찾아 배포 자체가 죽는다.

**Vercel 프로젝트 설정에서 Root Directory = `Qr/app`, 그리고 "Include files
outside of the Root Directory in the Build Step" 를 켜야** `../../Web` 이 보인다.

## `rewrites` — 순서가 중요하다

위에서부터 먼저 맞는 것이 이기고, **하나만 적용하고 멈춘다**(맞는 규칙의
대상이 없어도 다음 규칙으로 넘어가지 않는다).

```
1. /                        → /index.html
2. /:page(about|...)/       → /:page/index.html
3. /(.*)                    → /api/index
```

1·2번이 필요한 이유: Vercel 은 요청 경로와 파일 경로가 **정확히 같을 때만**
파일시스템에서 바로 집어낸다. `/menu/` → `menu/index.html` 처럼 색인 파일을
한 단계 더 찾아야 하는 경우는 그 아래 단계에서 처리하는데, 3번이 그보다
먼저 걸려서 전부 함수로 끌고 갔다(응답에 `x-powered-by: Express` 가 붙어
있었고 계속 `MISS`).

**페이지 목록을 직접 적은 이유**: `/:page/` 같은 포괄 규칙을 쓰면 `/admin/`
처럼 이 앱이 직접 처리해야 하는 주소까지 존재하지 않는 정적 파일로 보내서
404 가 된다. 목록이 낡는 문제는 테스트가 `Web/src/app` 과 대조해 잡는다.

1번 때문에 `site/index.html` 이 없으면 `/` 가 404 가 되므로, 홈페이지 빌드가
없을 때는 `build-site.js` 가 `/admin` 으로 보내는 최소 `index.html` 을 남긴다.

## `headers` — 브라우저용이다

`site/` 안의 파일은 Vercel 이 정적 자산으로 CDN 에서 내보내므로 엣지 캐시는
알아서 되고, **배포할 때마다 자동으로 비워진다.** 여기 값들은 브라우저에게
하는 말이다.

**`stale-while-revalidate` 는 쓰지 않는다.** 공유 캐시뿐 아니라 브라우저
캐시에도 적용되는 지시어라, 크롬이 페이지를 열 때마다 배경 재검증 요청을
하나씩 더 만든다 — 요청을 줄이려다 늘어난다(브라우저 테스트가 `networkidle`
에 영영 도달하지 못해서 드러났다).

함수가 답하는 경로(정적이 놓친 것)를 엣지에 캐시시키려면 `Cache-Control` 의
**`s-maxage`** 를 쓴다 — `src/site.js` 와 `src/routes/account.js` 의
`/methods` 가 그렇게 한다. `CDN-Cache-Control` 도 시도했지만 배포본에서
동작하지 않았다.

## `functions.includeFiles`

`{public,site}/**` — `public/` 은 함수가 `sendFile` 로 쓰고(`/admin`,
`/t/:n`), `site/` 는 정적 서빙이 놓친 경로(슬래시 없는 `/login` 등)를 함수가
대신 답하기 위해 필요하다.

## `crons`

매일 21:30(타이베이) 정산 마감. `CRON_SECRET` 환경변수가 없으면 코드가
검사를 건너뛰므로 **누구나 호출할 수 있다** — `src/routes/settlements.js` 참고.
