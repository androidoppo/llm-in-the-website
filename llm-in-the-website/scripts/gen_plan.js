// ブラウザ内LLMチャット開発計画書 生成スクリプト (docx-js)
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  PageBreak, TableLayoutType,
} = require("docx");
const fs = require("fs");

// ───────────────────────── Palette (GO-1 Graphite Orange) ─────────────────────────
const PAL = {
  bg: "1A2330", accent: "D4875A",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "D4875A", headerText: "FFFFFF", accentLine: "D4875A", innerLine: "DDD0C8", surface: "F8F0EB" },
  primary: "1A2330", body: "000000", secondary: "606060",
};
const FONT = { ascii: "Calibri", eastAsia: "Meiryo" };

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };
const emptyPara = () => new Paragraph({ children: [] });

// ───────────────────────── calcTitleLayout / splitTitleLines ─────────────────────────
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？」)", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt -= 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

// ───────────────────────── Cover Recipe R4 (Top Color Block) ─────────────────────────
function buildCoverR4(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 26);
  const titleSize = titlePt * 2;

  const titleBlockHeight = titleLines.length * (titlePt * 23 + 200);
  const englishLabelH = config.englishLabel ? (9 * 23 + 500) : 0;
  const subtitleH = config.subtitle ? (12 * 23 + 200) : 0;
  const upperContentH = englishLabelH + titleBlockHeight + subtitleH;
  const UPPER_MIN = 7500;
  const UPPER_H = Math.max(UPPER_MIN, upperContentH + 1500 + 800);
  const DIVIDER_H = 60;

  const contentEstimate = englishLabelH + titleBlockHeight + subtitleH;
  const spacerIntrinsic = 280;
  const topSpacing = Math.max(UPPER_H - contentEstimate - spacerIntrinsic - 800, 400);

  const upperBlock = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: UPPER_H, rule: "exact" },
      children: [new TableCell({
        shading: { fill: P.bg }, borders: noBorders,
        verticalAlign: "top",
        margins: { left: padL, right: padR },
        children: [
          new Paragraph({ spacing: { before: topSpacing } }),
          config.englishLabel ? new Paragraph({
            spacing: { after: 500 },
            children: [new TextRun({ text: config.englishLabel.split("").join(" "),
              size: 18, color: P.accent, font: { ascii: "Calibri" }, characterSpacing: 60 })],
          }) : null,
          ...titleLines.map((line, i) => new Paragraph({
            spacing: { after: i < titleLines.length - 1 ? 100 : 200, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
            children: [new TextRun({ text: line, size: titleSize, bold: true,
              color: P.cover.titleColor, font: FONT })],
          })),
          config.subtitle ? new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor, font: FONT })],
          }) : null,
        ].filter(Boolean),
      })],
    })],
  });

  const divider = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: DIVIDER_H, rule: "exact" },
      children: [new TableCell({ borders: noBorders,
        shading: { fill: P.accent }, children: [emptyPara()] })],
    })],
  });

  const lowerContent = [
    new Paragraph({ spacing: { before: 800 } }),
    ...(config.metaLines || []).map(line => new Paragraph({
      indent: { left: padL }, spacing: { after: 100 },
      children: [new TextRun({ text: line, size: 26, color: P.cover.metaColor, font: FONT })],
    })),
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({
      indent: { left: padL },
      children: [
        new TextRun({ text: config.footerLeft || "", size: 22, color: "909090", font: FONT }),
        new TextRun({ text: "          ", font: FONT }),
        new TextRun({ text: config.footerRight || "", size: 22, color: "909090", font: FONT }),
      ],
    }),
  ];

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { fill: "FFFFFF" }, borders: noBorders,
        verticalAlign: "top",
        children: [upperBlock, divider, ...lowerContent],
      })],
    })],
  })];
}

