/**
 * ============================================================
 * アプリ統一設定（APP_CONFIG）
 * ============================================================
 * すべてのオプションはこの 1 オブジェクトに集約する。
 * 値を一括変更したい場合はこのファイルだけを編集すればよい。
 *
 * 変数一覧（開発計画書 M-1〜M-7 / 設計章に対応）:
 *  1. DEFAULT_MODEL_URL      既定モデルの URL（URL 导入の初期値）
 *  2. N_CTX                  コンテキスト長（初回ロード時に使用）
 *  3. N_CTX_FALLBACK_LADDER  メモリ不足時に段階的に試すコンテキスト長
 *  4. N_GPU_LAYERS           GPU へオフロードするレイヤー数（999 = 全レイヤー）
 *  5. N_THREADS              CPU スレッド数（0 = 自動）
 *  6. N_BATCH                バッチサイズ
 *  7. FLASH_ATTN             Flash Attention の有効化
 *  8. TEMPERATURE            生成温度
 *  9. TOP_P                  nucleus sampling
 * 10. MAX_NEW_TOKENS         1 回の生成で出力する最大トークン数
 * 11. STOP_SEQUENCES         停止シーケンス
 * 12. SYSTEM_PROMPT          既定のシステムプロンプト
 * 13. CONTEXT_WARNING_RATIO  コンテキスト使用率の警告しきい値（0.8 = 80%）
 * 14. CACHE_TYPE_K / CACHE_TYPE_V  KV キャッシュの量子化タイプ（GUI から変更可）
 * 15. MAX_MODEL_FILE_SIZE_MEMORY64  memory64 対応ブラウザでの単一ファイル上限
 * 16. AUTO_CPU_FALLBACK    WebGPU ロード失敗時に CPU (WASM) へ自動フォールバック
 */

/** 既定モデル: ggml-org/Qwen3-0.6B-GGUF（Q4_0 / 約 410MB / チャットテンプレート同梱） */
export const DEFAULT_MODEL_URL =
  "https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf";

export const APP_CONFIG = {
  // ---------- モデル ----------
  DEFAULT_MODEL_URL,
  MAX_MODEL_FILE_SIZE: 2 * 1024 * 1024 * 1024, // wasm32 の単一ファイル上限 (2GB)
  /** memory64 対応ブラウザ（Safari 18.2+ / Chrome 133+ など）での単一ファイル上限。
   *  wllama 自体は 2GB 超を保証していないため、超過時は「試行」してから
   *  失敗時に分割 GGUF を案内する用途。 */
  MAX_MODEL_FILE_SIZE_MEMORY64: 4 * 1024 * 1024 * 1024,
  PARALLEL_DOWNLOADS: 3,

  // ---------- コンテキスト / メモリ対策 (M-4: N_CTX 階梯回退) ----------
  N_CTX: 4096,
  N_CTX_FALLBACK_LADDER: [2048, 1024] as number[],
  CONTEXT_WARNING_RATIO: 0.8,

  // ---------- 推論バックエンド ----------
  /** GPU にオフロードするレイヤー数。999 = 全レイヤー（WebGPU が使える環境のみ有効） */
  N_GPU_LAYERS: 999,
  N_THREADS: 0, // 0 = 自動
  N_BATCH: 512,
  FLASH_ATTN: true,
  /** WebGPU でのロード / 推論に失敗した場合に CPU (WASM) へ自動で切り替える。
   *  iPadOS Safari のように WebGPU アダプタは取得できるがモデルロードに
   *  失敗する環境向けの安全策。 */
  AUTO_CPU_FALLBACK: true,

  // ---------- KV キャッシュ量子化（GUI から変更可・次回ロード時に適用） ----------
  /** V キャッシュを f16 以外にする場合は Flash Attention が必要（自動で有効化） */
  CACHE_TYPE_K: "f16",
  CACHE_TYPE_V: "f16",

  // ---------- 生成パラメータ ----------
  TEMPERATURE: 0.8,
  TOP_P: 0.9,
  MAX_NEW_TOKENS: 1024,
  STOP_SEQUENCES: [] as string[],
  SYSTEM_PROMPT: "あなたは親切で簡潔な日本語アシスタントです。",

  // ---------- wllama アセット（自己ホスト） ----------
  WASM_PATHS: {
    default: "/wllama/wllama.wasm",
  } as const,
  /** Safari / Firefox 用 compat ビルド (M-1: compat 自動切替) */
  COMPAT_ASSETS: {
    wasm: "/wllama-compat/wllama.wasm",
    worker: "/wllama-compat/wllama.js",
  },
  /** 'safari' のみ / 'firefox_safari' = Firefox でも compat で WebGPU を試行 */
  COMPAT_MODE: "firefox_safari" as "safari" | "firefox_safari",

  // ---------- ストレージ ----------
  /** チャット履歴 localStorage のキー */
  CHAT_STORAGE_KEY: "wllama-chat-v1",
  /** 生成パラメータ localStorage のキー */
  SETTINGS_STORAGE_KEY: "wllama-settings-v1",
} as const;

export type AppConfig = typeof APP_CONFIG;
