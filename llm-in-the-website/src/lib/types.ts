/** チャットアプリ共通の型定義 */

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /**
   * このメッセージのトークン数。
   * - assistant: 生成レスポンスの usage.completion_tokens（実測値）
   * - user / system: 文字数ベースの推定値
   * null = 未計測
   */
  tokenCount: number | null;
  /** 生成が中断されたメッセージか */
  stopped?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** このチャットで累計消費したトークン（prompt + completion の合計） */
  totalTokens: number;
}

/** KV キャッシュの量子化タイプ（wllama cache_type_k / cache_type_v） */
export type KvCacheType = "f32" | "f16" | "q8_0" | "q5_1" | "q5_0" | "q4_1" | "q4_0";

/** LoRA アダプタ（メモリ上のみ。ページ再読込後は再登録が必要） */
export interface LoraAdapter {
  id: string;
  /** 表示名（ファイル名 or URL から抽出） */
  name: string;
  /** 登録元: ローカルファイル or URL */
  kind: "file" | "url";
  /** kind = "url" のときのダウンロード元 URL */
  url?: string;
  /** kind = "file" のときの生ファイル（Blob 参照、メモリ上のみ） */
  file?: File;
  sizeBytes: number | null;
  /** 適用強度（llama.cpp の lora scale。1.0 が既定） */
  scale: number;
  /** 無効化されている場合はモデルロード時に適用されない */
  enabled: boolean;
}

/** 生成パラメータ（appConfig の値を初期値として UI から上書きできる） */
export interface GenerationParams {
  temperature: number;
  topP: number;
  maxNewTokens: number;
  /** UI 上はカンマ区切り文字列で編集する */
  stopSequences: string;
  systemPrompt: string;
  /** KV キャッシュ (K) の量子化タイプ。次回モデルロード時に適用 */
  cacheTypeK: KvCacheType;
  /** KV キャッシュ (V) の量子化タイプ。f16 以外は Flash Attention が必須（自動有効化） */
  cacheTypeV: KvCacheType;
}

/** モデルの稼働状態 */
export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface LoadProgress {
  loaded: number;
  total: number;
  percentage: number;
}