// ───────────────────────── Body builders ─────────────────────────
function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 380, lineRule: "atLeast" },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PAL.accent, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 30, color: PAL.primary, font: FONT })],
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120, line: 340, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 26, color: PAL.primary, font: FONT })],
  });
}
// body paragraph — parts: string or {t, b} objects
function B(parts, opts = {}) {
  const arr = Array.isArray(parts) ? parts : [{ t: parts }];
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: opts.noIndent ? 0 : 480 },
    spacing: { line: 312, after: 80 },
    children: arr.map(p => new TextRun({
      text: typeof p === "string" ? p : p.t,
      bold: typeof p === "object" && !!p.b,
      size: 22, color: PAL.body, font: FONT,
    })),
  });
}
function caption(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: PAL.primary, font: FONT })],
  });
}
// generic table — headers: string[], rows: string[][], widths: number[] (percent)
function TBL(headers, rows, widths) {
  const mkCell = (text, isHeader, w, zebra) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: isHeader
      ? { type: ShadingType.CLEAR, fill: PAL.table.headerBg }
      : { type: ShadingType.CLEAR, fill: zebra ? PAL.table.surface : "FFFFFF" },
    children: [new Paragraph({
      spacing: { line: 280 },
      children: [new TextRun({
        text, bold: isHeader, size: isHeader ? 21 : 20,
        color: isHeader ? PAL.table.headerText : PAL.body, font: FONT,
      })],
    })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((h, i) => mkCell(h, true, widths[i], false)),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((c, ci) => mkCell(c, false, widths[ci], ri % 2 === 1)),
      })),
    ],
  });
}

// ───────────────────────── Content ─────────────────────────
const bodyChildren = [];

// 1. エグゼクティブサマリー
bodyChildren.push(H1("1. エグゼクティブサマリー"));
bodyChildren.push(B([
  "本計画書は、GGUF形式の大規模言語モデル(LLM)をブラウザのタブ内で完結して実行するチャットアプリケーションの開発計画である。サーバ側の推論APIを持たない完全クライアント側処理とし、静的ホスティング(Cloudflare Pages)のみで配信する。UIはチャットに必要な最小構成(会話・履歴・設定)とし、操作対象は日常的な利用に限定する。",
]));
bodyChildren.push(B([
  "推論エンジンには",
  { t: "wllama(llama.cppのWebAssemblyバインディング)", b: true },
  "を採用する。事前調査の結果、wllama本家パッケージ(@wllama/wllama)v3.1以降にはllama.cppのggml WebGPUバックエンドが統合済みであり、要件の「WebGPUが主」は単一エンジンで満たせる。当初検討したweb-llm(MLC)との併用(ハイブリッド構成)は、web-llmがGGUFを直接読み込めないこと、およびwllama単体でWebGPU優先・CPU互換ビルドへのフォールバックが実現できることから不採用とする。",
]));
bodyChildren.push(B([
  "技術スタックはReact + Vite + TypeScriptとし、推論処理はWeb Worker内に隔離する。モデルはファイルまたはURLからインポートし、永続キャッシュは行わない(メモリオンリ運用)。主要リスクはwasm32環境のメモリ上限(単一バッファ2GB)とWebGPU対応の端末依存であり、split GGUF対応・GPU層オフロード・コンテキスト長の段階的フォールバックで対処する。開発はP0〜P5の6フェーズで進め、目安として約10人日(+検証バッファ2〜3日)を想定する。",
]));

// 2. 背景と前提の整理
bodyChildren.push(H1("2. 背景と前提の整理"));
bodyChildren.push(H2("2.1 開発要件の一覧"));
bodyChildren.push(B("本計画が扱う要件を出発点として整理する。各要件と対応する設計章の対応関係を表1に示す。"));
bodyChildren.push(caption("表1 開発要件一覧と対応設計"));
bodyChildren.push(TBL(
  ["ID", "要件", "対応箇所"],
  [
    ["R-01", "タブ上でLLMを動かす(wllamaをブラウザで実行)", "第3章"],
    ["R-02", "シンプルなUI", "4.6"],
    ["R-03", "ホスティングは静的", "3.3"],
    ["R-04", "オプション(コンテキスト長など)を変数で管理し一括変更", "4.1"],
    ["R-05", "GGUFのファイルインポート", "4.2"],
    ["R-06", "URLからのGGUFインポート", "4.2"],
    ["R-07", "タブのメモリ上限対策(wasm32)", "4.3"],
    ["R-08", "現在のトークン消費量の計算", "4.4"],
    ["R-09", "チャットの削除・編集・再生成", "4.5"],
    ["R-10", "WebGPUが主の推論経路", "2.2 / 第3章"],
  ],
  [10, 60, 30]
));

