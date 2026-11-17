/**
 * 簡易トークン推定。
 * モデルロード前に正確な tokenize API は使えないため、
 * 日本語（約 1〜2 文字 / トークン）と英語（約 4 文字 / トークン）を
 * 考慮して「3 文字 = 1 トークン」を基準に概算する。
 * 実測値は生成レスポンスの usage で上書きされる。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 日本語などの CJK 文字は 1 文字 ≒ 1 トークンに近い
  const cjkCount = (text.match(/[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || [])
    .length;
  const otherCount = text.length - cjkCount;
  return Math.max(1, Math.ceil(cjkCount * 1.1 + otherCount / 4));
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("ja-JP");
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
