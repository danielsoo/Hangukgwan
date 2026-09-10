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
    if ! command -v npm >/dev/null 2>&1; then
      echo "!! npm 이 필요합니다 (빌드 도구를 npm 레지스트리에서 받아옵니다)." >&2
      echo "   맥이면:  brew install node" >&2
      exit 1
    fi
    mkdir -p "$npmdir"
    # package.json 을 먼저 놓는다. 없으면 npm 이 상위 폴더로 올라가며
    # 프로젝트 뿌리를 찾고, 엉뚱한 곳에 설치하거나 아무것도 안 하고 끝난다.
    cat > "$npmdir/package.json" <<'JSON'
{ "name": "hangukgwan-android-tools", "version": "1.0.0", "private": true }
JSON
    # 출력을 숨기지 않는다. 2026-09-10 에 --silent 로 가려놔서, 맥에서
    # 설치가 실패했는데 화면에는 그 다음 줄의 cp 오류만 떴다.
    ( cd "$npmdir" && npm install --no-audit --no-fund @drxiaozhi/minapk aaptjs3 )

    local m="$npmdir/node_modules/@drxiaozhi/minapk/tools"
    local os=linux
    case "$(uname -s)" in Darwin) os=darwin ;; esac
    local arch=x64
    case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; esac
    local aapt_src="$npmdir/node_modules/aaptjs3/bin/$arch/$os/aapt2"
    # 애플 실리콘 맥에는 arm64 실행 파일이 없을 수 있다. 그때는 x64 를 쓴다
    # (로제타가 돌려준다).
    [ -x "$aapt_src" ] || aapt_src="$npmdir/node_modules/aaptjs3/bin/x64/$os/aapt2"

    local missing=""
    for f in "$m/android.jar" "$m/d8.jar" "$aapt_src"; do
      [ -e "$f" ] || missing="$missing\n  $f"
    done
    ls "$m"/ecj-*.jar >/dev/null 2>&1 || missing="$missing\n  $m/ecj-*.jar"
    if [ -n "$missing" ]; then
      echo >&2
      echo "!! npm 설치가 끝났는데 도구가 없습니다:$(printf "$missing")" >&2
      echo "   위 npm 출력에 이유가 있습니다. $TOOLS 를 지우고 다시 돌려보세요." >&2
      exit 1
    fi

    cp "$m/android.jar" "$ANDROID_JAR"
    cp "$m/d8.jar" "$D8_JAR"
    cp "$m"/ecj-*.jar "$ECJ_JAR"
    cp "$aapt_src" "$AAPT2"
    chmod +x "$AAPT2"
  fi
  if [ ! -f "$BUNDLETOOL" ]; then
    echo "==> bundletool 을 받는 중"
    curl -fL -o "$BUNDLETOOL" \
      "https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
  fi
  # aapt2 가 이 기계에서 실제로 도는지 여기서 확인한다. 안 그러면 1/6 단계에서
  # 알아보기 어려운 오류로 죽는다.
  if ! "$AAPT2" version >/dev/null 2>&1; then
    echo "!! aapt2 가 이 기계에서 실행되지 않습니다: $AAPT2" >&2
    echo "   $TOOLS 를 지우고 다시 돌려보세요." >&2
    exit 1
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
