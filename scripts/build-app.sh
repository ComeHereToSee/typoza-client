#!/usr/bin/env bash
# 用法:scripts/build-app.sh <输出目录>
# 在 macOS CI 上组装 Typoza.app(通用二进制 arm64 + x86_64,ad-hoc 签名)。
# 前置:editor/dist 已构建;helper/dist/typoza-helper-darwin-{arm64,amd64} 已交叉编译。
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out="${1:?需要输出目录}"
version="${TYPOZA_VERSION:-0.1.0}"
build="${TYPOZA_BUILD:-${GITHUB_RUN_NUMBER:-0}}"

[ -f "$root/editor/dist/index.html" ] || { echo "缺少 editor/dist,先构建编辑器" >&2; exit 1; }

cd "$root/app"
swift build -c release --arch arm64 --arch x86_64
bin_dir="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"

app="$out/Typoza.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/Typoza" "$app/Contents/MacOS/Typoza"
lipo -create \
  "$root/helper/dist/typoza-helper-darwin-arm64" \
  "$root/helper/dist/typoza-helper-darwin-amd64" \
  -output "$app/Contents/MacOS/typoza-helper"
# CI 的 artifact 上传下载会丢掉可执行位,这里显式补上
chmod 755 "$app/Contents/MacOS/typoza-helper"
cp -R "$root/editor/dist" "$app/Contents/Resources/editor"
if [ -f "$root/app/Support/AppIcon.icns" ]; then cp "$root/app/Support/AppIcon.icns" "$app/Contents/Resources/"; fi
sed -e "s/__VERSION__/$version/" -e "s/__BUILD__/$build/" "$root/app/Support/Info.plist" > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist"

# 先签内嵌可执行文件,再签整个包;没有开发者证书,用 ad-hoc 签名(首次打开需右键→打开)
codesign --force --sign - --timestamp=none "$app/Contents/MacOS/typoza-helper"
codesign --force --sign - --timestamp=none "$app"
codesign --verify --strict --verbose=2 "$app"
[ -x "$app/Contents/MacOS/typoza-helper" ] || { echo "typoza-helper 不可执行" >&2; exit 1; }
du -sh "$app"
