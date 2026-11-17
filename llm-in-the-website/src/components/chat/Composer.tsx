"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEngineStore } from "@/lib/engineStore";
import { useChatStore } from "@/lib/chatStore";

export function Composer() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const engineStatus = useEngineStore((s) => s.status);
  const generatingChatId = useChatStore((s) => s.generatingChatId);
  const generate = useChatStore((s) => s.generate);
  const stop = useChatStore((s) => s.stop);
  const activeChatId = useChatStore((s) => s.activeChatId);

  const isGenerating = generatingChatId !== null;
  const disabled = engineStatus !== "ready" || isGenerating;

  const send = () => {
    if (disabled || !activeChatId || !text.trim()) return;
    const t = text;
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    void generate(activeChatId, t);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t bg-background p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            engineStatus !== "ready"
              ? "先に左パネルからモデルを読み込んでください"
              : "メッセージを入力（Enter で送信 / Shift+Enter で改行）"
          }
          rows={1}
          className="max-h-40 min-h-11 resize-none text-sm"
          disabled={isGenerating}
        />
        {isGenerating ? (
          <Button
            variant="destructive"
            size="icon"
            className="size-11 shrink-0"
            onClick={stop}
            aria-label="生成を停止"
            title="生成を停止"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-11 shrink-0"
            onClick={send}
            disabled={disabled || !text.trim()}
            aria-label="送信"
            title="送信"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      {engineStatus === "idle" && (
        <p className="mx-auto mt-2 flex max-w-3xl items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          GGUF モデルをブラウザ内で直接実行します。URL またはローカルファイルから読み込めます。
        </p>
      )}
    </div>
  );
}