bodyChildren.push(H2("2.2 Wllamaの現状とWebGPU対応の検証"));
bodyChildren.push(B([
  "wllamaはllama.cppをWebAssembly(WASM)向けにビルドし、ブラウザから直接推論を実行できるようにしたバインディングである。かつてのwllamaはWASM-SIMDによるCPU推論のみで、WebGPUには非対応であった。しかし2026年5月に公開されたllama.cppのggml WebGPUバックエンドのブラウザ対応(Llamas on the Web)が本家リポジトリに統合され、v3.1以降はWebGPUが自動有効化されている。モデル読み込みパラメータの",
  { t: "n_gpu_layers", b: true },
  "でGPUへ配置する層数を制御でき、WGSLで実装された行列演算・FlashAttentionカーネルにより、CPU実行と比較してprefill(プロンプト処理)・decode(トークン生成)ともに大幅な高速化が報告されている。",
]));
bodyChildren.push(B([
  "一方でWebGPU実行には前提条件がある。JSPI(JavaScript Promise Integration)と64ビットWASMメモリ(memory64)を備えた環境では最適なビルドが動作し、非対応の環境ではwllamaが同梱する互換(compat)ビルドへ自動フォールバックする。Safariはcompatビルドで動作するが性能は低下する。Firefoxはcompatモード(wllama.setCompat)での動作が案内されている。またマルチスレッド実行にはCOOP/COEPヘッダによるクロスオリジン分離が必須である(3.3参照)。",
]));
bodyChildren.push(B([
  "以上を踏まえると、「llama.cppのWASM版はWebGPU未対応、ゆえにwllamaも未対応では?」という前提は現在では成立しない。本計画では",
  { t: "wllama単体で「WebGPUが主・CPU互換ビルドが従」の構成", b: true },
  "を採用する。web-llmはWebGPU推論に特化する一方、モデル形式がMLC独自でありGGUFの直接インポート(R-05, R-06)と両立しないため、採用しない。",
]));

bodyChildren.push(H2("2.3 前提方針の確定"));
bodyChildren.push(B("以下の前提を本計画の確定事項とする。"));
bodyChildren.push(B([{ t: "(1) 単一エンジン: ", b: true }, { t: "推論はwllama v3.xに集約する。バックエンドの優先順位はWebGPU、CPUマルチスレッド、CPUシングルスレッドの順とし、起動時に機能検知して自動選択する。" }]));
bodyChildren.push(B([{ t: "(2) モデルはメモリオンリ運用: ", b: true }, { t: "URLからインポートしたGGUFは保存せず、ページ読み込みのたびに取得する。ブラウザストレージを圧迫しない反面、再訪時の再ダウンロードが発生する点を仕様として受け入れる。" }]));
bodyChildren.push(B([{ t: "(3) チャット履歴のみ永続化: ", b: true }, { t: "会話データはlocalStorageに保存し、モデル実体は保存しない。" }]));
bodyChildren.push(B([{ t: "(4) 検証用モデル: ", b: true }, "初期検証には1Bパラメータ未満・Q4_K_M量子化程度の小型GGUF(例: Gemma系270M相当)を用い、動作確認後に中型モデルへ拡張する。"]));

