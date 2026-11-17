"use client";

import { useState } from "react";
import { Cpu, Terminal, TriangleAlert, Zap } from "lucide-react";
import { APP_CONFIG } from "@/config/appConfig";
import { useEngineStore } from "@/lib/engineStore";
import { useChatStore } from "@/lib/chatStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { levelRank, useDebugLogStore } from "@/lib/debugLogStore";
import { estimateTokens, formatTokenCount } from "@/lib/tokenEstimate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DebugLogDialog } from "@/components/DebugLogDialog";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const status = useEngineStore((s) => s.status);
  const webgpuActive = useEngineStore((s) => s.webgpuActive);
  const multithread = useEngineStore((s) => s.multithread);
  const ctxInfo = useEngineStore((s) => s.ctxInfo);
  const tokPerSec = useEngineStore((s) => s.tokPerSec);
  const contextTokens = useEngineStore((s) => s.contextTokens);
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const systemPrompt = useSettingsStore((s) => s.params.systemPrompt);
  const logEntries = useDebugLogStore((s) => s.entries);
  const [logOpen, setLogOpen] = useState(false);
  // warn / error のみをカウント（バッジ表示用）
  const warnErrorCount = logEntries.filter((e) => levelRank(e.level) >= 2).length;
  const activeChat = chats.find((c) => c.id === activeChatId);

  const nCtx = ctxInfo?.n_ctx ?? APP_CONFIG.N_CTX;
  const estimated =
    (activeChat?.messages.reduce(
      (acc, m) => acc + (m.tokenCount ?? estimateTokens(m.content)),
      0
    ) ?? 0) + (systemPrompt ? estimateTokens(systemPrompt) : 0);
  const used = contextTokens > 0 ? contextTokens : estimated;
  const ratio = Math.round(Math.min(used / nCtx, 1) * 100);
  const sessionTotal = chats.reduce((acc, c) => acc + c.totalTokens, 0);

  return (
    <footer className="flex items-center gap-3 border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        {status === "ready" ? (
          webgpuActive ? (
            <Badge variant="default" className="h-5 gap-1 px-1.5 text-[10px]">
              <Zap className="size-3" /> WebGPU
            </Badge>
          ) : (
            <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
              <Cpu className="size-3" /> WASM (CPU)
            </Badge>
          )
        ) : (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {status === "loading" ? "ロード中…" : "モデル未ロード"}
          </Badge>
        )}
      </span>
      {multithread && status === "ready" && <span>マルチスレッド</span>}
      <span className="hidden sm:inline">
        n_ctx: <span className="font-mono">{nCtx.toLocaleString("ja-JP")}</span>
      </span>
      <span>
        速度:{" "}
        <span className="font-mono">
          {tokPerSec !== null ? `${tokPerSec.toFixed(1)} tok/s` : "—"}
        </span>
      </span>
      <span className="hidden sm:inline">
        セッション累計: <span className="font-mono">{formatTokenCount(sessionTotal)} tok</span>
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px]"
          onClick={() => setLogOpen(true)}
          title="デバッグログを開く"
          aria-label="デバッグログを開く"
        >
          <Terminal className="size-3.5" />
          ログ
          {warnErrorCount > 0 && (
            <Badge
              variant="destructive"
              className="h-4 gap-0.5 rounded px-1 text-[9px]"
            >
              <TriangleAlert className="size-2.5" />
              {warnErrorCount}
            </Badge>
          )}
        </Button>
        コンテキスト:{" "}
        <span
          className={cn(
            "font-mono",
            ratio >= 95 && "font-bold text-destructive",
            ratio >= 80 && ratio < 95 && "font-bold text-amber-600"
          )}
        >
          {ratio}%
        </span>
      </span>

      <DebugLogDialog open={logOpen} onOpenChange={setLogOpen} />
    </footer>
  );
}
