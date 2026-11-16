"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore } from "@/lib/chatStore";
import { APP_CONFIG } from "@/config/appConfig";

export function ChatView() {
  const activeChat = useChatStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const generatingChatId = useChatStore((s) => s.generatingChatId);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const editUserMessage = useChatStore((s) => s.editUserMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isGenerating = generatingChatId !== null;

  // 新しいトークンが来たら自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeChat?.messages.length, activeChat?.messages[activeChat.messages.length - 1]?.content]);

  if (!activeChat) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        チャットを作成してください
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          {activeChat.messages.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
              <p className="text-sm font-medium text-foreground">チャットを始めましょう</p>
              <p className="max-w-md text-xs leading-relaxed">
                すべての推論はお使いのブラウザ内で完結します。入力内容はサーバーへ送信されません。
                既定のコンテキスト長は {APP_CONFIG.N_CTX.toLocaleString("ja-JP")} トークンです。
              </p>
            </div>
          ) : (
            activeChat.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                isGenerating={isGenerating}
                onDelete={() => deleteMessage(activeChat.id, m.id)}
                onEdit={(content) => editUserMessage(activeChat.id, m.id, content)}
                onRegenerate={() => regenerate(activeChat.id, m.id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <Composer />
    </div>
  );
}