// 3. 全体アーキテクチャと技術選定
bodyChildren.push(H1("3. 全体アーキテクチャと技術選定"));
bodyChildren.push(H2("3.1 レイヤ構成"));
bodyChildren.push(B("アプリケーションを5層に分割する。推論はすべてWeb Worker内で完結し、UIスレッドはブロックされない。層ごとの担当と技術を表2に示す。"));
bodyChildren.push(caption("表2 レイヤ構成"));
bodyChildren.push(TBL(
  ["層", "技術", "役割"],
  [
    ["UI層", "React 19 + Vite + TypeScript", "チャット画面・設定パネル・状態管理(useReducer + Context)"],
    ["エンジン層", "@wllama/wllama v3.x(Web Worker内)", "モデルロード・推論・トークン化。OpenAI互換APIで呼び出し"],
    ["通信層", "fetch + ReadableStream", "URLからのGGUF取得(進捗表示付き)、ストリーミング生成の受信"],
    ["ストレージ層", "localStorage", "チャット履歴・設定値・URL履歴の保存(モデル実体は保存しない)"],
    ["配信層", "Cloudflare Pages", "静的アセット配信、_headersによるCOOP/COEP設定"],
  ],
  [14, 34, 52]
));
bodyChildren.push(B([
  "推論の流れは次のとおりである。UI層が送信メッセージを履歴に追加し、Workerへchat.completions形式のリクエストを発行する。Worker内のwllamaがコンテキストを構築して生成を開始し、トークンごとにUIへストリーミング通知する。UI層は受信トークンを逐次描画するとともに、4.4の方式で消費トークンを積算する。生成完了時に応答を履歴へ確定保存する。",
]));

bodyChildren.push(H2("3.2 技術選定の理由"));
bodyChildren.push(B([
  { t: "React + Vite + TypeScript: ", b: true },
  "チャットは「履歴の追記・編集・再生成・削除」のように配列状態への操作が頻発するため、宣言的レンダリングによる状態と画面の一致が有効である。TypeScriptにより設定値(R-04)やトークン集計(R-08)の型安全性を確保する。Viteのビルド成果物は純粋な静的ファイルであり、Cloudflare Pagesへそのまま配置できる。Vanilla JSは依存を最小化できるが、履歴CRUDと再生成の状態操作が肥大化しやすいため不採用とした。",
]));
bodyChildren.push(B([
  { t: "wllama: ", b: true },
  "GGUFを直接読み込めるブラウザ系エンジンであり、2GB超モデルのためのsplit GGUF対応、OpenAI互換API、Workerでの動作、WebGPU統合(v3.1以降)を備える。要件R-01〜R-07を単一ライブラリで満たせる点が決め手である。",
]));

bodyChildren.push(H2("3.3 Cloudflare Pagesでの配信要件"));
bodyChildren.push(B([
  "wllamaのマルチスレッドビルドはSharedArrayBufferを使用するため、ページがcrossOriginIsolatedである必要がある。これを実現するため、リポジトリ直下の",
  { t: "_headers", b: true },
  "ファイルに以下を定義する。",
]));
bodyChildren.push(new Paragraph({
  spacing: { line: 280, before: 80, after: 80 },
  indent: { left: 480 },
  shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
  children: [
    new TextRun({ text: "/*", size: 20, color: "333333", font: { ascii: "Consolas", eastAsia: "Meiryo" } }),
    new TextRun({ text: "  Cross-Origin-Opener-Policy: same-origin", break: 1, size: 20, color: "333333", font: { ascii: "Consolas", eastAsia: "Meiryo" } }),
    new TextRun({ text: "  Cross-Origin-Embedder-Policy: require-corp", break: 1, size: 20, color: "333333", font: { ascii: "Consolas", eastAsia: "Meiryo" } }),
  ],
}));
bodyChildren.push(B([
  "COEPにrequire-corpを採用するのはFirefoxとの互換性のためである(credentiallessはChromium系限定)。この設定下ではクロスオリジン資源の取得にCORSヘッダが必要となるが、Hugging Face等の主要GGUF配信元はCORSを許可しており、URLインポート(R-06)は成立する。インポート先がCORS非対応の場合はブラウザ側で取得できないため、エラーメッセージでローカルファイル経由の代替を案内する。なおwasmのMIMEタイプ(application/wasm)はPagesが既定で対応する。",
]));

