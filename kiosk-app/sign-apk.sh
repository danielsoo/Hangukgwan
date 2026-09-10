#!/usr/bin/env bash
# 서명 안 된 APK 에 한국관 서명키를 찍는다.
#
#   ./sign-apk.sh build/dist/hangukgwan-pos-1.2-unsigned.apk
#
# 왜 따로 있나 — 2026-09-10:
# aapt2 는 x86-64 실행 파일만 배포된다(npm aaptjs3). 애플 실리콘 맥은 로제타로
# 돌리지만, arm64 리눅스에는 그런 게 없어서 거기서는 빌드 자체가 안 된다.
# 반면 서명(apksigner.jar)은 순수 자바라 어디서든 돈다. 그래서 빌드는 되는
# 기계에서 하고, 서명만 키가 있는 기계에서 하는 길을 열어 둔다.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

. "$HERE/tools.sh"

IN="${1:-}"
if [ -z "$IN" ] || [ ! -f "$IN" ]; then
  echo "사용법: ./sign-apk.sh <서명 안 된 .apk>" >&2
  exit 1
fi

KEYSTORE="$HERE/keystore/hangukgwan.jks"
KS_PASS="${KS_PASS:-hangukgwan}"
KEY_ALIAS=hangukgwan
MIN_SDK=21

if [ ! -f "$KEYSTORE" ]; then
  echo "!! 서명키가 없습니다: $KEYSTORE" >&2
  echo "   이 키가 있는 기계에서 실행하세요. 다른 키로 서명하면 태블릿에 이미" >&2
  echo "   깔린 앱을 덮어 설치하지 못합니다." >&2
  exit 1
fi

if [ ! -f "$APKSIGNER_JAR" ]; then
  # 서명만 할 때도 도구는 한 번 받아야 한다. fetch_tools 는 마지막에 aapt2 가
  # 도는지 확인하고 안 되면 exit 하는데, 여기서는 그게 안 돌아도 상관없다 —
  # 그래서 서브셸에서 부른다(파일은 디스크에 남고, exit 는 거기서 끝난다).
  ( fetch_tools ) || true
fi
if [ ! -f "$APKSIGNER_JAR" ]; then
  echo "!! apksigner.jar 이 없습니다: $APKSIGNER_JAR" >&2
  exit 1
fi

case "$IN" in
  *-unsigned.apk) OUT="${IN%-unsigned.apk}.apk" ;;
  *.apk)          OUT="${IN%.apk}-signed.apk" ;;
  *)              OUT="$IN-signed.apk" ;;
esac

java -jar "$APKSIGNER_JAR" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KEY_ALIAS" \
  --min-sdk-version "$MIN_SDK" \
  --out "$OUT" \
  "$IN"

java -jar "$APKSIGNER_JAR" verify --print-certs "$OUT" | head -3

echo
echo "APK: $OUT"
ls -lh "$OUT"
