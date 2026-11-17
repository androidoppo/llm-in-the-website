"use client";

/**
 * デバッグログビューア（Dialog）。
 *
 * - 収集したログ（wllama / アプリ / ブラウザ）を一覧表示
 * - レベルフィルタ・テキスト検索・自動スクロール
 * - コピー / ファイル保存 / クリア
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  Eraser,
  Search,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  formatLogsAsText,
  levelRank,
  RENDER_LIMIT,
  useDebugLogStore,
  type DebugLogEntry,
  type DebugLogLevel,
} from "@/lib/debugLogStore";

type LevelFilter = "all" | "info" | "warn" | "error";

const LEVEL_FILTER_LABELS: Record<LevelFilter, string> = {
  all: "すべて",
  info: "info 以上",
  warn: "warn 以上",
  error: "error のみ",
};

const LEVEL_STYLES: Record<DebugLogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-sky-600 dark:text-sky-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

const SOURCE_BADGE_VARIANT: Record<DebugLogEntry["source"], "outline" | "secondary" | "default"> = {
  wllama: "secondary",
  app: "outline",
  browser: "default",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function DebugLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const entries = useDebugLogStore((s) => s.entries);
  const captureEnabled = useDebugLogStore((s) => s.captureEnabled);
  const setCaptureEnabled = useDebugLogStore((s) => s.setCaptureEnabled);
  const clear = useDebugLogStore((s) => s.clear);

  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const minRank =
      levelFilter === "all" ? 0 : levelFilter === "error" ? 3 : levelRank(levelFilter);
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (levelFilter === "error" ? e.level !== "error" : levelRank(e.level) < minRank) return false;
      if (q && !e.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, levelFilter, search]);

  const visible = useMemo(() => filtered.slice(-RENDER_LIMIT), [filtered]);

  // 自動スクロール（新しいログが来たら最下部へ）
  useEffect(() => {
    if (open && autoScroll) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [open, autoScroll, visible.length]);

  const copyAll = async () => {
    if (filtered.length === 0) return;
    try {
      await navigator.clipboard.writeText(formatLogsAsText(filtered));
      toast.success(`${filtered.length} 件のログをコピーしました`);
    } catch {
      toast.error("クリップボードにコピーできませんでした");
    }
  };

  const downloadAll = () => {
    if (filtered.length === 0) return;
    const text = formatLogsAsText(filtered);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wllama-debug-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("ログをダウンロードしました");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-2xl flex-col sm:h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-4" /> デバッグログ
          </DialogTitle>
          <DialogDescription>
            wllama・アプリ内部・ブラウザ例外のログを表示します（最大 1500 件保持・メモリ上のみ）。
          </DialogDescription>
        </DialogHeader>

        {/* コントロール行 */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LevelFilter)}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LEVEL_FILTER_LABELS) as LevelFilter[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {LEVEL_FILTER_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-[140px] flex-1">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ログを検索"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={autoScroll} onCheckedChange={(v) => setAutoScroll(v === true)} />
            自動スクロール
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={captureEnabled}
              onCheckedChange={(v) => setCaptureEnabled(v === true)}
            />
            収集を有効化
          </label>
        </div>

        {/* ログ一覧 */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-0.5 p-2 font-mono text-[10px] leading-relaxed">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  ログはまだありません。
                </p>
              ) : (
                <>
                  {filtered.length > RENDER_LIMIT && (
                    <p className="px-1 py-1 text-[10px] text-muted-foreground">
                      最新 {RENDER_LIMIT} 件のみ表示しています（フィルタ後 {filtered.length} 件）。
                    </p>
                  )}
                  {visible.map((e) => (
                    <div key={e.id} className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-muted/60">
                      <span className="shrink-0 text-muted-foreground">{formatTime(e.ts)}</span>
                      <span
                        className={cn(
                          "w-10 shrink-0 font-bold uppercase",
                          LEVEL_STYLES[e.level]
                        )}
                      >
                        {e.level}
                      </span>
                      <Badge
                        variant={SOURCE_BADGE_VARIANT[e.source]}
                        className="h-4 shrink-0 rounded px-1 text-[9px] uppercase"
                      >
                        {e.source}
                      </Badge>
                      <span className="min-w-0 whitespace-pre-wrap break-all">
                        {e.message}
                      </span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* フッタ操作 */}
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[10px] text-muted-foreground">
            表示 {visible.length} / フィルタ後 {filtered.length} / 総計 {entries.length} 件
          </Label>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8" onClick={copyAll} disabled={filtered.length === 0}>
              <Copy className="size-3.5" /> コピー
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={downloadAll} disabled={filtered.length === 0}>
              <Download className="size-3.5" /> 保存
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-destructive hover:text-destructive"
              onClick={() => {
                clear();
                toast.success("ログをクリアしました");
              }}
              disabled={entries.length === 0}
            >
              <Eraser className="size-3.5" /> クリア
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