// 4. 詳細設計
bodyChildren.push(H1("4. 詳細設計"));
bodyChildren.push(H2("4.1 設定の一元管理(R-04)"));
bodyChildren.push(B([
  "推論とUIに関わる調整可能値は、",
  { t: "src/config/appConfig.ts に単一のオブジェクトAPP_CONFIGとして定義", b: true },
  "する。型定義・既定値・範囲バリデーションを同一ファイルに置き、UI(設定パネル)、Workerへのリクエスト生成、コンテキスト計算のすべてがこのオブジェクトのみを参照する。変更は設定パネルから一括で行い、保存時にlocalStorageへ反映、次回モデルロード時に適用する。主な変数を表3に示す。",
]));
bodyChildren.push(caption("表3 一元管理する設定変数(APP_CONFIG)"));
bodyChildren.push(TBL(
  ["変数名", "既定値", "説明"],
  [
    ["N_CTX", "4096", "コンテキスト長。メモリ逼迫時は段階的フォールバック(4.3)"],
    ["N_GPU_LAYERS", "99", "GPUへオフロードする層数。WebGPU有効時に使用"],
    ["N_THREADS", "ハードウェア並列数 - 1", "CPU実行時のスレッド数"],
    ["N_BATCH", "512", "プロンプト処理のバッチサイズ"],
    ["FLASH_ATTN", "true", "FlashAttention使用フラグ(WebGPU時)"],
    ["TEMPERATURE", "0.7", "生成温度"],
    ["TOP_P", "0.9", "nucleus sampling"],
    ["MAX_NEW_TOKENS", "1024", "1回の生成で出力する最大トークン数"],
    ["STOP_SEQUENCES", "[]", "生成停止条件"],
    ["SYSTEM_PROMPT", "空文字", "システムプロンプト"],
    ["DEFAULT_MODEL_URL", "検証用小型GGUF", "初回起動時に提案するモデルURL"],
  ],
  [24, 24, 52]
));

bodyChildren.push(H2("4.2 GGUFインポート(ファイル/URL)"));
bodyChildren.push(B([
  { t: "ファイルインポート(R-05): ", b: true },
  "input[type=file]のmultiple選択に対応し、選択されたFileオブジェクトをそのままloadModelへ渡す。単一ファイルは2GB未満に制限され、複数ファイル選択時はsplit GGUF(4.3参照)として順序通り結合して読み込む。拡張子(.gguf)と先頭マジックナンバーで簡易検証を行う。",
]));
bodyChildren.push(B([
  { t: "URLインポート(R-06): ", b: true },
  "URL入力欄にGGUFの直接リンクを指定して取得する。wllamaのリモートGGUF読込はHTTP範囲リクエストを利用して必要部分を逐次読むため、ファイル全体を一度にメモリへ保持しない設計が可能である(実装時に使用バージョンの挙動を確認する)。取得状況はプログレスバーに表示する。使用したURLは履歴としてlocalStorageに保存するが、モデル実体は保存しない(2.3(2))。配信元のCORS要件は3.3のとおりである。",
]));

bodyChildren.push(H2("4.3 タブのメモリ上限対策(R-07)"));
bodyChildren.push(B([
  "wasm32のアドレス空間は32ビットに制限され、実用上の上限は概ね4GB、さらに単一のArrayBufferは2GB未満という制約がある。ブラウザタブのメモリ上限はそれより小さい場合も多く、モデル重み+KVキャッシュ+ワーカの合計が上限を超えるとタブがクラッシュする。本計画では表4の7施策を組み合わせて対処する。",
]));
bodyChildren.push(caption("表4 wasm32メモリ上限対策一覧"));
bodyChildren.push(TBL(
  ["#", "施策", "内容"],
  [
    ["M-1", "最適ビルドの優先選択", "JSPI/memory64対応環境では64ビットメモリの標準ビルドを使用し、非対応環境はwllama同梱のcompatビルドへ自動切替"],
    ["M-2", "GPU層オフロード", "n_gpu_layersで重みをWebGPUのVRAMへ配置し、WASMヒープの占有を回避"],
    ["M-3", "split GGUF", "2GB超のモデルはllama-gguf-split等で分割された複数ファイルとして読み込み、単一ArrayBufferの2GB制限を回避"],
    ["M-4", "範囲リクエスト読込", "URLインポート時に全体を一度にメモリへ載せず、必要部分を逐次取得"],
    ["M-5", "コンテキスト長の段階的フォールバック", "ロード失敗(OOM)時にN_CTXを4096→2048→1024へ段階的に下げて再試行し、成功値を設定へ逆反映"],
    ["M-6", "Worker隔離と明示的解放", "モデルはWorker内でのみ保持し、モデル切替・ページ離脱時にunloadして参照を切る。UI側にバッファの複製を作らない"],
    ["M-7", "事前の負荷見積り表示", "モデルサイズとN_CTXから必要メモリの概算を表示し、超過が見込まれる場合は警告して続行可否をユーザーに判断させる"],
  ],
  [8, 30, 62]
));

