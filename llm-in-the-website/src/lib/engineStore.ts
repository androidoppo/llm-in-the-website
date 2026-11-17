"use client";

/**
 * wllama エンジンのライフサイクル管理（Zustand ストア）。
 *
 * - 推論本体は wllama 内部の Web Worker で実行されるため UI はブロックされない
 * - モデルはメモリ上でのみ動作（URL 导入はキャッシュしない / 計画書 M-2）
 * - メモリ対策として N_CTX の階梯フォールバックを実装（計画書 M-4）
 * - WebGPU ロード失敗時は CPU (WASM) へ自動フォールバックする
 *   （iPadOS Safari のようにアダプタは取得できるがロードに失敗する環境向け）
 * - LoRA アダプタはモデルロード時に wllama の lora_adapters として適用する
 *   （wllama はロード時に MEMFS へ全 blob を model-XXXXX-of-XXXXX.gguf として
 *    登録するため、LoRA blob をモデル blob の後ろに並べて仮想パスを指定する）
 */
import { create } from "zustand";
import { Wllama } from "@wllama/wllama";
import type { LoadedContextInfo } from "@wllama/wllama";
import { APP_CONFIG } from "@/config/appConfig";
import { pushDebugLog } from "@/lib/debugLogStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatBytes } from "@/lib/tokenEstimate";
import type { EngineStatus, LoraAdapter, LoadProgress } from "@/lib/types";

let wllamaInstance: Wllama | null = null;

/**
 * memory64（WebAssembly.Memory の 64 ビットアドレス空間）に対応しているか。
 * Safari 18.2+ / Chrome 133+ / Firefox 134+ あたりが目安。
 * 対応ブラウザでは 2GB 超の単一 GGUF にも「試行」できる。
 */
export function supportsMemory64(): boolean {
  if (typeof WebAssembly === "undefined") return false;
  try {
    // TypeScript 標準型に address オプションが無いためキャストする。
    // memory64 対応ブラウザ（Safari 18.2+ / Chrome 133+ / Firefox 134+ 目安）のみ成功する。
    const desc = {
      initial: 1,
      maximum: 2,
      address: "memory64",
    } as unknown as WebAssembly.MemoryDescriptor;
    const m = new WebAssembly.Memory(desc);
    void m.buffer.byteLength; // 実際に触って検証
    return true;
  } catch {
    return false;
  }
}

/** モバイルデバイスかどうか（エラーメッセージの調整用） */
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document)
  );
}

/**
 * GGUF ヘッダの最初の KV（一般には general.architecture）を読み出す。
 * ロード失敗時の診断情報（「このアーキテクチャがビルド未対応の可能性」）として使う。
 */
async function readGgufArch(blob: Blob): Promise<string | null> {
  try {
    const buf = await blob.slice(0, 512).arrayBuffer();
    const view = new DataView(buf);
    // magic "GGUF" (LE で 0x46554747) を確認
    if (view.byteLength < 32 || view.getUint32(0, true) !== 0x46554747) return null;
    let off = 8; // magic(4) + version(4)
    off += 16; // tensor_count(u64) + kv_count(u64)
    const decoder = new TextDecoder();
    const readStr = (): string => {
      const len = Number(view.getBigUint64(off, true));
      off += 8;
      const s = decoder.decode(new Uint8Array(buf, off, len));
      off += len;
      return s;
    };
    const key = readStr();
    const vtype = view.getUint32(off, true);
    off += 4;
    if (key !== "general.architecture" || vtype !== 8) return null; // 8 = GGUF Type STRING
    return readStr();
  } catch {
    return null;
  }
}

/**
 * wllama のログを監視し、WebGPU アダプタの初期化失敗を検知したら
 * バックエンド表示を「WASM (CPU)」に差し替える。
 * （navigator.gpu が存在しても requestAdapter が失敗する環境があるため）
 */
