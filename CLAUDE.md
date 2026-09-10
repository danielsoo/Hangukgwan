# 한국관 — 이 저장소에서 일하는 규칙

사장님(Younsoo)은 **여러 세션을 동시에** 쓴다. 클라우드 세션, 맥의 Claude
Code, 다른 창. 그래서 이 저장소는 한 사람이 혼자 쓰는 저장소처럼 굴면
반드시 어긋난다. 아래 두 가지는 매 세션 지켜야 한다.

## 1. 시작할 때와 커밋 직전에 다른 세션 것을 확인한다

작업을 시작하기 전에:

```bash
git fetch origin
git log --oneline -5            # 내가 모르는 커밋이 있나
git log --oneline -3 origin/main
```

**커밋 직전에 한 번 더 본다.** 내가 파일을 고치는 동안 다른 세션이 같은
파일에 커밋을 올렸을 수 있다. 실제로 한 세션 안에서 네 번 일어났다.

모르는 커밋이 있으면 그 위로 올린다. 되돌리거나 무시하지 않는다:

```bash
git stash            # 또는 내 변경을 patch 로 빼둔다
git reset --hard origin/main   # 필요하면 상대 커밋까지 받아온 뒤
git stash pop        # 3-way 로 다시 얹고 충돌을 푼다
```

`package.json` 의 `test` / `test:e2e` 목록은 **양쪽 것을 합친다.** 한쪽으로
덮으면 상대가 새로 넣은 테스트가 조용히 안 돌게 된다.

## 2. 푸시와 배포는 사장님이 한다

`git push` 하지 않는다. 커밋까지만 하고, 몇 개 대기 중인지 알려준다.
배포도 마찬가지다.

## 클라우드 세션 ↔ 맥 미러링

클라우드 샌드박스에서 작업했으면 맥에도 같은 커밋을 넣어야 한다. 맥에서는
절대 푸시하지 않는다.

1. 클라우드: `git format-patch -1 --binary -o /tmp/out`
2. `SendUserFile` → `device_commit_files` 로 맥의 `_to_delete/` 에 넣는다
3. 맥에서 적용한다. 이 마운트는 `git apply --index` 가 자주 실패하고
   `.git` 안의 lock 파일을 지우지 못하므로, 아래 래퍼를 쓰고 작업 파일에만
   적용한 뒤 **패치가 건드린 파일만** 골라 add 한다:

```bash
g() {
  for f in .git/HEAD.lock .git/index.lock .git/packed-refs.lock \
           .git/ORIG_HEAD.lock .git/refs/heads/*.lock .git/logs/*.lock; do
    [ -f "$f" ] && mv "$f" "$f.st_$(date +%s%N)_$RANDOM" 2>/dev/null
  done
  git "$@"
}
g apply "$D/patch"
FILES=$(g apply --numstat "$D/patch" | awk '{print $3}')
g add -A -- $FILES        # git add -A 만 쓰면 사장님의 로컬 변경까지 들어간다
g commit -F "$D/full"
```

4. **트리 해시로 검증한다.** 커밋 메시지가 같아도 내용은 다를 수 있다:

```bash
git rev-parse HEAD^{tree}   # 양쪽에서 같은 값이어야 한다
```

`Qr/app/package-lock.json` 은 맥에 늘 수정된 채로 있다. 우리 커밋에
딸려 들어가지 않게 한다.

## 비밀값

Firebase 서비스 계정 키는 Vercel 환경변수(`FIREBASE_SERVICE_ACCOUNT`)에만
둔다. 저장소에도, 관리자 설정 화면에도 넣지 않는다. `.env` 를 들여다볼 때
값은 절대 찍지 않는다 — 키 이름과 길이까지만.

## 테스트

```bash
cd Qr/app
npm test        # 유닛
npm run test:e2e   # 브라우저(Playwright), 오래 걸린다
```

새 기능에는 테스트를 같이 넣는다. 이 저장소의 테스트는 "동작하는가" 보다
**증상의 원인을 재는** 쪽에 가깝다 — 화면 높이, 글자 크기 비율, 명령 하나의
바이트 수처럼. 사장님이 겪은 문제를 그 자리에서 다시 잡을 수 있어야 한다.
