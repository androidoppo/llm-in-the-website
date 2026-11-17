#!/bin/bash
# git パッチ生成スクリプト
set -e
D=/home/z/my-project/llm-in-the-website
S=/tmp/feature-saves
OUT=/home/z/my-project/download

cd "$D"

# --- 検証: feature-save の 6 ファイルに主要マーカーがあること（バイトレベル） ---
python3 - <<'PYEOF'
import sys
checks = {
    "/tmp/feature-saves/types.ts": [b"KvCacheType", b"LoraAdapter", b"cacheTypeK", b"cacheTypeV"],
    "/tmp/feature-saves/settingsStore.ts": [b"KV_CACHE_TYPE_OPTIONS", b"cacheTypeK"],
    "/tmp/feature-saves/appConfig.ts": [b"CACHE_TYPE_K", b"CACHE_TYPE_V"],
    "/tmp/feature-saves/engineStore.ts": [b"isGgufFileName", b"loraAdapters", b"buildLoraAdaptersParams", b"resolveEnabledLoras", b"const blobs = [modelBlob, ...loraBlobs];"],
    "/tmp/feature-saves/LeftPanel.tsx": [b"LoraSection", b"addLoraFiles"],
    "/tmp/feature-saves/RightPanel.tsx": [b"KvCacheSection", b"cache-type-k"],
}
bad = []
for p, keys in checks.items():
    d = open(p, "rb").read()
    for k in keys:
        if k not in d:
            bad.append((p, k))
if bad:
    for p, k in bad:
        print("MISSING:", p, k)
    sys.exit(1)
print("feature-saves OK")
PYEOF

# --- git 初期化 ---
rm -rf .git
git init -q -b main
git config user.name "dev"
git config user.email "dev@example.com"

cat > .gitignore <<'EOF'
node_modules/
.next/
out/
*.log
.env*
!.env.example
.DS_Store
*.tsbuildinfo
next-env.d.ts
EOF

# --- コミット 1: ベースライン (v0.2.1 = 機能追加前) ---
git add -A
git commit -q -m "baseline v0.2.1"

# --- コミット 2: 機能実装（バグ修正 + KV キャッシュ GUI + LoRA） ---
cp "$S/types.ts" src/lib/types.ts
cp "$S/settingsStore.ts" src/lib/settingsStore.ts
cp "$S/appConfig.ts" src/config/appConfig.ts
cp "$S/engineStore.ts" src/lib/engineStore.ts
cp "$S/LeftPanel.tsx" src/components/panels/LeftPanel.tsx
cp "$S/RightPanel.tsx" src/components/panels/RightPanel.tsx

git add -A
git commit -q -F - <<'MSG'
fix+feat: GGUF 判定の修正、KV キャッシュ量子化 GUI、LoRA アダプタ対応

fix: .gguf ファイルが「GGUF 形式ではない」と弾かれる不具合を修正

- wllama の isValidGgufFile はパス/URL の文字列を受け取る API であり、
  File オブジェクトを渡すと [object File] に文字列化されて常に false に
  なっていた（ローカルの .gguf ファイルがインポートできなかった原因）。
- 拡張子が .gguf かどうか（大文字小文字を問わず、クエリ文字列付き URL も
  許容）をファイル名文字列で判定する isGgufFileName() を新設し、
  モデル / LoRA の File 判定と URL 判定の両方で使用する。

feat: GUI から KV キャッシュの量子化タイプを変更可能に

- appConfig.ts に CACHE_TYPE_K / CACHE_TYPE_V（既定 f16）を追加。
- types.ts に KvCacheType（f32/f16/q8_0/q5_1/q5_0/q4_1/q4_0）を追加。
- settingsStore.ts に cacheTypeK / cacheTypeV を追加し localStorage に
  永続化。旧バージョンの保存データとの互換のため既定値とマージする。
- 右パネルに「KV キャッシュ」セクションを追加（K / V を個別に選択）。
- V キャッシュを f16 以外にする場合は Flash Attention が必須という
  llama.cpp の制約のため、ロード時に flash_attn を自動有効化し、
  cache_type_k / cache_type_v を wllama の loadModel に渡す。

feat: LoRA アダプタを GUI から追加・管理可能に

- 左パネルに「LoRA アダプタ」セクションを追加。ローカルの .gguf
  ファイルまたは URL で追加し、scale（0〜2）スライダー、有効 / 無効
  トグル、削除が可能。
- 登録された LoRA はメモリ上でのみ保持（ページ再読み込み後は再登録）。
- モデルロード時に wllama の lora_adapters に渡す。wllama は渡された
  blob 順に model-XXXXX-of-XXXXX.gguf として MEMFS に登録するため、
  モデル blob の後ろに LoRA blob を連結し仮想パスを生成する。
- LoRA ありで URL ロードする場合はモデルを自前でダウンロードして
  loadModel(blobs) に合流する（split GGUF との同時使用は未対応）。
MSG

# --- 統計確認 ---
git log --oneline
git diff HEAD~1 --stat

# --- パッチ生成 ---
mkdir -p "$OUT"
git format-patch -1 -o /tmp/patch-out
ls /tmp/patch-out
cp /tmp/patch-out/*.patch "$OUT/llm-in-the-website-gguf-fix-kv-lora.patch"
echo "--- DONE ---"
