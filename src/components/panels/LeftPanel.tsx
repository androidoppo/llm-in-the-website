"use client";

import { useRef, useState } from "react";
import {
  Blocks,
  FileUp,
  HardDriveDownload,
  Link2,
  Loader2,
  MessageSquarePlus,
  Plus,
  Trash2,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { APP_CONFIG } from "@/config/appConfig";
import { useEngineStore } from "@/lib/engineStore";
import { useChatStore } from "@/lib/chatStore";
import { formatBytes } from "@/lib/tokenEstimate";
import { cn } from "@/lib/utils";

function ModelSection() {
  const [url, setUrl] = useState<string>(APP_CONFIG.DEFAULT_MODEL_URL);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const engine = useEngineStore();
  const generatingChatId = useChatStore((s) => s.generatingChatId);
  const isLoading = engine.status === "loading";
  const isReady = engine.status === "ready";
  const isGenerating = generatingChatId !== null;

  const loadUrl = () => {
    if (!url.trim()) return;
    void engine.loadFromUrl(url.trim());
  };

  const loadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await engine.loadFromFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">モデル</h2>
        {isReady && (
          <Badge variant={engine.webgpuActive ? "default" : "secondary"}>
            {engine.webgpuActive ? "WebGPU" : "WASM (CPU)"}
          </Badge>
        )}
      </div>

      {/* URL 导入 */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="model-url">
          URL から読み込む（GGUF / split GGUF の先頭ファイル）
        </label>
        <Input
          id="model-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://.../model-Q4_K_M.gguf"
          className="text-xs"
          disabled={isLoading || isGenerating}
        />
        <Button size="sm" className="w-full" onClick={loadUrl} disabled={isLoading || isGenerating}>
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <HardDriveDownload className="size-4" />
          )}
          URL から読み込み
        </Button>
      </div>

      {/* ファイル导入 */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="model-file">
          ローカルファイルから読み込む（複数選択で split GGUF）
        </label>
        <Input
          id="model-file"
          ref={fileInputRef}
          type="file"
          accept=".gguf"
          multiple
          className="text-xs"
          onChange={(e) => void loadFiles(e.target.files)}
          disabled={isLoading || isGenerating}
        />
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <FileUp className="size-3" />
          単一ファイルは 2GB まで（wasm32 制約）。大きなモデルは分割 GGUF を利用してください。
        </p>
      </div>

      {/* 進捗 */}
      {isLoading && (
        <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
          <p className="text-xs font-medium">
            {engine.progress && engine.progress.total > 0
              ? `ダウンロード中… ${engine.progress.percentage}%（${formatBytes(engine.progress.loaded)} / ${formatBytes(engine.progress.total)}）`
              : "準備中…"}
          </p>
          {engine.progress && engine.progress.total > 0 && (
            <Progress value={engine.progress.percentage} className="h-2" />
          )}
          <p className="text-[10px] text-muted-foreground">
            初回ロードには時間がかかります。モデルはメモリ上でのみ動作します（キャッシュなし）。
          </p>
        </div>
      )}

      {engine.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          {engine.error}
        </div>
      )}

      {engine.ctxFallbackNotice && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
          {engine.ctxFallbackNotice}
        </div>
      )}

      {/* モデル情報 */}
      {isReady && engine.ctxInfo && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="truncate text-xs font-medium" title={engine.modelName ?? ""}>
            {engine.modelName}
          </p>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <dt>コンテキスト</dt>
            <dd className="text-right font-mono">{engine.ctxInfo.n_ctx.toLocaleString("ja-JP")}</dd>
            <dt>レイヤー数</dt>
            <dd className="text-right font-mono">{engine.ctxInfo.n_layer}</dd>
            <dt>マルチスレッド</dt>
            <dd className="text-right font-mono">{engine.multithread ? "有効" : "無効"}</dd>
            {engine.modelSizeBytes !== null && (
              <>
                <dt>ファイルサイズ</dt>
                <dd className="text-right font-mono">{formatBytes(engine.modelSizeBytes)}</dd>
              </>
            )}
          </dl>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void engine.unload()}
            disabled={isGenerating}
          >
            <Unplug className="size-4" /> アンロード（メモリ解放）
          </Button>
        </div>
      )}
    </div>
  );
}

