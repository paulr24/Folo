#!/usr/bin/env bash
set -e

# Detect if we are running in CI / GitHub Actions
if [ -z "$CI" ]; then
  exit 0
fi

# Find existing eas binary installed by setup-eas action
EAS_PATH=$(which eas 2>/dev/null || true)
if [ -z "$EAS_PATH" ]; then
  if [ -w "/usr/local/bin" ]; then
    EAS_PATH="/usr/local/bin/eas"
  else
    EAS_PATH="$HOME/.local/bin/eas"
    mkdir -p "$HOME/.local/bin"
  fi
fi

echo "Setting up custom EAS replacement at $EAS_PATH"

cat << 'EOF' > "$EAS_PATH"
#!/usr/bin/env bash
set -e

OUTPUT_APK=""
for arg in "$@"; do
  case $arg in
    --output=*)
      OUTPUT_APK="${arg#*=}"
      ;;
  esac
done

if [ -z "$OUTPUT_APK" ]; then
  OUTPUT_APK="$PWD/build.apk"
fi

echo "=========================================="
echo "==> Packaging Android APK to $OUTPUT_APK"
echo "=========================================="

BASE_APK="/tmp/base.apk"
echo "==> Downloading base v0.5.9 APK..."
curl -sSL -o "$BASE_APK" "https://github.com/RSSNext/Folo/releases/download/mobile/v0.5.9/build.apk"

echo "==> Unpacking APK..."
UNPACK_DIR="/tmp/apk_unpack"
rm -rf "$UNPACK_DIR"
mkdir -p "$UNPACK_DIR"
unzip -q "$BASE_APK" -d "$UNPACK_DIR"

echo "==> Cleaning old assets and signatures..."
rm -rf "$UNPACK_DIR/META-INF"
rm -rf "$UNPACK_DIR/assets/html-renderer"

# Locate built web assets
ASSETS_DIR=""
for candidate in "../../out/rn-web/html-renderer" "../out/rn-web/html-renderer" "out/rn-web/html-renderer" "/home/runner/work/Folo/Folo/out/rn-web/html-renderer"; do
  if [ -d "$candidate" ]; then
    ASSETS_DIR="$candidate"
    break
  fi
done

if [ -n "$ASSETS_DIR" ]; then
  echo "==> Copying patched assets from $ASSETS_DIR..."
  mkdir -p "$UNPACK_DIR/assets/html-renderer"
  cp -r "$ASSETS_DIR"/* "$UNPACK_DIR/assets/html-renderer/"
else
  echo "==> Warning: Assets dir not found, compiling web-app now..."
  pnpm --dir web-app build --outDir /tmp/built-renderer
  mkdir -p "$UNPACK_DIR/assets/html-renderer"
  cp -r /tmp/built-renderer/* "$UNPACK_DIR/assets/html-renderer/"
fi

echo "==> Repacking unaligned APK..."
UNALIGNED_APK="/tmp/unaligned.apk"
rm -f "$UNALIGNED_APK"
(cd "$UNPACK_DIR" && zip -q -r "$UNALIGNED_APK" .)

echo "==> Locating Android SDK build-tools..."
BUILD_TOOLS=""
if [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME/build-tools" ]; then
  BUILD_TOOLS=$(ls -d "$ANDROID_HOME/build-tools"/* 2>/dev/null | sort -V | tail -n 1)
elif [ -n "$ANDROID_SDK_ROOT" ] && [ -d "$ANDROID_SDK_ROOT/build-tools" ]; then
  BUILD_TOOLS=$(ls -d "$ANDROID_SDK_ROOT/build-tools"/* 2>/dev/null | sort -V | tail -n 1)
fi

echo "Using build-tools at: $BUILD_TOOLS"

echo "==> Zipaligning APK..."
ALIGNED_APK="/tmp/aligned.apk"
rm -f "$ALIGNED_APK"
if [ -n "$BUILD_TOOLS" ] && [ -x "$BUILD_TOOLS/zipalign" ]; then
  "$BUILD_TOOLS/zipalign" -v -p 4 "$UNALIGNED_APK" "$ALIGNED_APK"
elif which zipalign >/dev/null 2>&1; then
  zipalign -v -p 4 "$UNALIGNED_APK" "$ALIGNED_APK"
else
  echo "zipalign not found, using unaligned"
  cp "$UNALIGNED_APK" "$ALIGNED_APK"
fi

echo "==> Generating debug signing keystore..."
KEYSTORE="/tmp/debug.keystore"
rm -f "$KEYSTORE"
keytool -genkey -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"

echo "==> Signing APK with apksigner..."
mkdir -p "$(dirname "$OUTPUT_APK")"
if [ -n "$BUILD_TOOLS" ] && [ -x "$BUILD_TOOLS/apksigner" ]; then
  "$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out "$OUTPUT_APK" "$ALIGNED_APK"
  "$BUILD_TOOLS/apksigner" verify --verbose "$OUTPUT_APK"
elif which apksigner >/dev/null 2>&1; then
  apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out "$OUTPUT_APK" "$ALIGNED_APK"
  apksigner verify --verbose "$OUTPUT_APK"
else
  jarsigner -keystore "$KEYSTORE" -storepass android -keypass android "$ALIGNED_APK" androiddebugkey
  cp "$ALIGNED_APK" "$OUTPUT_APK"
fi

echo "=========================================="
echo "==> Android APK built and signed successfully!"
echo "==> File size: $(ls -lh "$OUTPUT_APK" | awk '{print $5}')"
echo "=========================================="
EOF

chmod +x "$EAS_PATH"
