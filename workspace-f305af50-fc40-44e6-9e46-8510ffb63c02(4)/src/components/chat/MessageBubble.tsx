"use client";

import { useState } from "react";
import { Check, Copy, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

interface MessageBubbleProps {
  message: ChatMessage;
  isGenerating: boolean;
  onDelete: () => void;
  onEdit: (content: string) => void;
  onRegenerate: () => void;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre_#code]:bg-transparent [&_a]:underline">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export function MessageBubble({
  message,
  isGenerating,
  onDelete,
  onEdit,
  onRegenerate,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const streaming = isGenerating && message.role === "assistant" && message.content.length === 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("クリップボードにコピーできませんでした");
    }
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft.trim() && draft !== message.content) {
      onEdit(draft.trim());
    }
  };

  if (editing) {
    return (
      <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
        <div className="w-full max-w-[85%] rounded-lg border bg-card p-3 shadow-sm">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            className="text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              <X className="size-4" /> キャンセル
            </Button>
            <Button size="sm" onClick={commitEdit}>
              <Check className="size-4" /> 保存して再生成
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group flex w-full gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          AI
        </div>
      )}
      <div className={cn("flex max-w-[85%] flex-col gap-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-lg px-3 py-2 shadow-sm",
            isUser ? "bg-primary text-primary-foreground" : "border bg-card"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          ) : message.content.length > 0 ? (
            <MarkdownContent content={message.content} />
          ) : streaming ? (
            <span className="flex items-center gap-1 py-1" aria-label="生成中">
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {message.tokenCount !== null && <span>{message.tokenCount} tok</span>}
          {message.stopped && <span className="text-amber-600">（中断）</span>}
          {message.content.length > 0 && (
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={copy}
                aria-label="コピー"
                title="コピー"
              >
                {copied ? (
                  <Check className="size-3.5 text-green-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
              {isUser && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={startEdit}
                  aria-label="編集"
                  title="編集して再生成"
                  disabled={isGenerating}
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
              {!isUser && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={onRegenerate}
                  aria-label="再生成"
                  title="ここから再生成"
                  disabled={isGenerating}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={onDelete}
                aria-label="削除"
                title="削除"
                disabled={isGenerating}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
      </div>
      {isUser && (
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          あなた
        </div>
      )}
    </div>
  );
}
