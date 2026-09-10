#!/usr/bin/env bash
# Builds the 한국관 POS APK without Gradle or the Android SDK installer.
#
# Google's SDK download hosts are blocked from this build environment, so the
# four tools below were pulled from npm packages that vendor them and dropped
# into /opt/andtools:
#   aapt2        (npm aaptjs3 - prebuilt linux binary)
#   android.jar  (npm @drxiaozhi/minapk - API 34 framework stubs)
#   d8.jar       (npm @drxiaozhi/minapk - dexer)
#   apksigner.jar(npm @drxiaozhi/minapk - v2/v3 APK signing)
# Everything else is plain JDK.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

. "$HERE/tools.sh"
fetch_tools

PKG=tw.hangukgwan.kiosk
MIN_SDK=21
TARGET_SDK=36
VERSION_CODE="${VERSION_CODE:-3}"
VERSION_NAME="${VERSION_NAME:-1.2}"

KEYSTORE="$HERE/keystore/hangukgwan.jks"
KS_PASS="${KS_PASS:-hangukgwan}"
KEY_ALIAS=hangukgwan

OUT="$HERE/build"
rm -rf "$OUT"
mkdir -p "$OUT/flat" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/dist"

echo "==> 1/6 aapt2 compile (resources)"
"$AAPT2" compile --dir res -o "$OUT/res.zip"

echo "==> 2/6 aapt2 link (manifest + resources -> base apk, generates R.java)"
"$AAPT2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml \
  "$OUT/res.zip" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --auto-add-overlay

echo "==> 3/6 compile (ecj)"
# Eclipse's compiler rather than javac, and not by preference: this d8/r8
# build fails on ANY javac-produced class that has an InnerClasses attribute
# ("NullPointerException: Cannot invoke String.length()"), inner and anonymous
# classes alike, which is most of MainActivity. The same sources compiled by
# ecj dex cleanly. Targeting 8 keeps the output free of nestmate attributes
# too; nothing here needs a post-8 language feature.
find src "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
java -jar "$ECJ_JAR" \
  -source 8 -target 8 \
  -encoding UTF-8 \
  -nowarn \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt"

echo "==> 4/6 d8 (dex)"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
java -cp "$D8_JAR" com.android.tools.r8.D8 \
  --lib "$ANDROID_JAR" \
  --min-api "$MIN_SDK" \
  --output "$OUT/dex" \
  @"$OUT/classes.txt"

echo "==> 5/6 package"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
( cd "$OUT/dex" && zip -q "$OUT/unsigned.apk" classes.dex )

echo "==> 6/6 sign"
# 서명키가 없는 기계에서 조용히 새 키를 만들면 안 된다. 그렇게 만든 APK 는
# 태블릿에 이미 깔린 앱을 덮어 설치하지 못하고("서명이 다릅니다"), 그 사실을
# 설치하는 순간에야 알게 된다. 키는 맥에만 있다(.gitignore).
if [ ! -f "$KEYSTORE" ]; then
  if [ "${ALLOW_NEW_KEY:-}" = "1" ]; then
    echo "    (ALLOW_NEW_KEY=1 - 새 서명키를 만듭니다. 이 APK 로는 기존 설치를 덮어쓸 수 없습니다)"
    mkdir -p "$(dirname "$KEYSTORE")"
    keytool -genkeypair -v \
      -keystore "$KEYSTORE" \
      -storepass "$KS_PASS" -keypass "$KS_PASS" \
      -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 2048 -validity 10950 \
      -dname "CN=Hangukgwan POS, OU=Kitchen, O=Hangukgwan, L=Tainan, C=TW" >/dev/null 2>&1
  else
    # 여기서 멈추지 않는다. 서명은 순수 자바(apksigner.jar)라 어느 기계에서나
    # 돌아가므로, 키가 없는 기계에서는 서명 전 APK 까지 만들어 두고 그 파일만
    # 키가 있는 기계로 옮기면 된다. build-aab.sh 도 번들을 같은 식으로 넘긴다.
    UNSIGNED="$OUT/dist/hangukgwan-pos-$VERSION_NAME-unsigned.apk"
    cp "$OUT/unsigned.apk" "$UNSIGNED"
    echo >&2
    echo "서명키가 없습니다: $KEYSTORE" >&2
    echo "이 키는 저장소에 없습니다(.gitignore). 서명 안 된 APK 는 태블릿에" >&2
    echo "설치되지 않으므로, 아래 파일을 키가 있는 기계로 옮겨 서명하세요." >&2
    echo >&2
    echo "  서명 전 APK: $UNSIGNED" >&2
    echo >&2
    echo "키가 있는 기계에서:" >&2
    echo "  ./sign-apk.sh hangukgwan-pos-$VERSION_NAME-unsigned.apk" >&2
    echo >&2
    echo "정말로 새 키를 만들어 시험용 APK 를 뽑으려면 ALLOW_NEW_KEY=1 로 다시" >&2
    echo "실행하세요 (그 APK 는 태블릿의 기존 설치를 덮어쓰지 못합니다)." >&2
    exit 0
  fi
fi

APK="$OUT/dist/hangukgwan-pos-$VERSION_NAME.apk"
java -jar "$APKSIGNER_JAR" sign \
  --ks "$KEYSTORE" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KEY_ALIAS" \
  --min-sdk-version "$MIN_SDK" \
  --out "$APK" \
  "$OUT/unsigned.apk"

java -jar "$APKSIGNER_JAR" verify --print-certs "$APK" | head -6

echo
echo "APK: $APK"
ls -lh "$APK"
