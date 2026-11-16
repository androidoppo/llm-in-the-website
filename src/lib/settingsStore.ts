"use client";

/**
 * 生成パラメータストア。
 * 初期値は APP_CONFIG（一元管理）から取り込み、UI から一時的に上書きできる。
 * 上書き値は localStorage に保持。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { APP_CONFIG } from "@/config/appConfig";
import type { GenerationParams, KvCacheType } from "@/lib/types";

const DEFAULT_PARAMS: GenerationParams = {
  temperature: APP_CONFIG.TEMPERATURE,
  topP: APP_CONFIG.TOP_P,
  maxNewTokens: APP_CONFIG.MAX_NEW_TOKENS,
  stopSequences: APP_CONFIG.STOP_SEQUENCES.join(", "),
  systemPrompt: APP_CONFIG.SYSTEM_PROMPT,
  cacheTypeK: APP_CONFIG.CACHE_TYPE_K,
  cacheTypeV: APP_CONFIG.CACHE_TYPE_V,
};

interface SettingsState {
  params: GenerationParams;
  setParam: <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => void;
  /** APP_CONFIG の値に戻す */
  resetToDefaults: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      params: DEFAULT_PARAMS,
      setParam: (key, value) =>
        set((state) => ({ params: { ...state.params, [key]: value } })),
      resetToDefaults: () => set({ params: DEFAULT_PARAMS }),
    }),
    {
      name: APP_CONFIG.SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // 古い localStorage（cacheTypeK/V が存在しない）との互換:
      // params は入れ替えではなく既定値とマージする
      merge: (persisted, current) => {
        const persistedParams =
          (persisted as { params?: Partial<GenerationParams> } | undefined)?.params ?? {};
        return {
          ...current,
          params: { ...DEFAULT_PARAMS, ...persistedParams },
        };
      },
    }
  )
);

/** KV キャッシュ量子化タイプの選択肢（表示順 = 量子化率の高い順） */
export const KV_CACHE_TYPE_OPTIONS: { value: KvCacheType; label: string }[] = [
  { value: "f16", label: "f16（半精度・既定）" },
  { value: "f32", label: "f32（単精度）" },
  { value: "q8_0", label: "q8_0（軽量量子化）" },
  { value: "q5_1", label: "q5_1" },
  { value: "q5_0", label: "q5_0" },
  { value: "q4_1", label: "q4_1" },
  { value: "q4_0", label: "q4_0（最小メモリ）" },
];
