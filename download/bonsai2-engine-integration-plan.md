# Ternary Bonsai 2 エンジン（PrismML Talk / kernels.ts）統合計画

作成日: 2026-11-18
対象プロジェクト: Wllama ベースのブラウザ内 LLM チャットアプリ（Next.js + TypeScript + zustand）

---

## 1. 結論

**統合は可能。** 実装に進めて良いと判断する根拠:

| 観点 | 評価 |
|---|---|
| ライセンス | Apache-2.0（LICENSE / NOTICE を同梱すれば利用可） |
| 依存関係 | **ゼロ**。kernels.ts（約 3.1 MB / 57,292 行）が GGUF リーダー、トークナイザー、チャットテンプレート、WGSL カーネル、生成ループまで全部入りで自己完結。import 文が 1 つもない |
| 公開 API | `Bonsai.load(opts)` → `bonsai.chat(messages, opts)`（AsyncGenerator でストリーミング）→ `dispose()`。wllama と同じ「load / generate / abort」の形なので抽象化しやすい |
| 中断 | `AbortSignal` をネイティブサポート（ロード・生成の両方） |
| 進捗報告 | `onProgress`（gpu / header / tokenizer / weights / compile / ready の段階付き）と `onDiagnostic`（GPU エラー等）をコールバックで受け取れる。既存の debugLogStore に直結できる |

---

## 2. 最初に認識を合わせるべき重要事実

**kernels.ts が動かせるのは「Ternary Bonsai 2」シリーズだけ。**
ロード時に `general.architecture === "qwen35"` かどうかを検証し、それ以外は拒否する。

| モデル | kernels.ts での動作 |
|---|---|
| Ternary-Bonsai-2-**2B / 4B / 9B** | **動く**（本計画の対象） |
| Ternary-Bonsai-2-27B（+ MTP / DFlash で高速化） | 動くがブラウザ用途では重い（オプション扱い） |
| Bonsai-8B (Q1_0) | **動かない**（PrismML llama.cpp フォーク専用。以前 WebGPU でクラッシュしたもの） |
| Ternary-Bonsai-8B（旧シリーズ） | **動かない**（wllama でも不可、こちらもフォーク専用） |

つまり「エンジンを切り替えれば Bonsai 系が全部動く」ではなく、**「Bonsai 2 専用の第 2 エンジンを wllama の隣に追加し、モデルのアーキテクチャで自動振り分けする」**が正しい設計になる。

---

## 3. 全体アーキテクチャ

```
                         ┌──────────────────────────┐
モデル選択 / ロード要求 ──→ GGUF ヘッダー事前読み取り   │
                         │  general.architecture?    │
                         └──────┬───────────────────┘
                    "qwen35"    │    それ以外
                     ┌──────────┴──────────┐
                     ▼                     ▼
              BonsaiEngine             WllamaEngine（既存）
              (kernels.ts)             n_ctx 階梯フォールバック M-1〜M-7
                     │                     │
                     └──────────┬──────────┘
                                ▼
                  ChatEngine 共通インターフェース
                  load / generate / abort / dispose / info
                                ▼
                  chatStore（既存のストリーム処理はそのまま）
```

### ChatEngine インターフェース（新設）

```ts
interface ChatEngine {
  load(model: ModelInput, opts: LoadOptions): Promise<EngineInfo>;
  generate(messages: ApiMessage[], opts: GenerateOpts): AsyncGenerator<TokenEvent | DoneEvent>;
  abort(): void;
  dispose(): void;
  info(): { backend: string; nCtx: number; tokensPerSec?: number };
}
```

- `WllamaEngine` が既存ロジックの薄いラッパー、`BonsaiEngine` が kernels.ts の実装
- `chatStore` は interface のみを知る。token 計数は両エンジンとも実測値（Bonsai は `GenerateStats` が prompt/completion tok を返す）を返す

### 振り分け条件

- GGUF ヘッダーの `general.architecture` が `"qwen35"` → BonsaiEngine（WebGPU が使える場合のみ）
- それ以外 → WllamaEngine（既存のバックエンド階梯: WebGPU → compat → wasm CPU）
- WebGPU 非対応ブラウザで qwen35 モデルが選ばれた場合はロード前に不可メッセージ（Bonsai 2 に CPU 実装は存在しないため wllama へのフォールバック不可）

---

## 4. フェーズ別計画

### Phase 0: 検証 PoC（最初に必須。最大の不確定要素の潰し込み）
- `kernels.ts` を `src/lib/bonsai/` に配置し、実験ページ or 既存画面から直接 `Bonsai.load` で Ternary-Bonsai-2-4B をロード → 生成 → 中断 → dispose を確認
- **iPad Safari での WebGPU 動作を実測する**（Talk 自体は Bonsai 2 専用に書かれた WGSL カーネルで、llama.cpp の webgpu バックエンドとは別物だが、Apple GPU での実績は未確認。ここが通らなければ本計画は保留）
- 完了条件: iPad で 10 トークン以上の生成が 2 回連続で成功する