bodyChildren.push(H2("4.4 トークン消費量の計算(R-08)"));
bodyChildren.push(B([
  "消費トークンは3つの粒度で計測する。入力側は送信直前にwllamaのトークン化APIでメッセージ(+システムプロンプト+履歴)の実際のトークン数を計算する。出力側はストリーミング受信時に応答のusage情報を取得し、取得できない実装状況では受信チャンクから積算する。集計はメッセージ単位(prompt/completion)、チャット単位の累計、アプリ全体のセッション累計の3段階でstateに保持し、ステータスバーに常時表示する。",
]));
bodyChildren.push(B([
  "あわせて、現在の履歴合計トークンをN_CTXで割ったコンテキスト使用率も表示し、80%を超えたら警告色へ切り替える。これにより「いつコンテキスト圧縮・新規チャットへ移るべきか」をユーザーが判断できる。生成速度(tok/s)の表示も同ステータスバーに含める。",
]));

bodyChildren.push(H2("4.5 チャットの削除・編集・再生成(R-09)"));
bodyChildren.push(B("チャット状態は「チャット配列(各チャットはメッセージ配列を保持)」の単純な木構造とし、分岐は保持しない(v1仕様)。各操作の仕様を表5に示す。"));
bodyChildren.push(caption("表5 チャット操作の仕様"));
bodyChildren.push(TBL(
  ["操作", "動作", "補足"],
  [
    ["チャット削除", "対象チャットを履歴一覧から除去しlocalStorageへ反映", "確認ダイアログを表示(取り消し不可)"],
    ["メッセージ削除", "指定メッセージを除去(以降のメッセージは保持)", "削除位置以降の整合性は再生成・編集で再構築"],
    ["ユーザーメッセージ編集", "編集内容へ差し替え、当該位置以降を切り捨てて再送信", "編集前に元メッセージをクリップボード退避可能にする"],
    ["再生成", "直近のassistant応答を除去し、同一履歴で再実行", "生成中は停止(abort)ボタンへ切替"],
    ["生成停止", "実行中の推論を中断し、そこまでの応答を保存", "中断応答もトークン消費に計上"],
  ],
  [22, 44, 34]
));

bodyChildren.push(H2("4.6 UI構成(R-02)"));
bodyChildren.push(B([
  "画面は3ペイン構成とする。左ペインにチャット一覧と新規作成・削除、中央ペインに会話本文と入力欄、右ペインにモデルパネル(ファイル/URLインポート、読込済みモデル情報)と設定パネル(APP_CONFIGの一括変更)を置く。最下部にステータスバー(モデル名・推論バックエンドの表示[WebGPU/CPU]・tok/s・トークン消費量・コンテキスト使用率)を常設する。",
]));
bodyChildren.push(B([
  "簡素さを保つため、デフォルト状態では右ペインを折りたたみ、モデル未読込時は中央に「モデルを読み込んでください」の初期画面を表示する。モバイル幅では右ペインをドロワーに切替える。応答は軽量なMarkdownレンダラで表示し(コードブロック対応、v1ではシンタックスハイライトは任意)、生成中はカーソル点滅で進行を示す。",
]));

