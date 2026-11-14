# 栞 — ブラウザー読書室

EPUB と画像 ZIP をブラウザー内だけで読む、日本語向けの小さな e-reader です。本のデータはアップロードせず、サーバーや localStorage に保存しません。

## 開発

- Bun をパッケージ管理・スクリプト実行に使用します。`bun install`
- Void 1.9.1 が要求する Node.js（`^24.22.0 || >=26.12.0`）に合わせ、24.22.0 を `node` パッケージでプロジェクト内に用意します。Cloudflare workerd は Bun で代用できません。
- `bun run dev --host 0.0.0.0`（開発サーバー）
- `bun run typecheck`, `bun run lint`, `bun test`
- ブラウザテスト初回: `bunx playwright install chromium`、実行: `bun run test:e2e`
- `bun run build`、本番ビルドのローカル確認: `bun run preview`（既定 `http://localhost:4173`）
- デプロイする場合: `bunx void deploy --platform cloudflare`（このリポジトリからは実行していません。Cloudflare アカウント設定が別途必要です。）

スマホから開く場合は同じネットワークの PC の IP アドレスと開発サーバーのポートを指定します。OS のファイアウォールや WSL の設定によってはポート転送が必要です。

## 操作

左右端をクリック/タップしてページ移動。左から右へ読む LTR は右端が次、右から左へ読む RTL は左端が次です。←/→ は空間方向、PageDown / Space は次、PageUp / Shift+Space は前。スワイプは LTR では左へ、RTL では右へ動かすと次のページです。目次は EPUB のみです。ZIP は常に LTR・一枚表示です。

## 制限

ブラウザーの対応範囲で EPUB の CSS、縦書き、ルビ、画像を表示します。DRM は非対応で、出版社ごとの特殊 CSS を完全再現する保証はありません。書棚、アカウント、同期、アップロードはありません。ZIP は画像形式のみ（SVG 非対応）、項目数 5,000・展開総量 1GB・各画像 100MB までです。

Void は公式 npm `void@1.9.1` と公式 `voidPlugin()` を利用。EPUB 描画は MIT の foliate-js を GitHub commit `78914ae` に固定、ZIP は `@zip.js/zip.js` 2.25.0 を使用します。実サンプルの動作確認はユーザーの端末内で行い、本や本文をリポジトリに含めず、OPF の方向・CSS の縦書き指定・ルビ・画像表示と ZIP の自然順を確認してください。
