"use client";

/**
 * チャット履歴ストア（Zustand + localStorage 持続化）。
 *
 * - チャットの作成 / 削除 / 切り替え
 * - メッセージの追加 / 編集 / 削除 / 再生成
 * - 生成とトークン消費量の記録（usage による実測 + 推定フォールバック）
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type { Wllama } from "@wllama/wllama";
import { APP_CONFIG } from "@/config/appConfig";
import { pushDebugLog } from "@/lib/debugLogStore";
import { useEngineStore, getWllama } from "@/lib/engineStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { Chat, ChatMessage, Role } from "@/lib/types";

let generationAbort: AbortController | null = null;

function makeChat(title = "新しいチャット"): Chat {
  return {
    id: uuidv4(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    totalTokens: 0,
  };
}

function makeMessage(role: Role, content: string, tokenCount: number | null = null): ChatMessage {
  return { id: uuidv4(), role, content, createdAt: Date.now(), tokenCount };
}

function appLog(level: "debug" | "info" | "warn" | "error", message: string) {
  pushDebugLog(level, "app", message);
}

interface ChatState {
  chats: Chat[];
  activeChatId: string | null;
  generatingChatId: string | null;
  /** 生成終了後に一度だけ true になり、UI が再フォーカスに使う */
  lastError: string | null;

  newChat: () => void;
  deleteChat: (chatId: string) => void;
  selectChat: (chatId: string) => void;
  deleteMessage: (chatId: string, messageId: string) => void;
  /** ユーザーメッセージを編集し、以降のメッセージを削除して再生成する */
  editUserMessage: (chatId: string, messageId: string, content: string) => void;
  /** 指定 assistant メッセージ以降を削除して再生成する */
  regenerate: (chatId: string, assistantMessageId: string) => void;
  generate: (chatId: string, userText?: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

function getChat(chats: Chat[], chatId: string): Chat | undefined {
  return chats.find((c) => c.id === chatId);
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      /** メッセージ内容を部分更新（ストリーミング表示用） */
      const patchMessage = (chatId: string, messageId: string, patch: Partial<ChatMessage>) => {
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id !== chatId
              ? c
              : {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
                }
          ),
        }));
      };

      /** messageId 以降（自身を含む）のメッセージを削除 */
      const truncateFrom = (chatId: string, messageId: string) => {
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c;
            const idx = c.messages.findIndex((m) => m.id === messageId);
            return idx >= 0 ? { ...c, messages: c.messages.slice(0, idx) } : c;
          }),
        }));
      };

      const runGeneration = async (chatId: string, history: ChatMessage[]) => {
        const engine = useEngineStore.getState();
        if (engine.status !== "ready") {
          set({ lastError: "モデルがロードされていません。先にモデルを読み込んでください。" });
          return;
        }

        const settings = useSettingsStore.getState();
        const stopSeqs = settings.params.stopSequences
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const assistantMsg = makeMessage("assistant", "");
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id !== chatId
              ? c
              : { ...c, updatedAt: Date.now(), messages: [...c.messages, assistantMsg] }
          ),
          generatingChatId: chatId,
          lastError: null,
        }));

        // wllama に渡すメッセージ列（system プロンプトを先頭に結合）
        const apiMessages = [
          ...(settings.params.systemPrompt.trim()
            ? [{ role: "system" as const, content: settings.params.systemPrompt.trim() }]
            : []),
          ...history
            .filter((m) => m.role !== "system" && m.content.trim().length > 0)
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        const estPromptTokens = apiMessages.reduce(
          (acc, m) => acc + estimateTokens(m.content),
          0
        );
        appLog(
          "info",
          `生成開始: chat=${chatId.slice(0, 8)} messages=${apiMessages.length} 推定prompt=${estPromptTokens}tok temp=${settings.params.temperature} max_tokens=${settings.params.maxNewTokens}`
        );

        generationAbort = new AbortController();
        let buffer = "";
        let lastFlush = 0;
        let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
        let firstTokenAt: number | null = null;

        try {
          // wllama の ChatCompletionParams 型には stop が定義されていないが、
          // 実行時には llama-server 相当の OpenAI 互換 API にそのまま転送される
          const stream = await getWllama().createChatCompletion({
            messages: apiMessages,
            stream: true,
            temperature: settings.params.temperature,
            top_p: settings.params.topP,
            max_tokens: settings.params.maxNewTokens,
            ...(stopSeqs.length > 0 ? { stop: stopSeqs } : {}),
            abortSignal: generationAbort.signal,
          } as Parameters<Wllama["createChatCompletion"]>[0] & { stop?: string[] });

          for await (const chunk of stream) {
            if (chunk.usage) usage = chunk.usage;
            if (chunk.timings?.predicted_per_second) {
              useEngineStore.getState().setTokPerSec(chunk.timings.predicted_per_second);
            }
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              if (firstTokenAt === null) {
                firstTokenAt = performance.now();
                appLog("debug", `最初のトークン受信: ${(firstTokenAt / 1000).toFixed(2)}s`);
              }
              buffer += delta;
              const now = performance.now();
              if (now - lastFlush > 50) {
                lastFlush = now;
                patchMessage(chatId, assistantMsg.id, { content: buffer });
              }
            }
          }
        } catch (err) {
          const name = (err as { name?: string })?.name || "";
          if (name === "WllamaAbortError" || name === "AbortError") {
            // 中断: ここまでの内容を保持
            appLog("info", `生成を中断しました: chat=${chatId.slice(0, 8)} 出力済み=${buffer.length}文字`);
            patchMessage(chatId, assistantMsg.id, { content: buffer, stopped: true });
          } else {
            console.error("生成エラー:", err);
            const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            appLog("error", `生成エラー: chat=${chatId.slice(0, 8)} ${msg}`);
            set({ lastError: `生成中にエラーが発生しました: ${msg}` });
            if (buffer.length === 0) {
              // 空のままならプレースホルダを取り除く
              set((state) => ({
                chats: state.chats.map((c) =>
                  c.id !== chatId
                    ? c
                    : { ...c, messages: c.messages.filter((m) => m.id !== assistantMsg.id) }
                ),
              }));
            } else {
              patchMessage(chatId, assistantMsg.id, { content: buffer, stopped: true });
            }
          }
        } finally {
          generationAbort = null;
          // timings が取れないビルド向けフォールバック:
          // 最初のトークンから完了までの経過時間とトークン数から算出
          const engineState = useEngineStore.getState();
          if (engineState.tokPerSec === null) {
            const completionTokens =
              usage?.completion_tokens ?? (buffer.length > 0 ? estimateTokens(buffer) : 0);
            const end = firstTokenAt ?? performance.now();
            const secs = (performance.now() - end) / 1000;
            if (completionTokens > 0 && secs > 0.05) {
              engineState.setTokPerSec(completionTokens / secs);
            }
          }
        }

        // トークン消費量の確定（usage が取れなければ推定値でフォールバック）
        const promptTokens =
          usage?.prompt_tokens ??
          apiMessages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const completionTokens =
          usage?.completion_tokens ??
          (buffer.length > 0 ? estimateTokens(buffer) : 0);

        patchMessage(chatId, assistantMsg.id, {
          content: buffer,
          tokenCount: completionTokens,
        });
        appLog(
          "info",
          `生成完了: chat=${chatId.slice(0, 8)} prompt=${promptTokens}tok completion=${completionTokens}tok${usage ? " (usage 実測)" : " (推定)"}`
        );
        set((state) => ({
          generatingChatId: null,
          chats: state.chats.map((c) =>
            c.id !== chatId
              ? c
              : { ...c, totalTokens: c.totalTokens + promptTokens + completionTokens }
          ),
        }));
        useEngineStore.getState().setContextTokens(promptTokens + completionTokens);
      };

      return {
        chats: [],
        activeChatId: null,
        generatingChatId: null,
        lastError: null,

        clearError: () => set({ lastError: null }),

        newChat: () => {
          const chat = makeChat();
          set((state) => ({ chats: [chat, ...state.chats], activeChatId: chat.id }));
        },

        deleteChat: (chatId) => {
          appLog("debug", `チャット削除: chat=${chatId.slice(0, 8)}`);
          set((state) => {
            const chats = state.chats.filter((c) => c.id !== chatId);
            return {
              chats,
              activeChatId:
                state.activeChatId === chatId ? (chats[0]?.id ?? null) : state.activeChatId,
            };
          });
        },

        selectChat: (chatId) => set({ activeChatId: chatId }),

        deleteMessage: (chatId, messageId) => {
          appLog("debug", `メッセージ削除: chat=${chatId.slice(0, 8)} msg=${messageId.slice(0, 8)}`);
          set((state) => ({
            chats: state.chats.map((c) =>
              c.id !== chatId ? c : { ...c, messages: c.messages.filter((m) => m.id !== messageId) }
            ),
          }));
        },

        editUserMessage: (chatId, messageId, content) => {
          appLog("debug", `メッセージ編集・再生成: chat=${chatId.slice(0, 8)} msg=${messageId.slice(0, 8)}`);
          const chat = getChat(get().chats, chatId);
          if (!chat) return;
          const idx = chat.messages.findIndex((m) => m.id === messageId);
          if (idx < 0) return;
          const edited: ChatMessage = {
            ...chat.messages[idx],
            content,
            tokenCount: estimateTokens(content),
          };
          const history = [...chat.messages.slice(0, idx), edited];
          set((state) => ({
            chats: state.chats.map((c) =>
              c.id !== chatId
                ? c
                : { ...c, updatedAt: Date.now(), messages: [...history] }
            ),
          }));
          void runGeneration(chatId, history);
        },

        regenerate: (chatId, assistantMessageId) => {
          appLog("debug", `再生成: chat=${chatId.slice(0, 8)} msg=${assistantMessageId.slice(0, 8)}`);
          const chat = getChat(get().chats, chatId);
          if (!chat) return;
          const idx = chat.messages.findIndex((m) => m.id === assistantMessageId);
          if (idx < 0) return;
          const history = chat.messages.slice(0, idx);
          truncateFrom(chatId, assistantMessageId);
          void runGeneration(chatId, history);
        },

        generate: async (chatId, userText) => {
          const chat = getChat(get().chats, chatId);
          if (!chat) return;
          let history = chat.messages;
          if (userText && userText.trim().length > 0) {
            const userMsg = makeMessage("user", userText.trim(), estimateTokens(userText.trim()));
            history = [...chat.messages, userMsg];
            set((state) => ({
              chats: state.chats.map((c) => {
                if (c.id !== chatId) return c;
                return {
                  ...c,
                  updatedAt: Date.now(),
                  messages: history,
                  title: c.messages.every((m) => m.role !== "user")
                    ? userMsg.content.slice(0, 30) + (userMsg.content.length > 30 ? "…" : "")
                    : c.title,
                };
              }),
            }));
          }
          await runGeneration(chatId, history);
        },

        stop: () => {
          appLog("debug", "生成中断リクエスト");
          generationAbort?.abort();
        },
      };
    },
    {
      name: APP_CONFIG.CHAT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        chats: state.chats.map((c) => ({
          ...c,
          // 生成中の空 assistant プレースホルダは永続化しない（ページ再読み込み対策）
          messages: c.messages.filter(
            (m) => m.role !== "assistant" || m.content.length > 0
          ),
        })),
        activeChatId: state.activeChatId,
      }),
    }
  )
);