function LoraSection() {
  const engine = useEngineStore();
  const loraAdapters = useEngineStore((s) => s.loraAdapters);
  const addLoraFiles = useEngineStore((s) => s.addLoraFiles);
  const addLoraUrl = useEngineStore((s) => s.addLoraUrl);
  const removeLora = useEngineStore((s) => s.removeLora);
  const setLoraScale = useEngineStore((s) => s.setLoraScale);
  const toggleLora = useEngineStore((s) => s.toggleLora);
  const [url, setUrl] = useState("");
  const loraFileInputRef = useRef<HTMLInputElement>(null);

  const generatingChatId = useChatStore((s) => s.generatingChatId);
  const isLoading = engine.status === "loading";
  const isGenerating = generatingChatId !== null;
  const disabled = isLoading || isGenerating;
  const enabledCount = loraAdapters.filter((a) => a.enabled).length;
  const needsReload = engine.status === "ready" && enabledCount > 0;

  const handleAddUrl = () => {
    if (!url.trim()) return;
    addLoraUrl(url.trim());
    setUrl("");
  };

  const handleLoraFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    addLoraFiles(Array.from(files));
    if (loraFileInputRef.current) loraFileInputRef.current.value = "";
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Blocks className="size-4" /> LoRA アダプタ
        </h2>
        {loraAdapters.length > 0 && (
          <Badge variant={enabledCount > 0 ? "default" : "secondary"}>
            {enabledCount > 0 ? `${enabledCount} 件 有効` : "無効"}
          </Badge>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        モデルロード時に適用されます。追加・変更後はモデルを再ロードしてください。
      </p>

      {/* URL 追加 */}
      <div className="flex gap-1.5">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddUrl();
          }}
          placeholder="https://.../my-lora.gguf"
          className="h-8 text-xs"
          disabled={disabled}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2"
          onClick={handleAddUrl}
          disabled={disabled || !url.trim()}
          title="URL から LoRA を追加"
        >
          <Link2 className="size-3.5" />
        </Button>
      </div>

      {/* ファイル追加 */}
      <Input
        ref={loraFileInputRef}
        type="file"
        accept=".gguf"
        multiple
        className="h-8 text-xs"
        onChange={(e) => void handleLoraFiles(e.target.files)}
        disabled={disabled}
      />

      {/* アダプタ一覧 */}
      {loraAdapters.length === 0 ? (
        <p className="text-xs text-muted-foreground">追加された LoRA はありません。</p>
      ) : (
        <div className="space-y-2">
          {loraAdapters.map((a) => (
            <div key={a.id} className="space-y-1.5 rounded-md border p-2.5">
              <div className="flex items-center gap-2">
                <Switch
                  checked={a.enabled}
                  onCheckedChange={() => toggleLora(a.id)}
                  disabled={disabled}
                  aria-label={`LoRA ${a.name} を${a.enabled ? "無効化" : "有効化"}`}
                />
                <span className="min-w-0 flex-1 truncate text-xs" title={a.name}>
                  {a.name}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {a.kind === "url" ? "URL" : "ローカル"}
                </Badge>
                {a.sizeBytes !== null && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatBytes(a.sizeBytes)}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-1.5"
                  onClick={() => {
                    removeLora(a.id);
                    toast.success("LoRA を削除しました");
                  }}
                  disabled={disabled}
                  aria-label={`LoRA ${a.name} を削除`}
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pl-1">
                <span className="w-16 shrink-0 text-[10px] text-muted-foreground">scale</span>
                <Slider
                  min={0}
                  max={2}
                  step={0.05}
                  value={[a.scale]}
                  onValueChange={([v]) => setLoraScale(a.id, v)}
                  disabled={disabled}
                  className="flex-1"
                />
                <span className="w-10 shrink-0 text-right font-mono text-[10px]">
                  {a.scale.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {needsReload && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-400">
          LoRA の変更は次回のモデルロード時に適用されます。
        </p>
      )}
    </div>
  );
}

function ChatListSection() {
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const newChat = useChatStore((s) => s.newChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const selectChat = useChatStore((s) => s.selectChat);
  const generatingChatId = useChatStore((s) => s.generatingChatId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="text-sm font-semibold">チャット履歴</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={newChat}
          aria-label="新しいチャット"
          title="新しいチャット"
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-3">
          {chats.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              まだチャットがありません。「<Plus className="inline size-3" />」から作成できます。
            </p>
          )}
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => selectChat(c.id)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                c.id === activeChatId
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-muted",
                generatingChatId === c.id && "opacity-70"
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {generatingChatId === c.id && (
                  <Loader2 className="mr-1 inline size-3 animate-spin align-text-bottom" />
                )}
                {c.title}
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label="チャットを削除"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteChat(c.id);
                  toast.success("チャットを削除しました");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    deleteChat(c.id);
                  }
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export function LeftPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModelSection />
      <Separator />
      <LoraSection />
      <Separator />
      <ChatListSection />
    </div>
  );
}
