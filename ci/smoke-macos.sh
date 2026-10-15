#!/usr/bin/env bash
# 用法:ci/smoke-macos.sh <Typoza.app 路径> <输出目录>
# 以冒烟模式启动打包好的应用:编辑器就绪后自检、截图、写 smoke.json 并退出。超时 120 秒判失败。
set -euo pipefail
app="${1:?需要 .app 路径}"
out="${2:?需要输出目录}"
mkdir -p "$out"
start=$(python3 -c 'import time; print(time.time())')
perl -e 'alarm shift; exec @ARGV' 120 "$app/Contents/MacOS/Typoza" --smoke-out "$out"
end=$(python3 -c 'import time; print(time.time())')
python3 - "$out/smoke.json" "$start" "$end" <<'PY'
import json, sys
path, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
report = json.load(open(path))
report["wallSeconds"] = round(end - start, 3)
json.dump(report, open(path, "w"), ensure_ascii=False, indent=2)
print(json.dumps(report, ensure_ascii=False, indent=2))
if "error" in report or not report.get("result", {}).get("ok"):
    sys.exit("冒烟自检失败")
PY
