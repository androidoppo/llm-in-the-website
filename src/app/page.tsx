"use client";

import { useEffect, useState } from "react";
import { Menu, Settings2 } from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LeftPanel } from "@/components/panels/LeftPanel";
import { RightPanel } from "@/components/panels/RightPanel";
import { ChatView } from "@/components/chat/ChatView";
import { StatusBar } from "@/components/StatusBar";
import { useChatStore } from "@/lib/chatStore";
import { useSettingsStore } from "@/lib/settingsStore";

export default function Home() {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const lastError = useChatStore((s) => s.lastError);
  const clearError = useChatStore((s) => s.clearError);
  const newChat = useChatStore((s) => s.newChat);

  // localStorage から履歴・設定を復元（SSR でアクセスしないようクライアント側のみ）
  useEffect(() => {
    void Promise.all([
      useChatStore.persist.rehydrate(),
      useSettingsStore.persist.rehydrate(),
    ]).then(() => {
      const state = useChatStore.getState();
      if (state.chats.length === 0) {
        newChat();
      } else if (!state.activeChatId) {
        useChatStore.setState({ activeChatId: state.chats[0].id });
      }
    });
  }, [newChat]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {/* モバイル: 左パネル */}
        <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="モデルと履歴">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">モデルとチャット履歴</SheetTitle>
            <LeftPanel />
          </SheetContent>
        </Sheet>

        <h1 className="text-sm font-bold tracking-tight">
          Browser LLM Chat
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            wllama / llama.cpp WASM・WebGPU
          </span>
        </h1>

        {/* モバイル: 右パネル */}
        <Sheet open={rightOpen} onOpenChange={setRightOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto xl:hidden"
              aria-label="設定"
            >
              <Settings2 className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 overflow-y-auto p-0">
            <SheetTitle className="sr-only">設定とトークン統計</SheetTitle>
            <RightPanel />
          </SheetContent>
        </Sheet>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-72 shrink-0 border-r lg:flex lg:flex-col">
          <LeftPanel />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <ChatView />
        </section>
        <aside className="hidden w-80 shrink-0 border-l xl:flex xl:flex-col">
          <RightPanel />
        </aside>
      </main>

      <StatusBar />

      {/* グローバルエラーの簡易表示 */}
      {lastError && (
        <div
          role="alert"
          className="fixed bottom-10 right-4 z-50 max-w-sm rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive shadow-lg"
        >
          <p>{lastError}</p>
          <button
            onClick={clearError}
            className="mt-1 underline underline-offset-2 hover:no-underline"
          >
            閉じる
          </button>
        </div>
      )}

      <Toaster position="top-center" richColors />
    </div>
  );
}
