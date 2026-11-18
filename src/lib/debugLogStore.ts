"use client";

/**
 * デバッグログストア（Zustand・メモリ上のみ・非永続化）。
 *
 * - wllama の logger 出力 / アプリ内部ログ / ブラウザの未処理例外を収集する
 * - GUI（DebugLogDialog）から閲覧・フィルタ・コピー・ファイル保存ができる
 * - リングバッファ: MAX_LOGS 件を超えると古いものから捨てる
 */
import { create } from "zustand";

export type DebugLogLevel = "debug" | "info" | "warn" | "error";
export type DebugLogSource = "wllama" | "app" | "browser";

export interface DebugLogEntry {
  id: number;
  /** エポックミリ秒 */
  ts: number;
  level: DebugLogLevel;
  source: DebugLogSource;
  message: string;
}

/** 保持する最大ログ件数（これを超えると古い順に破棄） */
export const MAX_LOGS = 1500;

/** UI で一度に描画する最大件数（パフォーマンス保護。最新側を表示） */
export const RENDER_LIMIT = 400;

interface DebugLogState {
  entries: DebugLogEntry[];
  /** 収集の有効 / 無効（無効時はコンソール出力のみ） */
  captureEnabled: boolean;
  push: (level: DebugLogLevel, source: DebugLogSource, message: string) => void;
  pushArgs: (level: DebugLogLevel, source: DebugLogSource, args: unknown[]) => void;
  clear: () => void;
  setCaptureEnabled: (v: boolean) => void;
}

let nextId = 1;

function pushEntry(
  level: DebugLogLevel,
  source: DebugLogSource,
  message: string
): DebugLogEntry | null {
  const { captureEnabled, entries } = useDebugLogStore.getState();
  if (!captureEnabled) return null;
  const entry: DebugLogEntry = { id: nextId++, ts: Date.now(), level, source, message };
  const next = entries.length >= MAX_LOGS ? entries.slice(entries.length - MAX_LOGS + 1) : entries;
  useDebugLogStore.setState({ entries: [...next, entry] });
  return entry;
}

export const useDebugLogStore = create<DebugLogState>((set) => ({
  entries: [],
  captureEnabled: true,

  push: (level, source, message) => {
    void pushEntry(level, source, message);
  },

  pushArgs: (level, source, args) => {
    void pushEntry(level, source, formatLogArgs(args));
  },

  clear: () => set({ entries: [] }),

  setCaptureEnabled: (v) => set({ captureEnabled: v }),
}));

/** モジュール外部から手軽にログを流すヘルパ */
export function pushDebugLog(
  level: DebugLogLevel,
  source: DebugLogSource,
  message: string
): void {
  void pushEntry(level, source, message);
}

/** 任意の値を 1 行（または複数行）の文字列に整形する */
export function formatLogValue(v: unknown): string {
  if (v instanceof Error) {
    const stack = v.stack?.split("\n").slice(0, 4).join("\n");
    return stack ? `${v.name}: ${v.message}\n${stack}` : `${v.name}: ${v.message}`;
  }
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) {
    return String(v);
  }
  try {
    return JSON.stringify(v, null, 0) ?? String(v);
  } catch {
    // 循環参照など JSON 化できない場合は文字列化にフォールバック
    return String(v);
  }
}

function formatLogArgs(args: unknown[]): string {
  return args.map(formatLogValue).join(" ");
}

// ---------------------------------------------------------------
// ブラウザ例外フック（window error / unhandledrejection）
// ---------------------------------------------------------------

let hooksInstalled = false;

/** page.tsx のマウント時に一度だけ呼ぶ。未処理例外をログへ収集する */
export function installBrowserErrorHooks(): void {
  if (hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;

  window.addEventListener("error", (e) => {
    const loc = e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno}:${e.colno})` : "";
    void pushEntry("error", "browser", `${e.message}${loc}`);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    void pushEntry("error", "browser", `Unhandled rejection: ${formatLogValue(reason)}`);
  });
}

// ---------------------------------------------------------------
// エクスポート用ユーティリティ
// ---------------------------------------------------------------

/** ログをテキスト形式に整形（ダウンロード / コピー用） */
export function formatLogsAsText(entries: DebugLogEntry[]): string {
  return entries
    .map((e) => {
      const t = new Date(e.ts).toISOString();
      return `[${t}] [${e.level.toUpperCase().padEnd(5)}] [${e.source}] ${e.message}`;
    })
    .join("\n");
}

/** レベルの重要度ランク（フィルタ用。大きいほど重要） */
export function levelRank(level: DebugLogLevel): number {
  switch (level) {
    case "debug":
      return 0;
    case "info":
      return 1;
    case "warn":
      return 2;
    case "error":
      return 3;
  }
}
