"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_CONFIG } from "@/config/appConfig";
import { useEngineStore } from "@/lib/engineStore";
import { useChatStore } from "@/lib/chatStore";
import { KV_CACHE_TYPE_OPTIONS, useSettingsStore } from "@/lib/settingsStore";
import { estimateTokens, formatTokenCount } from "@/lib/tokenEstimate";
import { cn } from "@/lib/utils";

function TokenStatsSection() {
  const engine = useEngineStore();
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const systemPrompt = useSettingsStore((s) => s.params.systemPrompt);
  const activeChat = chats.find((c) => c.id === activeChatId);

  const nCtx = engine.ctxInfo?.n_ctx ?? APP_CONFIG.N_CTX;

  // 現在の会話コンテキスト消費量:
  // 生成後は usage 実測値、それまではメッセージごとのトークン数（実測 or 推定）を合計
  const estimated =
    (activeChat?.messages.reduce(
      (acc, m) => acc + (m.tokenCount ?? estimateTokens(m.content)),
      0
    ) ?? 0) + (systemPrompt ? estimateTokens(systemPrompt) : 0);
  const contextTokens = engine.contextTokens > 0 ? engine.contextTokens : estimated;
  const ratio = Math.min(contextTokens / nCtx, 1);
  const warningLevel =
    ratio >= 0.95 ? "critical" : ratio >= APP_CONFIG.CONTEXT_WARNING_RATIO ? "warning" : "ok";

  const sessionTotal = chats.reduce((acc, c) => acc + c.totalTokens, 0);

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">トークン消費量</h2>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">このチャット</dt>
        <dd className="text-right font-mono">
          {formatTokenCount(activeChat?.totalTokens ?? 0)} tok
        </dd>
        <dt className="text-muted-foreground">セッション累計</dt>
        <dd className="text-right font-mono">{formatTokenCount(sessionTotal)} tok</dd>
        <dt className="text-muted-foreground">直近の生成（実測）</dt>
        <dd className="text-right font-mono">
          {engine.contextTokens > 0 ? `${formatTokenCount(engine.contextTokens)} tok` : "—"}
        </dd>
      </dl>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">コンテキスト使用率</span>
          <span
            className={cn(
              "font-mono",
              warningLevel === "critical" && "font-bold text-destructive",
              warningLevel === "warning" && "font-bold text-amber-600"
            )}
          >
            {formatTokenCount(contextTokens)} / {formatTokenCount(nCtx)} (
            {Math.round(ratio * 100)}%)
          </span>
        </div>
        <Progress
          value={ratio * 100}
          className={cn(
            "h-2",
            warningLevel === "critical" && "[&>div]:bg-destructive",
            warningLevel === "warning" && "[&>div]:bg-amber-500"
          )}
        />
        {warningLevel !== "ok" && (
          <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <TriangleAlert className="size-3" />
            コンテキストの使用率が {APP_CONFIG.CONTEXT_WARNING_RATIO * 100}% を超えました。
            モデルが古い内容を忘れる可能性があります。新しいチャットの作成を検討してください。
          </p>
        )}
      </div>
    </div>
  );
}

function ParamsSection() {
  const params = useSettingsStore((s) => s.params);
  const setParam = useSettingsStore((s) => s.setParam);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">生成パラメータ</h2>
        <Button variant="ghost" size="sm" onClick={resetToDefaults} title="APP_CONFIG の値に戻す">
          <RotateCcw className="size-3.5" /> 既定値
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="temp" className="text-xs">
            温度 (temperature)
          </Label>
          <span className="font-mono text-xs">{params.temperature.toFixed(2)}</span>
        </div>
        <Slider
          id="temp"
          min={0}
          max={2}
          step={0.05}
          value={[params.temperature]}
          onValueChange={([v]) => setParam("temperature", v)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="topp" className="text-xs">
            top_p
          </Label>
          <span className="font-mono text-xs">{params.topP.toFixed(2)}</span>
        </div>
        <Slider
          id="topp"
          min={0}
          max={1}
          step={0.05}
          value={[params.topP]}
          onValueChange={([v]) => setParam("topP", v)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="max-tokens" className="text-xs">
          最大出力トークン数
        </Label>
        <Input
          id="max-tokens"
          type="number"
          min={16}
          max={4096}
          value={params.maxNewTokens}
          onChange={(e) => setParam("maxNewTokens", Math.max(1, Number(e.target.value) || 1))}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="stop" className="text-xs">
          停止シーケンス（カンマ区切り）
        </Label>
        <Input
          id="stop"
          value={params.stopSequences}
          onChange={(e) => setParam("stopSequences", e.target.value)}
          placeholder="例: 終了, ###"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="system" className="text-xs">
          システムプロンプト
        </Label>
        <Textarea
          id="system"
          value={params.systemPrompt}
          onChange={(e) => setParam("systemPrompt", e.target.value)}
          rows={4}
          className="text-xs"
        />
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        その他のオプション（n_ctx / n_gpu_layers / n_batch / flash_attn など）は
        <code className="rounded bg-muted px-1">src/config/appConfig.ts</code>
        の APP_CONFIG に一元管理されています。値を書き換えるだけで全環境に反映されます。
      </p>
    </div>
  );
}

function KvCacheSection() {
  const params = useSettingsStore((s) => s.params);
  const setParam = useSettingsStore((s) => s.setParam);
  const engineStatus = useEngineStore((s) => s.status);

  const vQuantized = params.cacheTypeV !== "f16";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">KV キャッシュ</h2>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        KV キャッシュを量子化するとメモリ使用量を削減できます。変更は次回のモデルロード時に適用されます。
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="cache-type-k" className="text-xs">
          K キャッシュの型
        </Label>
        <Select
          value={params.cacheTypeK}
          onValueChange={(v) => setParam("cacheTypeK", v as typeof params.cacheTypeK)}
        >
          <SelectTrigger id="cache-type-k" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KV_CACHE_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cache-type-v" className="text-xs">
          V キャッシュの型
        </Label>
        <Select
          value={params.cacheTypeV}
          onValueChange={(v) => setParam("cacheTypeV", v as typeof params.cacheTypeV)}
        >
          <SelectTrigger id="cache-type-v" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KV_CACHE_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {vQuantized && (
          <p className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            V キャッシュの量子化には Flash Attention が必要なため、ロード時に自動で有効化されます。
          </p>
        )}
      </div>

      {engineStatus === "ready" && (
        <p className="text-[10px] text-muted-foreground">
          現在の設定は次回ロード時に反映されます（アンロード → 再ロードで適用）。
        </p>
      )}
    </div>
  );
}

export function RightPanel() {
  return (
    <div className="h-full overflow-y-auto">
      <ParamsSection />
      <Separator />
      <KvCacheSection />
      <Separator />
      <TokenStatsSection />
    </div>
  );
}