### Phase 1: 組み込み
- `src/lib/bonsai/kernels.ts` として配置、**動的 import** で読み込み（3.1 MB のため初期バンドルに含めない。ビルド時間も遅延 import で回避）
- tsconfig で型チェックの範囲を調整（57k 行の常時型チェックは dev 体験に響くため、`src/lib/bonsai/` を exclude し `any` で受けるか、必要最小限だけ型を絞って受ける）
- `appConfig.ts` の `APP_CONFIG` に Bonsai 2 モデルを追加（2B / 4B / 9B の URL、ラベル、期待メモリ）
- 完了条件: モデルリストから Bonsai 2-4B が選択・ロードできる

### Phase 2: エンジン抽象化
- `ChatEngine` インターフェース新設、既存 wllama ロジックを `WllamaEngine` に抽出（挙動は変えない）
- `BonsaiEngine` 実装:
  - `Bonsai.chat()` の `GenerateEvent`（`{type:"token", phase:"think"|"answer", text}` / `{type:"done", stats}`）を既存ストリーム処理へ変換
  - `<think>` フェーズは既存 UI の推論表示に接続（thinkingBudget は Bonsai 側に内蔵されているのでそのまま活用）
  - abort → `AbortSignal`、エンジン切替・アンロード → `dispose()`
- 完了条件: Bonsai 2 でチャット削除 / 編集 / 再生成 / 中断が全て動く

### Phase 3: UI・ログ統合
- ロード進捗: `LoadProgress` の段階（header / tokenizer / weights / compile / ready）を既存のロード表示に接続（weights の downloaded/total bytes も表示）
- `onDiagnostic`（未捕捉 GPU エラー、デバイスロス、シェーダービルド失敗）を debugLogStore へ全量記録
- `cache: true`（IndexedDB に 16 MiB チャンクでウェイトをキャッシュ、次回ロードはダウンロード不要）を有効化し、キャッシュ状況を UI に表示 — 「モデル不永続化」方針の代替として、キャッシュ ON/OFF を設定に出す
- 完了条件: ログ GUI に Bonsai エンジンの warn/error が流れ、リロードなしで連続チャットが回る

### Phase 4: 仕上げ検証
- iPad Safari / Chrome、PC Chrome での実測（トークン速度、長時間生成、メモリ）
- 生成ガード（logit guard が作動した場合の「再ロードが必要」UI メッセージ）の確認
- NOTICE / LICENSE の同梱、README へのクレジット追記
- 完了条件: 全機能が両エンジンで等しく動く

---

## 5. 技術的注意点

1. **モデル制限の明示**: Bonsai 2 のみ対応であることをモデルリストのラベルに書く（「Ternary Bonsai 2 専用エンジン」）。Bonsai-8B (Q1_0) を選んでも動かない、という混乱を防ぐ
2. **WebGPU のみ**: Bonsai 2 に CPU フォールバックはない。振り分けはロード前に決める
3. **KV キャッシュ**: エンジン内蔵のカーネル階梯（native → f16 → upstream lut2）が既知解チェック付きで自動フォールバックする設計なので、こちらから指定するのは `contextLength` の上限程度で良い。`info.contextReduced` を拾ってログに出す
4. **トークン計数**: `GenerateStats`（prompt / completion tok、実測速度）をそのまま StatusBar に渡す。既存の「推定 prompt tok」は BonsaiEngine では実測に置き換わる
5. **同時存在の不可**: wllama と Bonsai の GPU リソースは排他にする（片方 load 中 / 生成中はもう片方を操作させない。`#generating` フラグと engineStore の状態で制御）

---

## 6. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| iPad Safari でカーネルが動かない | 計画全体が保留 | Phase 0 で最初に実測。Talk 側に弱いデバイスをエミュレートするオプション（`disabledFeatures` / `requiredLimits`）があり、事前の適合性調査にも使える |
| ビルド / dev の型チェックが 3.1 MB 分重い | 開発体験低下 | 動的 import + tsconfig exclude |
| モデルの混同（Bonsai-8B は動かない） | ユーザー混乱 | ラベル明示 + ヘッダー事前検証でロード前に不可を表示 |
| エンジン 2 本化による不具合の切り分けが難しい | 保守コスト | 全ログに source（wllama / bonsai）タグを付け、debugLogStore のフィルタに追加 |

---

## 7. 作業量の目安

| フェーズ | 目安 |
|---|---|
| Phase 0 検証 PoC | 半日〜1日 |
| Phase 1 組み込み | 1日 |
| Phase 2 エンジン抽象化 | 1〜2日 |
| Phase 3 UI・ログ統合 | 1日 |
| Phase 4 検証 | 半日 |

合計: 4〜5日程度（Phase 0 の結果次第で先行度が変わる）

---

## 8. 参考リンク

- エンジン: https://github.com/PrismML-Eng/Talk （kernels.ts 単一ファイル）
- モデル: https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf （同系列に 2B / 4B / 9B）
- ライセンス: Apache-2.0（LICENSE と NOTICE の同梱が必要）
