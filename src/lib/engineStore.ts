"use client";

/**
 * wllama エンジンのライフサイクル管理（Zustand ストア）。
 *
 * - 推論本体は wllama 内部の Web Worker で実行されるため UI はブロックされない
 * - モデルはメモリ上でのみ動作（URL 导入はキャッシュしない / 計画書 M-2）
 * - メモリ対策として N_CTX の階梯フォールバックを実装（計画書 M-4）
 * - LoRA アダプタはモデルロード時に wllama の lora_adapters として適用する
 *   （wllama はロード時に MEMFS へ全 blob を model-XXXXX-of-XXXXX.gguf として
 *    登録するため、LoRA blob をモデル blob の後ろに並べて仮想パスを指定する）
 */
import { create } from "zustand";
import { Wllama } from "@wllama/wllama";
import type { LoadedContextInfo } from "@wllama/wllama";
import { APP_CONFIG } from "@/config/appConfig";
import { useSettingsStore } from "@/lib/settingsStore";
import type { EngineStatus, LoraAdapter, LoadProgress } from "@/lib/types";

let wllamaInstance: Wllama | null = null;

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

const engineLogger = {
  debug: () => {},
  log: () => {},
  warn: (...args: unknown[]) => {
    watchWebGPUFailure(args);
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    watchWebGPUFailure(args);
    console.error(...args);
  },
};

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
  /** ロード中にフォールバックしたコンテキスト長（警告表示用） */
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
    console.warn("exit 中の警告:", err);
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
    throw new Error(
      "モデルの読み込みに失敗しました。GGUF ファイルが破損しているか、対応していない形式の可能性があります。"
    );
  }
  return info;
}

async function loadWithLadder(
  wllama: Wllama,
  load: (nCtx: number) => Promise<void>
): Promise<number | null> {
  const ladder = [APP_CONFIG.N_CTX, ...APP_CONFIG.N_CTX_FALLBACK_LADDER];
  let lastErr: unknown = null;
  for (let i = 0; i < ladder.length; i++) {
    const nCtx = ladder[i];
    try {
      await load(nCtx);
      if (i > 0) {
        return nCtx; // フォールバックで成功したコンテキスト長
      }
      return null;
    } catch (err) {
      lastErr = err;
      if (!isMemoryError(err)) throw err;
      console.warn(`n_ctx=${nCtx} でロード失敗（メモリ不足と推定）。次の階梯を試行します。`, err);
      // リトライ前にメモリを解放し「Module is already initialized」を防ぐ
      await safeExit(wllama);
    }
  }
  throw lastErr;
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
    if (!isGgufFileName(nameFromUrl(url))) {
      set({ error: "URL は .gguf で終わる必要があります。" });
      return;
    }
    // 既存のモデル / 失敗残留の WASM モジュールを解放（再ロード・モデル切替を可能にする）
    await safeExit(wllama);
    // WebGPU アダプタの実在を事前検証（表示と n_gpu_layers の両方に使用）
    const webgpu = await isWebGPUAdapterAvailable();
    set({
      status: "loading",
      progress: null,
      error: null,
      ctxFallbackNotice: null,
      modelName: nameFromUrl(url),
      modelSizeBytes: null,
      webgpuSupported: webgpu,
      webgpuActive: webgpu,
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
        const fallback = await loadWithLadder(wllama, async (nCtx) => {
          await wllama.loadModelFromUrl(url, {
            ...buildLoadParams(nCtx, webgpu),
            // 計画書 M-2: モデルはメモリ上でのみ動作させ、キャッシュは保持しない
            useCache: false,
            progressCallback: ({ loaded, total }) => setProgress(loaded, total),
          });
          assertLoadSucceeded(wllama);
        });
        const ctxInfo = wllama.getLoadedContextInfo();
        set({
          status: "ready",
          progress: null,
          ctxInfo,
          multithread: wllama.isMultithread(),
          ctxFallbackNotice: fallback
            ? `メモリ制約のためコンテキスト長を ${APP_CONFIG.N_CTX} → ${fallback} に引き下げてロードしました。`
            : null,
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

      const fallback = await loadWithLadder(wllama, async (nCtx) => {
        await wllama.loadModel(blobs, buildLoadParams(nCtx, webgpu, loraAdaptersParams));
        assertLoadSucceeded(wllama);
      });
      const ctxInfo = wllama.getLoadedContextInfo();
      set({
        status: "ready",
        progress: null,
        ctxInfo,
        multithread: wllama.isMultithread(),
        modelSizeBytes: modelSize + loraSizeBytes,
        ctxFallbackNotice: fallback
          ? `メモリ制約のためコンテキスト長を ${APP_CONFIG.N_CTX} → ${fallback} に引き下げてロードしました。`
          : null,
        contextTokens: 0,
        tokPerSec: null,
      });
    } catch (err) {
      console.error(err);
      await safeExit(wllama);
      set({
        status: "error",
        progress: null,
        error: err instanceof Error ? err.message : String(err),
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
    const oversize = files.find((f) => f.size > APP_CONFIG.MAX_MODEL_FILE_SIZE);
    if (oversize) {
      set({
        error: `単一ファイルは 2GB までです（wasm32 制約）。大きなモデルは split GGUF を利用してください: ${oversize.name}`,
      });
      return;
    }
    const webgpu = await isWebGPUAdapterAvailable();
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

      const fallback = await loadWithLadder(wllama, async (nCtx) => {
        await wllama.loadModel(blobs, buildLoadParams(nCtx, webgpu, loraAdaptersParams));
        assertLoadSucceeded(wllama);
      });
      const ctxInfo = wllama.getLoadedContextInfo();
      set({
        status: "ready",
        progress: null,
        ctxInfo,
        multithread: wllama.isMultithread(),
        modelSizeBytes: files.reduce((acc, f) => acc + f.size, 0) + loraSizeBytes,
        ctxFallbackNotice: fallback
          ? `メモリ制約のためコンテキスト長を ${APP_CONFIG.N_CTX} → ${fallback} に引き下げてロードしました。`
          : null,
        contextTokens: 0,
        tokPerSec: null,
      });
    } catch (err) {
      console.error(err);
      await safeExit(wllama);
      set({
        status: "error",
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  unload: async () => {
    const wllama = wllamaInstance;
    if (!wllama) return;
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
