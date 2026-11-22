# 栞 — ブラウザー読書室

EPUB と画像 ZIP を読む、日本語向けの小さな e-reader です。端末で選んだ本はブラウザー内で処理し、アップロードしません。クラウド書庫の本は Cloudflare Access で保護された API 経由で非公開 R2 から読み込みます。

## 開発

必要な環境: [Vite+ CLI](https://viteplus.dev/guide/)（`vp`）と Node.js 26.13.1（`.node-version`）。`vp install` は `packageManager` で指定した pnpm 10.26.1 と `pnpm-lock.yaml` を使います。

```bash
vp install --frozen-lockfile
cp env.example .env
vp exec void prepare
vp dev
```

主な確認コマンド:

```bash
vp check
vp exec tsc --noEmit
vp test --config vitest.config.ts
vp run test:r2
vp run test:d1
vp build
```

`vp check` は整形（`vp fmt`）、lint（`vp lint`、型情報つき）、型チェックをまとめて実行します。設定は `vite.config.ts` の `lint` と `fmt` にあります。`vp exec tsc --noEmit` は型チェックの並行確認です。

`e2e/` は E2E とその helper 専用です。それ以外のテストは `src` 内で対応するコードの隣に置きます。テストファイルは `.test.ts` 命名を使い、server の認証・書庫 API の契約テストも Vitest で実行します。デプロイ処理とそのテストも `src/deploy` にあります。読書位置用のローカル D1 は `vp exec void db migrate` で準備します。

テストの実行先は次のとおりです。

- `vp test --config vitest.config.ts`: `src` 配下の単体テスト（reader、server、deploy）を Vitest（Node.js 上、`vitest.config.ts`）で実行します。CI の単体テストもこのコマンドです。
- `vp run test:r2` と `vp run test:d1`: Node.js 上の Miniflare を使うローカル R2/D1 の接続テスト。`vp test` には含まれず、CI では別ステップで実行します。
- `vp run test:e2e` と `vp run test:pwa`: Playwright による E2E。テストの内容に変更はありません。

ブラウザーテストは Chromium を初回インストールしてから実行します。

```bash
vp exec playwright install chromium
vp run test:e2e
```

本番ビルドのローカル確認は `vp preview`（`http://localhost:4173`）です。

## PWA

対応ブラウザーでは、ブラウザーのインストール機能または「ホーム画面に追加」から利用できます（利用方法はブラウザーにより異なります）。本アプリはオンラインでの起動が必要です。Service Worker は登録されますが、オフライン起動や API・本のバイト列のキャッシュは行いません。本のデータは引き続き IndexedDB に保存されず、読書位置のみが保存されます。開発中は Service Worker を登録せず、更新を強制する仕組みもありません。Cloudflare Access の保護は変更しません。

本番ビルド後に Chromium の PWA smoke test を実行します:

```bash
vp build && vp run test:pwa
```

## Mutation testing

Mutation testing は任意の診断で、通常のテストや CI の必須条件ではありません。対象を絞って使います。

### reader と server: @mizchi/mutator（Vitest）

`src/lib/reader` の 4 モジュール（`layout.ts`、`progress.ts`、`preferences.ts`、`zip-entries.ts`）と、`src/server` の `access.ts`、`library.ts` を `@mizchi/mutator` 0.4.0 と Vitest（`vite-plus` の同梱版）で診断します。設定は `mutator.config.json`、`vitest.config.ts` にあります。ツールは dev 依存としてインストール済みで、実行時に `npx` で取得しません。

```bash
vp run test:mutator --include src/server/library.ts
# 結果を agent 向け JSON に保存する例
mkdir -p .mutator
vp exec mutator --include src/server/library.ts --reporter agent > .mutator/library.json
```

- 引数なしでは `mutator.config.json` の 6 モジュールが対象です。`--include` で、Vitest が同じプロセス内で実行する実装ファイルに対象を絞れます。`src/deploy` の子プロセス内の処理は対象にしません。
- `CompileError`（TypeScript が拒否した mutant）は実行時のテスト不足とは別に分類し、その数を記録します。
- 既定では生存 mutant を表示します。スコアによる失敗判定や自動 `accept` は使いません。`accept` で未分類の生存 mutant を許容しないでください。
- キャッシュと保存したレポートは `.mutator/` 以下に置き、コミットしません。外部 CDN を読み込まないよう、ローカルではテキストまたは JSON レポートを使います。
- Git の checkout で `--since <ref>` を使うと、その ref からの差分だけを対象にできます。テストだけの差分は `--include-test-changes` を併用します。未追跡の新規テストを確認するときは、対応する実装ファイルを `--include` で指定します。Git 履歴が見えない非 colocated の jj workspace では `--since` を使わないでください。

`Survived` は、挙動を検証するテストが不足していないか、または等価 mutant ではないかを調査する手掛かりです。Mutation score だけでテスト品質は保証されず、100% を必須にはしません。

### Playwright による E2E mutation（実験的・任意）

`@mizchi/mutator` 0.4.0 と `@mizchi/mutator-playwright` 0.4.0 で、ブラウザーの本棚コード（`src/lib/library/bookshelf.ts`）を Playwright の E2E から診断できます。これは実験的な任意の診断で、遅い（mutant ごとに Playwright のブラウザーテストを起動します）ため、CI の必須条件には含めません。

```bash
vp run test:mutator:e2e
```

- 設定は `mutator.playwright.config.json` と `playwright.mutation.config.ts` にあります。`playwright.mutation.config.ts` は通常の E2E 設定を継承し、`e2e/bookshelf.e2e.ts` だけを、専用の開発サーバー（`127.0.0.1:5187`、`reuseExistingServer: false`）で実行します。
- 対象は本棚の 1 ファイル、`concurrency: 2`、行ごとに 1 mutant、時間予算 120 秒です。予算を超えた mutant は `Pending` のままになるため、結果は対象と予算の範囲でだけ読んでください。
- 結果の `Pending`、`NoCoverage` は検出ではありません。`Killed` が実際のブラウザーテストで検出された mutant で、ブラウザーで実行されたことを確認するには `Killed` の件数と coverage を見てください。
- 本と表紙は Playwright のフィクスチャを使います。開発サーバーがローカル設定を読み込むため、診断を隔離する場合は `.env`・書籍データ・本番資格情報のない作業コピーで実行してください。
- 結果は `.mutator/` 以下に保存され、コミットしません。
- 実行時間は mutant 数とマシンに依存し、数分から数十分かかることがあります。
- 公式の使い方は `@mizchi/mutator-playwright` 同梱の skill（`node_modules/@mizchi/mutator-playwright/skills/mutator-playwright/SKILL.md`）を参照してください。

### エージェントが生成・変更したテストの確認

1. `vp check`、`vp exec tsc --noEmit`、`vp test --config vitest.config.ts` で通常の検証を行います。
2. 意味のある変更がある場合、対象モジュールに絞って `test:mutator --include` で診断します。結果は対象範囲と証拠（検出・生存の数）とともに記録し、限界も残します。
3. 追加したテストの検出力を評価するときは、同じソースと同じ mutant の集合で、追加前後の検出結果を比べます。
4. 生存 mutant は、挙動の変化、等価 mutant、対象範囲外のいずれかを調べて分類します。分類できないものは未確認として残し、等価とみなさないでください。
5. 指標のためだけのテストや、カバレッジ上げのための skip・削除は行いません。

公式の `mutator` と `mutation-test-loop` は `.agents/skills/` に原本のまま配置しています。上流の `npx mutator` や CI の設定例ではなく、上記のローカルコマンドを使ってください。依存が未導入なら `vp install --frozen-lockfile` で準備します。

## 読む・設定する

- 「ファイルを選ぶ」から EPUB または画像 ZIP を開きます。
- 画面左右のクリック／タップ、スワイプ、← / →、PageDown / Space、PageUp / Shift+Space でページを移動します。
- 1秒無操作でフッター、2秒無操作でヘッダーを隠します。ページ移動時は待たずに両方を隠し、マウス移動・タップ・キー操作で再表示します。
- 歯車から文字サイズ、行間、余白、表示方法などを変更できます。設定はこのブラウザーに保存されます。
- EPUB の読書位置だけを IndexedDB に保存します。本のデータは保存しないため、再読み込み後は同じファイルを選び直してください。
- 認証済みの場合、読書位置を D1 と同期します。同期はオンライン復帰時などに再試行し、競合時は端末または別端末の位置を選べます。認証が必要な場合はログイン後に同期します。
- EPUB 本文や ZIP はアップロードせず、Service Worker によるファイルキャッシュも行いません。

## 非公開クラウド書庫

クラウド書庫は所有者限定で運用します。Cloudflare Access のポリシーと Worker の `ACCESS_ALLOWED_EMAIL` を同じ所有者に限定し、R2 を非公開にしてください。`workers.dev` や `r2.dev` の公開、Access の無効化はしないでください。

`ACCESS_ALLOWED_EMAIL` は Cloudflare Worker Secret として登録し、デプロイ前に設定します。ソースや GitHub Actions secrets には登録しません。ローカルの設定は `.env` に置き、コミットしないでください。

## デプロイ

`main` の CI が成功すると本番へ自動デプロイされます。プルリクエストや他ブランチからはデプロイしません。CI はコミット済みの D1 マイグレーションをローカルで検証します。本番では `void deploy` が Worker の公開前に未適用の D1 マイグレーションを適用し、失敗時は公開を中止します。CI は GitHub の `production` Environment に次の Actions secrets を必要とします。

- `CLOUDFLARE_API_TOKEN` — Worker デプロイと D1 の作成・編集・マイグレーションに必要な権限を持つ API トークン。
- `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` — `/__void/ready` 専用の readiness 認証用。書庫 API の認証には使いません。

## 制限と取り扱い

DRM には対応していません。EPUB の表示はブラウザーの対応範囲に依存し、出版社ごとの特殊な CSS を完全に再現する保証はありません。書庫画面からの本のアップロード・削除には対応していません。

実際の本や `library.json`、`.env`、トークン、実際の許可メールアドレスはコミットしないでください。

## 本棚（Bookshelf）

`/bookshelf` では最近追加した本とシリーズ別の棚を表示し、タイトル・ファイル名・シリーズを自由入力で検索し、形式で絞り込み、並べ替えができます。任意の `series` と `uploadedAt` は既存の R2 `library.json` にアップロード担当者が設定します。書庫 API は `uploadedAt` を UTC の `Z` 形式（`YYYY-MM-DDTHH:mm:ssZ`、または秒の小数1〜3桁）で受け付けます。アップロード UI やメタデータの書き戻し機能は追加していません。

```json
{
	"books": [
		{
			"id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			"name": "sample.epub",
			"format": "epub",
			"size": 12345,
			"series": "星の旅",
			"uploadedAt": "2025-03-04T05:06:07Z",
			"hasCover": true
		}
	]
}
```

`series` のない本は未設定の棚に入り、`uploadedAt` のない本は最近追加した本の欄から除外されます（全件を新しい順に並べる場合は末尾）。既存の4項目だけのレコードも引き続き利用できます。

`library.json` は最大5,000冊、かつ1 MiBまでです。上限を超えた索引は書庫 API 全体で拒否されます。

### 表紙サムネイル（手動）

表紙は任意です。`hasCover` のない本、または `false` の本は従来どおり色付きの仮の表紙を表示し、表紙の取得は行いません。表紙を付けるには次の順で手作業で準備します。

1. EPUB の表紙、または ZIP の先頭画像を用意し、幅 480px 程度に縮小して WebP にします（最大 512 KiB、1 バイト以上）。
2. 非公開の R2 バケット（`BOOKS`）に `covers/<id>.webp` として置きます。`<id>` は本の `id`（64桁の小文字16進数）です。
3. 置いた後で、同じ本の `library.json` のエントリに `"hasCover": true` を追加します。

表紙は `GET /api/books/<id>/cover` で同一オリジンから配信され、本の EPUB や ZIP は表紙の取得時に読みません。Cloudflare Access で保護され、`Cache-Control: private, no-store` で返します。既存の本は表紙を後から追加しても、追加しなくても構いません。表紙ファイルが壊れていても画面には仮の表紙を表示します。