function watchWebGPUFailure(args: unknown[]) {
  const s = args.map(String).join(" ");
  if (/ggml_webgpu/i.test(s) && /(not available|failed|adapter)/i.test(s)) {
    useEngineStore.setState({ webgpuActive: false });
  }
}

/**
 * wllama の logger。全レベルをデバッグログストアへ収集し、
 * warn / error はコンソールにも出力する。
 */
const engineLogger = {
  debug: (...args: unknown[]) => {
    pushDebugLog("debug", "wllama", args.map(String).join(" "));
  },
  log: (...args: unknown[]) => {
    pushDebugLog("info", "wllama", args.map(String).join(" "));
  },
  warn: (...args: unknown[]) => {
    watchWebGPUFailure(args);
    pushDebugLog("warn", "wllama", args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    watchWebGPUFailure(args);
    pushDebugLog("error", "wllama", args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
    console.error(...args);
  },
};

/** アプリ内部ログのショートカット */
function appLog(level: "debug" | "info" | "warn" | "error", message: string) {
  pushDebugLog(level, "app", message);
}

export function getWllama(): Wllama {
  if (!wllamaInstance) {
    wllamaInstance = new Wllama(APP_CONFIG.WASM_PATHS, {
      logger: engineLogger,
      parallelDownloads: APP_CONFIG.PARALLEL_DOWNLOADS,
    });
    // compat ビルド（JSPI / memory64 非対応ブラウザ向け）を自己ホスト (M-1)
    wllamaInstance.setCompat(
      {
        wasm: APP_CONFIG.COMPAT_ASSETS.wasm,
        worker: APP_CONFIG.COMPAT_ASSETS.worker,
      },
      APP_CONFIG.COMPAT_MODE
    );
  }
  return wllamaInstance;
}

/** 単一ファイルの実効上限（memory64 対応ブラウザでは緩和） */
export function maxSingleFileSize(): number {
  return supportsMemory64()
    ? APP_CONFIG.MAX_MODEL_FILE_SIZE_MEMORY64
    : APP_CONFIG.MAX_MODEL_FILE_SIZE;
}

/**
 * WebGPU アダプタが実際に取得できるかをメインスレッドで事前検証する。
 * navigator.gpu が存在しても requestAdapter が null を返す環境
 * （ヘッドレスブラウザやドライバ無効環境）があるため。
 */
export async function isWebGPUAdapterAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  // TS の標準型に WebGPU が無い環境向けに安全にキャストする
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } })
    .gpu;
  if (!gpu) return false;
  if (APP_CONFIG.N_GPU_LAYERS <= 0) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

/** エラーメッセージからメモリ不足かどうかを判定（階梯フォールバックの対象） */
function isMemoryError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /memory|alloc|out of|kvwasm|buffer/i.test(msg);
}

/** GGUF 判定。wllama の isValidGgufFile は File オブジェクトを受け取れない
 * （文字列化され [object File] になる）ため、必ず「ファイル名文字列」で判定する。
 * 大文字拡張子 (.GGUF) も許容する。 */
function isGgufFileName(name: string): boolean {
  return /\.gguf(\?.*)?$/i.test(name.trim());
}

let loraIdCounter = 0;
function newLoraId(): string {
  loraIdCounter += 1;
  return `lora-${Date.now()}-${loraIdCounter}`;
}

/** 数値を 5 桁ゼロ埋め（wllama prepareBlobs のリネーム規則と同一） */
function pad5(n: number): string {
  return String(n).padStart(5, "0");
}

/** URL から表示名を抽出 */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

/**
 * split GGUF の先頭ファイル URL から全シャード URL を導出する。
 * 例: ...-00001-of-00003.gguf → [...-00001-..., ...-00002-..., ...-00003-...]
 */
