#!/usr/bin/env bash
# 把同步核心 typoza-backend/sdk 拷进 helper/third_party/typoza-sdk。
# 后端仓库是私有的,客户端 CI 拉不到,所以随客户端仓库提交一份副本(go.mod 用 replace 指向它)。
# 用法:scripts/vendor-sdk.sh [后端 sdk 目录],默认 ../typoza-backend/sdk。
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-$root/../typoza-backend/sdk}"
dst="$root/helper/third_party/typoza-sdk"
[ -f "$src/go.mod" ] || { echo "找不到 $src/go.mod" >&2; exit 1; }
if [ -n "$(git -C "$src" status --porcelain -- .)" ]; then
  echo "$src 有未提交的修改,先在后端仓库提交再拷贝" >&2
  exit 1
fi
rm -rf "$dst"
mkdir -p "$dst"
# 单元测试留在后端仓库跑;这里只要实现与假服务端(helper 的测试要用)
(cd "$src" && find . -type f ! -name '*_test.go' -print0 | tar --null -cf - -T -) | (cd "$dst" && tar -xf -)
printf 'typoza-backend %s\n' "$(git -C "$src" rev-parse HEAD)" > "$dst/SOURCE"
echo "已拷贝 $(git -C "$src" rev-parse --short HEAD) → $dst"
