# Browser LLM Chat — wllama (WebGPU / WASM)

GGUF モデルをブラウザ内で直接実行するチャットアプリケーション。
推論エンジンには [wllama](https://github.com/ngxson/wllama)（llama.cpp の WASM ビルド）を使用し、
**WebGPU バックエンドを主軸**として動作します。すべての推論はブラウザ内で完結し、
テキストがサーバーへ送信されることはありません。

## 主な機能

- **WebGPU による GPU 推論**（非対応環境では WASM / CPU へ自動フォールバック）
- **GGUF モデルの 2 種類の导入方法**
  - URL 导入: Hugging Face などの直リンク（split GGUF の先頭ファイルを指定すると自動連結）
  - ファイル导入: ローカルの `.gguf` を複数選択（split GGUF 対応）
- **チャット履歴の管理**（localStorage 持続化）: 作成 / 削除 / 切り替え
- **メッセージ操作**: コピー / 編集（以降を再生成）/ 削除 / 任意の応答からの再生成 / 生成中断
- **トークン消費量の計測**: メッセージ別・チャット別・セッション累計 + コンテキスト使用率の可視化（80% で警告）
- **タブメモリ対策**: compat ビルド自動切替 / GPU オフロード / split GGUF / N_CTX 階梯フォールバック（4096→2048→1024）/ Worker 内推論 / 明示的アンロード

## オプションの一元管理

すべてのオプション（コンテキスト長、GPU レイヤー数、スレッド数、バッチサイズ、
Flash Attention、サンプリングパラメータ、システムプロンプトなど）は
**`src/config/appConfig.ts` の `APP_CONFIG` オブジェクトに集約**されています。
値を一括変更する場合はこのファイルだけを編集してください。

| 変数 | 既定値 | 説明 |
|---|---|---|
| `DEFAULT_MODEL_URL` | ggml-org/Qwen3-0.6B-GGUF (Q4_0) | URL 导入の初期値 |
| `N_CTX` | 4096 | コンテキスト長 |
| `N_CTX_FALLBACK_LADDER` | [2048, 1024] | メモリ不足時のフォールバック階梯 |
| `N_GPU_LAYERS` | 999（全レイヤー） | GPU オフロード数。0 で CPU 強制 |
| `N_THREADS` | 0（自動） | CPU スレッド数 |
| `N_BATCH` | 512 | バッチサイズ |
| `FLASH_ATTN` | true | Flash Attention |
| `TEMPERATURE` / `TOP_P` / `MAX_NEW_TOKENS` / `STOP_SEQUENCES` / `SYSTEM_PROMPT` | — | 生成パラメータ |
| `CONTEXT_WARNING_RATIO` | 0.8 | コンテキスト警告しきい値 |

## 開発

```bash
bun install
bun run dev     # http://localhost:3000
bun run lint
```

## 静的ホスティング（Cloudflare Pages）へのデプロイ

本アプリは COOP/COEP ヘッダによる **crossOriginIsolated 環境が必須**です
（マルチスレッド WASM と WebGPU バックエンドの安定動作に必要）。

### Cloudflare Pages の場合

1. ビルドコマンド: `npm run build`（または `bun run build`）
2. 出力ディレクトリ: `.next` を静的エクスポートする構成に変換するか、
   `@cloudflare/next-on-pages` / `@opennextjs/cloudflare` を利用
3. **`public/_headers` を同梱**してください（本リポジトリに含ま済み）:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### その他の静的ホスティング

- GitHub Pages: ヘッダ設定不可のため、マルチスレッドが無効化されます
  （シングルスレッドの WASM ビルドで動作）。Cloudflare Pages / Netlify 等の
  カスタムヘッダ対応ホストを推奨します。
- Netlify: `public/_headers` がそのまま利用されます。

### wllama の WASM アセット

- `public/wllama/wllama.wasm` — 既定ビルド（JSPI + memory64 対応ブラウザ向け）
- `public/wllama-compat/` — Safari / Firefox 用 compat ビルド
  （Asyncify 版。JSPI / memory64 非対応ブラウザで自動使用）

いずれも `@wllama/wllama` / `@wllama/wllama-compat` パッケージ由来の自己ホスト資産で、
外部 CDN への依存はありません。

## モデルの選び方

- 推奨量子化: **Q4 / Q5 / Q6**（IQ 系は非推奨）
- 単一ファイルの上限は **2GB**（wasm32 制約）。超える場合は
  `llama-gguf-split --split-max-size 512M model.gguf model` で分割し、
  先頭ファイル（`-00001-of-0000N.gguf`）を指定してください。
- 既定の Qwen3-0.6B Q4_0（約 410MB）は多くの環境で動作する軽量モデルです。

## 技術スタック

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui
- Zustand（チャット履歴・設定の状態管理 / localStorage 持続化）
- wllama v3.13（llama.cpp WASM + WebGPU）