// 5. 実装ロードマップ
bodyChildren.push(H1("5. 実装ロードマップ"));
bodyChildren.push(B("開発は6フェーズで進める。各フェーズの成果物と受け入れ基準を表6に示す。工数は一人の開発者を想定した概算である。"));
bodyChildren.push(caption("表6 実装ロードマップ"));
bodyChildren.push(TBL(
  ["フェーズ", "内容", "成果物", "受け入れ基準", "目安"],
  [
    ["P0 環境構築", "Vite+React+TS雛形、wllama導入、Pages設定と_headers", "デプロイ済み雛形", "Pages上で初期画面が表示されcrossOriginIsolatedがtrue", "0.5日"],
    ["P1 推論パイプライン", "Worker実装、モデルロード、ストリーミング生成", "会話可能な最小アプリ", "既定URLの小型GGUFで逐次描画される会話が成立", "2日"],
    ["P2 モデルインポート", "ファイル/URL取り込み、split GGUF、進捗UI", "モデルパネル", "2GB超のsplit GGUFが読み込める", "1.5日"],
    ["P3 チャット管理", "履歴CRUD、編集・再生成・削除、localStorage保存", "チャットUI完成形", "表5の5操作が仕様どおり動作", "2日"],
    ["P4 設定とトークン計測", "APP_CONFIG一括変更パネル、トークン集計表示", "設定パネル+ステータスバー", "表示値が手計算と一致、変更が次回ロードに反映", "1.5日"],
    ["P5 メモリ対策と検証", "フォールバック実装、ブラウザマトリクス検証", "検証記録", "表4の7施策が実装済み、Chrome/Edge/Firefox/Safariで動作", "2日"],
  ],
  [16, 26, 16, 28, 14]
));
bodyChildren.push(B([
  "合計は約9.5人日であり、ブラウザ間差異の調整を見込んだ検証バッファ2〜3日を上乗せして約12人日を計画上限とする。P1終了時点で「動く最小構成」が確定するため、以降はUIと堅牢化の改善に区切って進める。",
]));

// 6. リスクと対策
bodyChildren.push(H1("6. リスクと対策"));
bodyChildren.push(B("主要リスクと対策を表7に示す。発生可能性・影響度は高/中/低の3段階評価である。"));
bodyChildren.push(caption("表7 リスクと対策"));
bodyChildren.push(TBL(
  ["リスク", "可能性", "影響", "対策"],
  [
    ["WebGPUが端末・ブラウザにより使えない/性能差が出る", "中", "中", "機能検知でバックエンド表示、compatビルドへ自動フォールバック(2.2)"],
    ["タブのメモリ超過によるクラッシュ(特にモバイル)", "中", "高", "表4の施策群、N_CTX段階フォールバック、大型モデルの事前警告"],
    ["2GB超の単一GGUFをインポートしようとして失敗", "高", "中", "読込前チェックでsplit GGUFを案内、複数ファイル選択UI"],
    ["インポート元URLがCORSを許可せず取得不能", "中", "中", "エラーを明確化しローカルファイル経由を案内"],
    ["COEP設定により将来追加する外部リソースがブロック", "低", "低", "追加リソースはCORS/CORP要件を確認してから導入"],
    ["wllamaのバージョンアップによるAPI変更", "中", "中", "バージョン固定、エンジン層へAPI呼び出しを隔離し影響範囲を局所化"],
    ["Safari(compatビルド)での性能低下", "低", "中", "性能劣化は仕様として受容し、対応バックエンドをUIに表示"],
  ],
  [34, 10, 10, 46]
));