function deriveShardUrls(url: string): string[] {
  const re = /-(\d{5})-of-(\d{5})\.gguf(?=\?|$)/i;
  const m = url.match(re);
  if (!m) return [url];
  const total = parseInt(m[2], 10);
  if (!Number.isFinite(total) || total <= 1) return [url];
  return Array.from({ length: total }, (_, i) =>
    url.replace(re, `-${pad5(i + 1)}-of-${pad5(total)}.gguf`)
  );
}

/** fetch で blob をダウンロードし進捗を報告する（wllama のキャッシュを使わない単純取得） */
async function fetchBlobWithProgress(
  url: string,
  onProgress: (loadedSoFar: number, total: number) => void
): Promise<{ blob: Blob; size: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ダウンロードに失敗しました (${res.status}): ${nameFromUrl(url)}`);
  }
  const contentLength = Number(res.headers.get("content-length") ?? 0) || null;
  if (!res.body) {
    const blob = await res.blob();
    onProgress(blob.size, blob.size);
    return { blob, size: blob.size };
  }
  const reader = res.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value.slice().buffer as ArrayBuffer);
      loaded += value.byteLength;
      onProgress(loaded, contentLength ?? loaded);
    }
  }
  return { blob: new Blob(chunks), size: loaded };
}

/**
 * LoRA blob を含めたロードを行う。wllama は渡された blob 順に
 * model-00001-of-NNNNN.gguf … とリネームして MEMFS に登録するため、
 * モデル blob の後ろに LoRA blob を並べ、その仮想パスを lora_adapters に指定する。
 */
function buildLoraAdaptersParams(
  modelBlobCount: number,
  loraBlobs: { scale: number }[]
): { path: string; scale: number }[] {
  const total = modelBlobCount + loraBlobs.length;
  return loraBlobs.map((_, i) => ({
    path: `models/model-${pad5(modelBlobCount + i + 1)}-of-${pad5(total)}.gguf`,
    scale: loraBlobs[i].scale,
  }));
}

interface EngineState {
  status: EngineStatus;
  progress: LoadProgress | null;
  /** ロード中のフォールバック（コンテキスト引き下げ / CPU 切替）の通知 */
  ctxFallbackNotice: string | null;
  error: string | null;
  ctxInfo: LoadedContextInfo | null;
  modelName: string | null;
  modelSizeBytes: number | null;
  webgpuSupported: boolean;
  /** 実際に WebGPU バックエンドで動作しているか（ロード時のログから判定、失敗時は false） */
  webgpuActive: boolean;
  multithread: boolean;
  /** 直近の生成速度 (tokens / sec) */
  tokPerSec: number | null;
  /** 現在の会話が消費しているコンテキストトークン数（実測値） */
  contextTokens: number;
  /** 登録済み LoRA アダプタ（メモリ上のみ・アンロード後も保持） */
  loraAdapters: LoraAdapter[];

  loadFromUrl: (url: string) => Promise<void>;
  loadFromFiles: (files: File[]) => Promise<void>;
  unload: () => Promise<void>;
  addLoraFiles: (files: File[]) => void;
  addLoraUrl: (url: string) => void;
  removeLora: (id: string) => void;
  setLoraScale: (id: string, scale: number) => void;
  toggleLora: (id: string) => void;
  setTokPerSec: (t: number | null) => void;
  setContextTokens: (n: number) => void;
  clearError: () => void;
}

function buildLoadParams(nCtx: number, webgpu: boolean, loraAdapters?: { path: string; scale: number }[]) {
  const { params } = useSettingsStore.getState();
  return {
    n_ctx: nCtx,
    n_gpu_layers: webgpu ? APP_CONFIG.N_GPU_LAYERS : 0,
    n_threads: APP_CONFIG.N_THREADS > 0 ? APP_CONFIG.N_THREADS : undefined,
    n_batch: APP_CONFIG.N_BATCH,
    // V キャッシュを f16 以外に量子化する場合は Flash Attention が必須（llama.cpp の制約）
    flash_attn: APP_CONFIG.FLASH_ATTN || params.cacheTypeV !== "f16",
    cache_type_k: params.cacheTypeK,
    cache_type_v: params.cacheTypeV,
    ...(loraAdapters && loraAdapters.length > 0 ? { lora_adapters: loraAdapters } : {}),
  };
}

/** ロード失敗後に wllama を確実に初期化し直せるよう exit する */
async function safeExit(wllama: Wllama) {
  try {
    await wllama.exit();
  } catch (err) {
    appLog("debug", `wllama.exit() の警告: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * ロード結果の実在を検証する。
 * wllama v3.13 は C++ 側でロードに失敗した際（例: 破損 GGUF）でも
 * ワーカーが nullptr 応答を空の load_res として解決してしまうため、
 * n_ctx / n_layer が正常かを確認して失敗を検知する。
 */
function assertLoadSucceeded(wllama: Wllama): LoadedContextInfo {
  const info = wllama.getLoadedContextInfo();
  if (!info || info.n_ctx <= 0 || info.n_layer <= 0) {
    appLog("error", "ロード検証失敗: getLoadedContextInfo() が無効値（nullptr 応答の疑い）");
    throw new Error(
      "モデルの読み込みに失敗しました。GGUF ファイルが破損しているか、対応していない形式の可能性があります。"
    );
  }
  appLog("info", `ロード検証 OK: n_ctx=${info.n_ctx} n_layer=${info.n_layer}`);
  return info;
}

/** ロード試行: n_ctx とバックエンドを受け取り、ロード + 成功検証まで行う */
type LoadAttempt = (nCtx: number, webgpu: boolean) => Promise<void>;

/**
 * メモリ階梯 × バックエンド（WebGPU → CPU）の二段フォールバック。
 *
 * - メモリ不足エラー: 同じバックエンドで次の n_ctx 階梯を試す
 * - それ以外のロード失敗（C++ 側ロード失敗・nullptr 応答など）:
 *   WebGPU の場合だけ CPU (WASM) へ切り替えて再試行する。
 *   iPadOS Safari のように requestAdapter は成功するが WebGPU バックエンドでの
 *   モデルロードが失敗する環境があるため。
 * - CPU でも失敗した場合は元のエラーをそのまま投げる
 */
async function loadWithFallbacks(
  wllama: Wllama,
  attempt: LoadAttempt,
  preferWebGPU: boolean
): Promise<{ ctxFallback: number | null; cpuFallback: boolean }> {
  const ladder = [APP_CONFIG.N_CTX, ...APP_CONFIG.N_CTX_FALLBACK_LADDER];
  const backends: boolean[] =
    preferWebGPU && APP_CONFIG.AUTO_CPU_FALLBACK ? [true, false] : [preferWebGPU];
  let lastErr: unknown = null;
  let ctxFallback: number | null = null;
  let cpuFallback = false;
  for (let b = 0; b < backends.length; b++) {
    const webgpu = backends[b];
    for (let i = 0; i < ladder.length; i++) {
      const nCtx = ladder[i];
      try {
        appLog("info", `ロード試行: backend=${webgpu ? "WebGPU" : "CPU"} n_ctx=${nCtx}`);
        await attempt(nCtx, webgpu);
        if (i > 0) ctxFallback = nCtx;
        cpuFallback = !webgpu && backends.length > 1;
        return { ctxFallback, cpuFallback };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        appLog(
          "warn",
          `ロード失敗: backend=${webgpu ? "WebGPU" : "CPU"} n_ctx=${nCtx} memoryError=${isMemoryError(err)}: ${msg}`
        );
        console.warn(
          `ロード失敗: backend=${webgpu ? "WebGPU" : "CPU"} n_ctx=${nCtx}`,
          err
        );
        await safeExit(wllama);
        if (!isMemoryError(err)) {
          // メモリ不足以外（未対応形式・バックエンド故障など）はバックエンドを切り替え
          appLog("info", "メモリ不足以外のため次のバックエンドへ切り替えます");
          break;
        }
        // メモリ不足なら次の n_ctx 階梯へ
        appLog("info", "メモリ不足と判定 → 次の n_ctx 階梯へ");
      }
    }
  }
  throw lastErr;
}

/** 最終エラーメッセージを用途別に補足する */
async function describeLoadError(
  err: unknown,
  firstModelFile: Blob | null
): Promise<string> {
  const base = err instanceof Error ? err.message : String(err);
  if (isMemoryError(err)) {
    const size = useEngineStore.getState().modelSizeBytes ?? null;
    if (size !== null && size > 2 * 1024 * 1024 * 1024) {
      return `${base} モデルが大きいため、より小さい量子化（Q4_K_S / Q4_0 など）や分割 GGUF の利用を検討してください。`;
    }
    if (isMobileDevice()) {
      return `${base} モバイルデバイスでは搭載メモリの制約が厳しいため、より小さいモデル（低量子化・少パラメータ）をお試しください。`;
    }
    return base;
  }
  // C++ 側ロード失敗（未対応形式・破損）の可能性
  const arch = firstModelFile ? await readGgufArch(firstModelFile) : null;
  if (arch) {
    return `${base}（検出されたアーキテクチャ: ${arch}。お使いの llama.cpp ビルドがこの形式に未対応、またはファイルが破損している可能性があります）`;
  }
  if (base.startsWith("モデルの読み込みに失敗")) {
    return `${base}（WebGPU / CPU の両バックエンドで失敗しました。ファイルが破損しているか、お使いの llama.cpp ビルドがこの形式に未対応の可能性があります）`;
  }
  return base;
}

/** 有効化されている LoRA をすべて blob 化して返す（URL のものはこの場でダウンロード） */
async function resolveEnabledLoras(
  onProgress: (loadedSoFar: number, total: number) => void
): Promise<{ blobs: Blob[]; scales: number[]; sizeBytes: number }> {
  const enabled = useEngineStore.getState().loraAdapters.filter((a) => a.enabled);
  const blobs: Blob[] = [];
  const scales: number[] = [];
  let sizeBytes = 0;
  for (const a of enabled) {
    if (a.kind === "file" && a.file) {
      blobs.push(a.file);
      scales.push(a.scale);
      sizeBytes += a.file.size;
    } else if (a.kind === "url" && a.url) {
      const { blob, size } = await fetchBlobWithProgress(a.url, onProgress);
      blobs.push(blob);
      scales.push(a.scale);
      sizeBytes += size;
    }
  }
  return { blobs, scales, sizeBytes };
}

export const useEngineStore = create<EngineState>((set, get) => ({
  status: "idle",
  progress: null,
  ctxFallbackNotice: null,
  error: null,
  ctxInfo: null,
  modelName: null,
  modelSizeBytes: null,
  webgpuSupported: false,
  webgpuActive: false,
  multithread: false,
  tokPerSec: null,
  contextTokens: 0,
  loraAdapters: [],

  clearError: () => set({ error: null }),

  setTokPerSec: (t) => set({ tokPerSec: t }),
  setContextTokens: (n) => set({ contextTokens: n }),

  // ---------- LoRA 管理 ----------
  addLoraFiles: (files) => {
    const valid = files.filter((f) => isGgufFileName(f.name));
    if (valid.length === 0) {
      set({ error: "LoRA は GGUF 形式（.gguf）のみ対応しています。" });
      return;
    }
    set((state) => ({
      error: null,
      loraAdapters: [
        ...state.loraAdapters,
        ...valid.map((f) => ({
          id: newLoraId(),
          name: f.name,
          kind: "file" as const,
          file: f,
          sizeBytes: f.size,
          scale: 1,
          enabled: true,
        })),
      ],
    }));
  },

  addLoraUrl: (url) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isGgufFileName(nameFromUrl(trimmed))) {
      set({ error: "LoRA の URL は .gguf で終わる必要があります。" });
      return;
    }
    set((state) => ({
      error: null,
      loraAdapters: [
        ...state.loraAdapters,
        {
          id: newLoraId(),
          name: nameFromUrl(trimmed),
          kind: "url",
          url: trimmed,
          sizeBytes: null,
          scale: 1,
          enabled: true,
        },
      ],
    }));
  },

  removeLora: (id) =>
    set((state) => ({ loraAdapters: state.loraAdapters.filter((a) => a.id !== id) })),

  setLoraScale: (id, scale) =>
    set((state) => ({
      loraAdapters: state.loraAdapters.map((a) =>
        a.id === id ? { ...a, scale: Math.min(2, Math.max(0, scale)) } : a
      ),
    })),

  toggleLora: (id) =>
    set((state) => ({
      loraAdapters: state.loraAdapters.map((a) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a
      ),
    })),

  // ---------- モデルロード ----------
  loadFromUrl: async (url) => {
    const wllama = getWllama();
    if (get().status === "loading") return;
    appLog("info", `モデルロード開始 (URL): ${url}`);
    if (!isGgufFileName(nameFromUrl(url))) {
      set({ error: "URL は .gguf で終わる必要があります。" });
      return;
    }
    const useWebGPUSetting = useSettingsStore.getState().useWebGPU;
    // 既存のモデル / 失敗残留の WASM モジュールを解放（再ロード・モデル切替を可能にする）
    await safeExit(wllama);

    // 2GB 超の非分割単一 GGUF を事前検査（memory64 非対応ならダウンロード前に案内）
    const maxSingle = maxSingleFileSize();
    const isShard = deriveShardUrls(url).length > 1;
    try {
      const head = await fetch(url, { method: "HEAD" });
      const len = Number(head.headers.get("content-length") ?? 0);
      appLog("debug", `HEAD content-length=${len ? formatBytes(len) : "不明"} isShard=${isShard}`);
      if (len > maxSingle && !isShard) {
        set({
          status: "error",
          error: `このモデルは ${formatBytes(len)} あり、単一ファイル上限（${formatBytes(maxSingle)}）を超えています。split GGUF の先頭シャード URL（-00001-of-0000N.gguf）を指定するか、より小さい量子化をご利用ください。${
            supportsMemory64() ? "" : "（お使いのブラウザは memory64 非対応のため、2GB 超の単一ファイルはロードできません）"
          }`,
        });
        return;
      }
    } catch {
      // HEAD が使えないサーバ（CORS 等）は素通りして通常フローへ
    }

    // WebGPU アダプタの実在を事前検証（表示と n_gpu_layers の両方に使用）
    const adapterAvailable = await isWebGPUAdapterAvailable();
    const preferGPU = useWebGPUSetting && adapterAvailable && APP_CONFIG.N_GPU_LAYERS > 0;
    set({
      status: "loading",
      progress: null,
      error: null,
      ctxFallbackNotice: null,
      modelName: nameFromUrl(url),
      modelSizeBytes: null,
      webgpuSupported: adapterAvailable,
      webgpuActive: preferGPU,
    });

    const setProgress = (loaded: number, total: number) =>
      set({
        progress: {
          loaded,
          total,
          percentage: total > 0 ? Math.round((loaded / total) * 100) : 0,
        },
      });

    try {
      const loras = get().loraAdapters.filter((a) => a.enabled);

      if (loras.length === 0) {
        // LoRA なし: 従来どおり wllama のダウンローダを使用
        // （URL が split GGUF の先頭シャードなら wllama が全シャードを自動展開する）
        const { ctxFallback, cpuFallback } = await loadWithFallbacks(
          wllama,
          async (nCtx, webgpu) => {
            set({ webgpuActive: webgpu });
            await wllama.loadModelFromUrl(url, {
              ...buildLoadParams(nCtx, webgpu),
              // 計画書 M-2: モデルはメモリ上でのみ動作させ、キャッシュは保持しない
              useCache: false,
              progressCallback: ({ loaded, total }) => setProgress(loaded, total),
            });
            assertLoadSucceeded(wllama);
          },
          preferGPU
        );
        const ctxInfo = wllama.getLoadedContextInfo();
        set({
          status: "ready",
          progress: null,
          ctxInfo,
          multithread: wllama.isMultithread(),
          ctxFallbackNotice: buildFallbackNotice(ctxFallback, cpuFallback),
          contextTokens: 0,
          tokPerSec: null,
        });
        return;
      }

      // LoRA あり: 自前でダウンロードして blob を組み合わせる
      // （wllama の loadModelFromUrl には LoRA blob を合流できないため）
      const shardUrls = deriveShardUrls(url);
      if (shardUrls.length > 1) {
        set({
          status: "error",
          progress: null,
          error:
            "分割 GGUF と LoRA の同時使用は対応していません。単一ファイルのモデルを利用してください。",
        });
        return;
      }

      const { blob: modelBlob, size: modelSize } = await fetchBlobWithProgress(
        url,
        (l, t) => setProgress(l, t)
      );
      set({ modelSizeBytes: modelSize });
      const { blobs: loraBlobs, scales, sizeBytes: loraSizeBytes } =
        await resolveEnabledLoras((l, t) => setProgress(l, t));

      const blobs = [modelBlob, ...loraBlobs];
      const loraAdaptersParams = buildLoraAdaptersParams(
        1,
        scales.map((s) => ({ scale: s }))
      );

      const { ctxFallback, cpuFallback } = await loadWithFallbacks(
        wllama,
        async (nCtx, webgpu) => {
          set({ webgpuActive: webgpu });
          await wllama.loadModel(blobs, buildLoadParams(nCtx, webgpu, loraAdaptersParams));
          assertLoadSucceeded(wllama);
        },
        preferGPU
      );
      const ctxInfo = wllama.getLoadedContextInfo();
      set({
        status: "ready",
        progress: null,
        ctxInfo,
        multithread: wllama.isMultithread(),
        modelSizeBytes: modelSize + loraSizeBytes,
        ctxFallbackNotice: buildFallbackNotice(ctxFallback, cpuFallback),
        contextTokens: 0,
        tokPerSec: null,
      });
    } catch (err) {
      console.error(err);
      appLog("error", `モデルロード失敗 (URL): ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      await safeExit(wllama);
      set({
        status: "error",
        progress: null,
        error: await describeLoadError(err, null),
      });
    }
  },

  loadFromFiles: async (files) => {
    const wllama = getWllama();
    if (get().status === "loading") return;
    if (files.length === 0) return;
    // 既存のモデル / 失敗残留の WASM モジュールを解放（再ロード・モデル切替を可能にする）
    await safeExit(wllama);
    // wllama の isValidGgufFile に File オブジェクトを渡すと常に false になるため、
    // ファイル名文字列で判定する
    const invalid = files.find((f) => !isGgufFileName(f.name));
    if (invalid) {
      set({ error: `GGUF 形式のみ対応しています: ${invalid.name}` });
      return;
    }
    // 単一ファイル上限: memory64 非対応ブラウザでは 2GB（wllama の制約）、
    // 対応ブラウザでは緩和した上限で「試行」する
    const maxSingle = maxSingleFileSize();
    const mem64 = supportsMemory64();
    const oversize = files.find((f) => f.size > maxSingle);
    if (oversize) {
      set({
        error: `単一ファイルは ${formatBytes(maxSingle)} までです: ${oversize.name}${
          mem64
            ? "。これ以上のモデルは llama-gguf-split などで分割し、シャードを複数選択してください。"
            : "。2GB 超のモデルは llama-gguf-split などで分割 GGUF にして、シャードを複数選択してください（例: -00001-of-00003.gguf 〜）。"
        }`,
      });
      return;
    }
    const useWebGPUSetting = useSettingsStore.getState().useWebGPU;
    const webgpu = useWebGPUSetting && (await isWebGPUAdapterAvailable());
    appLog(
      "info",
      `モデルロード開始 (ファイル): ${files.map((f) => `${f.name}(${formatBytes(f.size)})`).join(", ")} mem64=${mem64} webgpu=${webgpu}`
    );
    set({
      status: "loading",
      progress: null,
      error: null,
      ctxFallbackNotice: null,
      modelName: files[0].name.replace(/-0000\d-of-\d+\.gguf$/i, ".gguf"),
      modelSizeBytes: files.reduce((acc, f) => acc + f.size, 0),
      webgpuSupported: webgpu,
      webgpuActive: webgpu,
    });
    try {
      const enabledLoras = get().loraAdapters.filter((a) => a.enabled);
      if (enabledLoras.length > 0 && files.length > 1) {
        set({
          status: "error",
          progress: null,
          error:
            "分割 GGUF と LoRA の同時使用は対応していません。単一ファイルのモデルを利用してください。",
        });
        return;
      }
      const loraBlobs = enabledLoras.map((a) => a.file as Blob);
      const loraScales = enabledLoras.map((a) => a.scale);
      const loraSizeBytes = enabledLoras.reduce(
        (acc, a) => acc + (a.sizeBytes ?? 0),
        0
      );

      const blobs: Blob[] = [...files, ...loraBlobs];
      const loraAdaptersParams =
        loraBlobs.length > 0
          ? buildLoraAdaptersParams(files.length, loraScales.map((s) => ({ scale: s })))
          : undefined;

      const { ctxFallback, cpuFallback } = await loadWithFallbacks(
        wllama,
        async (nCtx, webgpuNow) => {
          set({ webgpuActive: webgpuNow });
          await wllama.loadModel(blobs, buildLoadParams(nCtx, webgpuNow, loraAdaptersParams));
          assertLoadSucceeded(wllama);
        },
        webgpu
      );
      const ctxInfo = wllama.getLoadedContextInfo();
      set({
        status: "ready",
        progress: null,
        ctxInfo,
        multithread: wllama.isMultithread(),
        modelSizeBytes: files.reduce((acc, f) => acc + f.size, 0) + loraSizeBytes,
        ctxFallbackNotice: buildFallbackNotice(ctxFallback, cpuFallback),
        contextTokens: 0,
        tokPerSec: null,
      });
    } catch (err) {
      console.error(err);
      appLog("error", `モデルロード失敗 (ファイル): ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      await safeExit(wllama);
      set({
        status: "error",
        progress: null,
        error: await describeLoadError(err, files[0] ?? null),
      });
    }
  },

  unload: async () => {
    const wllama = wllamaInstance;
    if (!wllama) return;
    appLog("info", "モデルをアンロードします");
    await safeExit(wllama);
    set({
      status: "idle",
      progress: null,
      ctxInfo: null,
      modelName: null,
      modelSizeBytes: null,
      multithread: false,
      ctxFallbackNotice: null,
      contextTokens: 0,
      tokPerSec: null,
      error: null,
      // loraAdapters は保持（次回ロード時に再適用できる）
    });
  },
}));

/** フォールバック結果をユーザ向け通知文に変換する */
function buildFallbackNotice(ctxFallback: number | null, cpuFallback: boolean): string | null {
  const parts: string[] = [];
  if (cpuFallback) {
    parts.push(
      "WebGPU でのロードに失敗したため、CPU (WASM) で再試行してロードしました。"
    );
  }
  if (ctxFallback) {
    parts.push(
      `メモリ制約のためコンテキスト長を ${APP_CONFIG.N_CTX} → ${ctxFallback} に引き下げました。`
    );
  }
  return parts.length > 0 ? parts.join("") : null;
}
