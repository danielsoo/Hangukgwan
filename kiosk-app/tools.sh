# 앱 빌드 도구를 어디서 찾고, 없으면 어떻게 받는가.
# build.sh(APK) 와 build-aab.sh(번들) 가 같이 쓴다 — source 로 불러온다.
#
# 2026-09-10 사장님이 맥에서 빌드하려다:
#   ./build-aab.sh: line 36: /opt/andtools/aapt2: No such file or directory
#
# /opt/andtools 는 이 앱을 처음 만든 클라우드 샌드박스에만 있던 경로다.
# 1.1 번들이 거기서 만들어졌고, 그 뒤로 아무도 다른 기계에서 빌드해본 적이
# 없어서 그 경로가 박혀 있는 줄 몰랐다.
#
# 왜 안드로이드 SDK 를 안 쓰나: 이 앱을 만든 환경에서 구글 SDK 다운로드
# 호스트가 막혀 있었고, 그 뒤로도 Gradle 없이 aapt2/ecj/d8 만으로 빌드해 왔다.
# 새 기계에 SDK 를 통째로 깔게 하는 것보다 필요한 몇 개만 받는 쪽이 가볍다.
#
# ANDTOOLS= 로 이미 있는 도구 폴더를 가리킬 수 있다. 없으면 kiosk-app/.tools
# 에 받아둔다(.gitignore, 한 번 받으면 그 다음부터는 그대로 쓴다).

BUNDLETOOL_VERSION=1.18.1

TOOLS="${ANDTOOLS:-/opt/andtools}"
if [ ! -x "$TOOLS/aapt2" ]; then
  TOOLS="$HERE/.tools"
fi
AAPT2="$TOOLS/aapt2"
ANDROID_JAR="$TOOLS/android.jar"
D8_JAR="$TOOLS/d8.jar"
ECJ_JAR="$TOOLS/ecj.jar"
APKSIGNER_JAR="$TOOLS/apksigner.jar"
BUNDLETOOL="$TOOLS/bundletool.jar"

# 사용법: fetch_tools [bundletool]
fetch_tools() {
  local want_bundletool=""
  case "${1:-}" in bundletool) want_bundletool=1 ;; esac

  if ! command -v java >/dev/null 2>&1; then
    echo "!! java 가 필요합니다 (ecj / d8 / apksigner / bundletool / jarsigner 가 전부 자바입니다)." >&2
    echo "   맥이면:  brew install openjdk   그리고 안내대로 PATH 에 추가" >&2
    exit 1
  fi

  mkdir -p "$TOOLS"
  local npmdir="$TOOLS/npm"
  if [ ! -f "$ANDROID_JAR" ] || [ ! -f "$D8_JAR" ] || [ ! -f "$ECJ_JAR" ] \
     || [ ! -f "$APKSIGNER_JAR" ] || [ ! -x "$AAPT2" ]; then
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
    # 출력을 숨기지 않는다. 처음에는 --silent 로 가려놔서, 맥에서 설치가
    # 실패했는데 화면에는 그 다음 줄의 cp 오류만 떴다.
    ( cd "$npmdir" && npm install --no-audit --no-fund @drxiaozhi/minapk aaptjs3 )

    local m="$npmdir/node_modules/@drxiaozhi/minapk/tools"
    # aapt2 는 플랫폼별 실행 파일이다.
    local os=linux
    case "$(uname -s)" in Darwin) os=darwin ;; esac
    local arch=x64
    case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; esac
    local aapt_src="$npmdir/node_modules/aaptjs3/bin/$arch/$os/aapt2"
    # 애플 실리콘에 arm64 실행 파일이 없으면 x64 로 떨어진다(로제타가 돌린다).
    [ -x "$aapt_src" ] || aapt_src="$npmdir/node_modules/aaptjs3/bin/x64/$os/aapt2"

    local missing=""
    for f in "$m/android.jar" "$m/d8.jar" "$m/apksigner.jar" "$aapt_src"; do
      [ -e "$f" ] || missing="$missing
  $f"
    done
    ls "$m"/ecj-*.jar >/dev/null 2>&1 || missing="$missing
  $m/ecj-*.jar"
    if [ -n "$missing" ]; then
      echo >&2
      echo "!! npm 설치가 끝났는데 도구가 없습니다:$missing" >&2
      echo "   위 npm 출력에 이유가 있습니다. $TOOLS 를 지우고 다시 돌려보세요." >&2
      exit 1
    fi

    cp "$m/android.jar" "$ANDROID_JAR"
    cp "$m/d8.jar" "$D8_JAR"
    cp "$m/apksigner.jar" "$APKSIGNER_JAR"
    cp "$m"/ecj-*.jar "$ECJ_JAR"
    cp "$aapt_src" "$AAPT2"
    chmod +x "$AAPT2"
  fi

  if [ -n "$want_bundletool" ] && [ ! -f "$BUNDLETOOL" ]; then
    echo "==> bundletool 을 받는 중"
    curl -fL -o "$BUNDLETOOL" \
      "https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
  fi

  # aapt2 가 이 기계에서 실제로 도는지 여기서 확인한다. 안 그러면 첫 단계에서
  # 알아보기 어려운 오류로 죽는다.
  if ! "$AAPT2" version >/dev/null 2>&1; then
    echo "!! aapt2 가 이 기계에서 실행되지 않습니다: $AAPT2" >&2
    echo "   $TOOLS 를 지우고 다시 돌려보세요." >&2
    exit 1
  fi
}
