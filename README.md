# 栞 — ブラウザー読書室

EPUB と画像 ZIP を読む、日本語向けの小さな e-reader です。端末で選んだ本はブラウザー内で処理し、アップロードしません。クラウド書庫の本は Cloudflare Access で保護された API 経由で非公開 R2 から読み込みます。

## 開発

必要な環境: Bun 1.4.4、Node.js 26.13.1。

```bash
bun install --frozen-lockfile
cp env.example .env
bunx --no-install void prepare
bun run dev
```

主な確認コマンド:

```bash
bun run typecheck
bun run lint
bun run format:check
bun test
bun run test:r2
bun run build
```

`tests/e2e` は E2E とその helper 専用です。それ以外のテストは `src` 内で対応するコードの隣に置きます。server の高速な Bun テストは認証ルールと書庫 API の契約を検証し、`bun run test` で実行します。`bun run test:r2` は Node.js 上の Miniflare のローカルR2で、一覧・ダウンロードの接続を確認します。テストファイルは `.test.ts` 命名を使います。デプロイ処理とそのテストも `src/deploy` にあります。

ブラウザーテストは Chromium を初回インストールしてから実行します。

```bash
bunx --bun --no-install playwright install chromium
bun run test:e2e
```

本番ビルドのローカル確認は `bun run preview`（`http://localhost:4173`）です。

## Mutation testing

reader のユニットテストと、認証・書庫 API の server ユニットテストが、実際のコード変更を検出できるかを StrykerJS で確認します。対象は `src/lib/reader/layout.ts`、`progress.ts`、`preferences.ts`、`zip-entries.ts` と `src/server/access.ts`、`library.ts` です。

```bash
bun run test:mutation
# 1 モジュールに絞る例
bun run test:mutation --mutate src/lib/reader/layout.ts
# server の認証・書庫 API だけを対象にする例
bun run test:mutation --mutate 'src/server/access.ts,src/server/library.ts'
```

各 mutant ごとに command runner が Bun で reader と server のユニットテスト一式を実行します（テスト単位の coverage 分析ではありません）。認証・書庫 API の契約テストは Bun、ローカルR2を使う接続テストは `bun run test:r2` で別々に実行します。Mutation testing は R2 接続テストや E2E を実行せず、通常の test や CI に自動実行を追加していません。HTML レポートは `reports/mutation/mutation.html`、JSON レポートは `reports/mutation/mutation.json` に出力されます。

`Survived` は、挙動を検証するテストが不足していないか、または等価 mutant ではないかを調査する手掛かりです。Mutation score だけでテスト品質は保証されず、100% を必須にはしません。

## 読む・設定する

- 「ファイルを選ぶ」から EPUB または画像 ZIP を開きます。
- 画面左右のクリック／タップ、スワイプ、← / →、PageDown / Space、PageUp / Shift+Space でページを移動します。
- 1秒無操作でフッター、2秒無操作でヘッダーを隠します。ページ移動時は待たずに両方を隠し、マウス移動・タップ・キー操作で再表示します。
- 歯車から文字サイズ、行間、余白、表示方法などを変更できます。設定はこのブラウザーに保存されます。
- 本のデータや読書位置はブラウザーに保存しません。再読み込み後は本を選び直してください。

## 非公開クラウド書庫

クラウド書庫は所有者限定で運用します。Cloudflare Access のポリシーと Worker の `ACCESS_ALLOWED_EMAIL` を同じ所有者に限定し、R2 を非公開にしてください。`workers.dev` や `r2.dev` の公開、Access の無効化はしないでください。

`ACCESS_ALLOWED_EMAIL` は Cloudflare Worker Secret として登録し、デプロイ前に設定します。ソースや GitHub Actions secrets には登録しません。ローカルの設定は `.env` に置き、コミットしないでください。

## デプロイ

`main` の CI が成功すると本番へ自動デプロイされます。プルリクエストや他ブランチからはデプロイしません。CI は GitHub の `production` Environment に次の Actions secrets を必要とします。

- `CLOUDFLARE_API_TOKEN` — Worker デプロイ用。
- `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` — `/__void/ready` 専用の readiness 認証用。書庫 API の認証には使いません。

## 制限と取り扱い

DRM には対応していません。EPUB の表示はブラウザーの対応範囲に依存し、出版社ごとの特殊な CSS を完全に再現する保証はありません。書庫画面からの本のアップロード・削除には対応していません。

実際の本や `library.json`、`.env`、トークン、実際の許可メールアドレスはコミットしないでください。
