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

. "$HERE/tools.sh"
fetch_tools bundletool

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