// 7. 付録
bodyChildren.push(H1("7. 付録: 参照情報と用語補足"));
bodyChildren.push(H2("7.1 参照情報"));
bodyChildren.push(B("本計画で確認した事実の主な出典は以下のとおりである(いずれも2026年11月15日時点で確認)。"));
bodyChildren.push(B([{ t: "(1) ngxson/wllama(GitHub公式リポジトリ): ", b: true }, "v3.1以降のWebGPU対応(n_gpu_layers)、COOP/COEP要件、単一ファイル2GB制限とsplit GGUF対応、OpenAI互換API、Firefox用compatモード。最新版はv3.13.0(2026年11月8日)。"]));
bodyChildren.push(B([{ t: "(2) Llamas on the Web(Reese Levine, 2026年5月): ", b: true }, "llama.cppのggml WebGPUバックエンドのブラウザ対応、JSPI/memory64非対応環境でのcompatビルドフォールバック、WebGPU優先の性能評価、メモリ制約の注意点。"]));
bodyChildren.push(H2("7.2 用語補足"));
bodyChildren.push(B([{ t: "JSPI: ", b: true }, "JavaScript Promise Integration。WASMとJavaScriptの同期/非同期呼び出しを橋渡しする仕様で、wllamaの最適ビルドが利用する。"]));
bodyChildren.push(B([{ t: "memory64: ", b: true }, "WebAssemblyメモリの64ビットアドレス空間。wasm32の実用上限(約4GB、単一バッファ2GB)を回避できる環境がある。"]));
bodyChildren.push(B([{ t: "COOP/COEP: ", b: true }, "Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy。crossOriginIsolated状態を作り、SharedArrayBufferとマルチスレッドWASMを有効化するHTTPヘッダ。"]));
bodyChildren.push(B([{ t: "split GGUF: ", b: true }, "大容量GGUFを複数シャードへ分割した形式。llama-gguf-splitツールで作成され、単一ArrayBufferの2GB制限を回避できる。"]));
bodyChildren.push(B([{ t: "N_CTX: ", b: true }, "コンテキスト長(トークン数)。KVキャッシュのメモリ消費に直結し、大きいほど長い会話を保持できるがメモリを圧迫する。"]));

// ───────────────────────── Assemble document ─────────────────────────
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

function pageFooter(marker) {
  const runs = [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT })];
  if (marker) runs.push(new TextRun({ text: "\u200B", size: 18, font: FONT }));
  return new Footer({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: runs })],
  });
}
const docHeader = new Header({
  children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB", space: 2 } },
    children: [new TextRun({ text: "ブラウザ内LLMチャット開発計画書", size: 18, color: "808080", font: FONT })],
  })],
});

const doc = new Document({
  creator: "Development Planning",
  title: "ブラウザ内LLMチャット開発計画書",
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22, color: PAL.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT, size: 30, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT, size: 26, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    // Section 1: Cover — margin 0, no footer
    {
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR4({
        title: "ブラウザ内LLMチャット開発計画書",
        subtitle: "Wllama × WebGPU による静的ホスティング型チャットUI",
        englishLabel: "DEVELOPMENT PLAN",
        metaLines: [
          "技術スタック: React + Vite + TypeScript",
          "推論エンジン: Wllama v3.x(llama.cpp WebAssembly / WebGPU)",
          "配信環境: Cloudflare Pages(静的ホスティング)",
          "作成日: 2026年11月15日",
        ],
        footerLeft: "Wllama Browser Chat",
        footerRight: "v1.0 / 2026-11",
        palette: PAL,
      }),
    },
    // Section 2: TOC — Roman numerals
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageFooter(true) },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "目  次", bold: true, size: 32, color: PAL.primary, font: FONT })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "注: 本目次はフィールドコードで生成されています。編集後にページ番号を更新するには、目次を右クリックして「フィールドの更新」を選択してください。",
            italics: true, size: 18, color: "888888", font: FONT,
          })],
        }),
        // 注: 本文は別セクション(NEXT_PAGE)のため、ここにPageBreakを追加すると二重改頁になる
      ],
    },
    // Section 3: Body — Arabic numerals, start 1
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader },
      footers: { default: pageFooter(false) },
      children: bodyChildren,
    },
  ],
});

const OUT = "/home/z/my-project/download/ブラウザ内LLMチャット開発計画書.docx";
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("OK:", OUT, buf.length, "bytes");
});
