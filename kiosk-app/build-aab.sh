#!/usr/bin/env bash
# Builds the Play Store upload artifact (.aab) for the internal testing track.
#
# Play does not take a plain APK for a new app any more - it wants an Android
# App Bundle. A bundle is not just a renamed APK: resources have to be linked
# in protobuf form (resources.pb rather than resources.arsc) and the files
# rearranged into bundletool's module layout before bundletool zips it up.
# build.sh still produces the ordinary APK, which is what gets sideloaded onto
# the tablet for testing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# 빌드 도구를 어디서 찾을지.
#
# 2026-09-10 사장님이 맥에서 이 스크립트를 돌렸을 때:
#   ./build-aab.sh: line 36: /opt/andtools/aapt2: No such file or directory
#
# /opt/andtools 는 이 앱을 처음 만든 클라우드 샌드박스에만 있던 경로다.
# 맥에는 없다. 그래서 도구를 직접 받아 $HERE/.tools 에 둔다 — 한 번 받아두면
# 그 다음부터는 그대로 쓴다(.gitignore 에 넣어 저장소에는 안 올린다).
#
# 왜 안드로이드 SDK 를 안 쓰나: 이 앱을 만든 환경에서 구글 SDK 다운로드
# 호스트가 막혀 있었고, 그 뒤로도 Gradle 없이 aapt2/ecj/d8/bundletool 만으로
# 빌드해 왔다. 맥에 SDK 를 새로 깔게 하는 것보다 필요한 다섯 개만 받는 쪽이
# 가볍다.
TOOLS="${ANDTOOLS:-/opt/andtools}"
if [ ! -x "$TOOLS/aapt2" ]; then
  TOOLS="$HERE/.tools"
fi
AAPT2="$TOOLS/aapt2"
ANDROID_JAR="$TOOLS/android.jar"
D8_JAR="$TOOLS/d8.jar"
ECJ_JAR="$TOOLS/ecj.jar"
BUNDLETOOL="$TOOLS/bundletool.jar"

BUNDLETOOL_VERSION=1.18.1

fetch_tools() {
  mkdir -p "$TOOLS"
  local npmdir="$TOOLS/npm"
  if [ ! -f "$ANDROID_JAR" ] || [ ! -f "$D8_JAR" ] || [ ! -f "$ECJ_JAR" ] || [ ! -x "$AAPT2" ]; then
    echo "==> 빌드 도구를 받는 중 ($TOOLS) - 처음 한 번만 걸립니다"
    mkdir -p "$npmdir"
    ( cd "$npmdir" && npm i --silent --no-audit --no-fund --no-package-lock \
        @drxiaozhi/minapk aaptjs3 >/dev/null )
    local m="$npmdir/node_modules/@drxiaozhi/minapk/tools"
    cp "$m/android.jar" "$ANDROID_JAR"
    cp "$m/d8.jar" "$D8_JAR"
    cp "$m"/ecj-*.jar "$ECJ_JAR"
    # aapt2 는 플랫폼별 실행 파일이다. 맥이면 darwin, 리눅스면 linux.
    local os=linux
    case "$(uname -s)" in Darwin) os=darwin ;; esac
    local arch=x64
    cp "$npmdir/node_modules/aaptjs3/bin/$arch/$os/aapt2" "$AAPT2"
    chmod +x "$AAPT2"
  fi
  if [ ! -f "$BUNDLETOOL" ]; then
    echo "==> bundletool 을 받는 중"
    curl -fsSL -o "$BUNDLETOOL" \
      "https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
  fi
}
fetch_tools

if ! command -v java >/dev/null 2>&1; then
  echo "!! java 가 필요합니다 (ecj / d8 / bundletool / jarsigner 가 전부 자바입니다)." >&2
  echo "   맥이면:  brew install openjdk   그리고 안내대로 PATH 에 추가" >&2
  exit 1
fi

MIN_SDK=21
TARGET_SDK=36
VERSION_CODE="${VERSION_CODE:-3}"
VERSION_NAME="${VERSION_NAME:-1.2}"

KEYSTORE="$HERE/keystore/hangukgwan.jks"
KS_PASS="${KS_PASS:-hangukgwan}"
KEY_ALIAS=hangukgwan

OUT="$HERE/build-aab"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/module" "$OUT/dist"

echo "==> 1/6 aapt2 compile"
"$AAPT2" compile --dir res -o "$OUT/res.zip"

echo "==> 2/6 aapt2 link (proto format)"
"$AAPT2" link \
  --proto-format \
  -o "$OUT/base-proto.apk" \
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

echo "==> 5/6 assemble base module"
# bundletool expects the manifest under manifest/, dex under dex/, and the
# proto resource table at the root - not the layout aapt2 emits.
( cd "$OUT/module" && unzip -q "$OUT/base-proto.apk" )
mkdir -p "$OUT/module/manifest" "$OUT/module/dex"
mv "$OUT/module/AndroidManifest.xml" "$OUT/module/manifest/AndroidManifest.xml"
cp "$OUT/dex/classes.dex" "$OUT/module/dex/classes.dex"
( cd "$OUT/module" && zip -qr "$OUT/base.zip" . )

java -jar "$BUNDLETOOL" build-bundle \
  --modules="$OUT/base.zip" \
  --output="$OUT/app.aab" \
  --overwrite

echo "==> 6/6 sign (upload key)"
AAB="$OUT/dist/hangukgwan-pos-$VERSION_NAME.aab"
# An .aab is signed with jarsigner, not apksigner - the APK signature schemes
# don't apply to a bundle. This is only the UPLOAD key: Play re-signs the APKs
# it generates from this bundle with the app signing key it holds.
#
# 서명키는 저장소에 없다(.gitignore). 키가 없는 기계에서는 서명 안 된
# 번들까지 만들어 두고 멈춘다 — Play 는 서명 안 된 것을 받지 않으므로 그
# 파일을 키가 있는 기계로 옮겨 아래 한 줄로 서명하면 된다.
if [ -f "$KEYSTORE" ]; then
  jarsigner -keystore "$KEYSTORE" \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -signedjar "$AAB" \
    -digestalg SHA-256 -sigalg SHA256withRSA \
    "$OUT/app.aab" "$KEY_ALIAS" > /dev/null
else
  UNSIGNED="$OUT/dist/hangukgwan-pos-$VERSION_NAME-unsigned.aab"
  cp "$OUT/app.aab" "$UNSIGNED"
  echo
  echo "서명키가 없습니다: $KEYSTORE"
  echo "서명 안 된 번들: $UNSIGNED"
  echo
  echo "키가 있는 기계에서 이 한 줄로 서명하세요:"
  echo "  jarsigner -keystore kiosk-app/keystore/hangukgwan.jks \\"
  echo "    -storepass $KS_PASS -keypass $KS_PASS \\"
  echo "    -signedjar hangukgwan-pos-$VERSION_NAME.aab \\"
  echo "    -digestalg SHA-256 -sigalg SHA256withRSA \\"
  echo "    hangukgwan-pos-$VERSION_NAME-unsigned.aab $KEY_ALIAS"
  exit 0
fi

java -jar "$BUNDLETOOL" validate --bundle "$AAB" | head -20

echo
echo "AAB: $AAB"
ls -lh "$AAB"
