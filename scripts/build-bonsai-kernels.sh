#!/bin/bash
# kernels.ts (PrismML Talk, Apache-2.0) を public/bonsai/kernels.js へ ESM トランスパイルする
#
# 前提:
#   scripts/ref/kernels.ts  = https://github.com/PrismML-Eng/Talk の kernels.ts (手動で curl 更新)
#   /tmp/wgputypes/package/dist/index.d.ts = @webgpu/types (import 元で解決できないので明示的に渡す)
#
# 使い方:
#   cd /home/z/my-project && bash scripts/build-bonsai-kernels.sh
#
# 備考:
#   - tsc の型エラー 14 件残るが、いずれも TS5.7 の TypedArray ジェネリクス厳格化による
#     型レベルのみの差 (upstream は古い TS で書かれた)。JS 出力には影響しない。
#   - target es2022 (Object.hasOwn 等)。WebGPU が必要な時点で Safari 18+ / iOS 18+ 相当が
#     実質下限なので問題ない。
set -e
cd /home/z/my-project

OUT_DIR=/tmp/bonsai-build/out
mkdir -p "$OUT_DIR" public/bonsai

./node_modules/.bin/tsc \
  --target es2022 \
  --module es2020 \
  --moduleResolution bundler \
  --lib es2022,dom \
  --skipLibCheck \
  --outDir "$OUT_DIR" \
  scripts/ref/kernels.ts /tmp/wgputypes/package/dist/index.d.ts || true

cp "$OUT_DIR/kernels.js" public/bonsai/kernels.js
echo "deployed: $(wc -c < public/bonsai/kernels.js) bytes"
node --input-type=module -e "import('/home/z/my-project/public/bonsai/kernels.js').then(m => console.log('smoke import OK: Bonsai =', typeof m.Bonsai)).catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); })" 2>/dev/null
