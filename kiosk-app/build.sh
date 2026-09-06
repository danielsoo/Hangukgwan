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

TOOLS=/opt/andtools
AAPT2="$TOOLS/aapt2"
ANDROID_JAR="$TOOLS/android.jar"
D8_JAR="$TOOLS/d8.jar"
APKSIGNER_JAR="$TOOLS/apksigner.jar"
ECJ_JAR="$TOOLS/ecj.jar"

PKG=tw.hangukgwan.kiosk
MIN_SDK=21
TARGET_SDK=36
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"

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
if [ ! -f "$KEYSTORE" ]; then
  echo "    (generating a new signing key - keep this file, updates need the same one)"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Hangukgwan POS, OU=Kitchen, O=Hangukgwan, L=Tainan, C=TW" >/dev/null 2>&1
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
