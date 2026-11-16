# 栞 — ブラウザー読書室

EPUB と画像 ZIP を読む、日本語向けの小さな e-reader です。端末で選んだファイルはブラウザー内で処理し、アップロードしません。クラウドの本は Cloudflare Access で保護されたAPIから非公開R2へアクセスして読み込みます。

## 開発

- Bun 1.4.4 をパッケージ管理、ユニットテスト、型検査・lint・format・Playwright runnerに使用します。`bun install`
- Cloudflare/Vite の開発・build・preview、Void CLI、実R2サーバー統合テストは Node.js 26.13.1 で実行します。Void 1.9.1 のNode 26系の要件（26.12以上）を満たす版を `node` パッケージで固定し、CIも同じ版です。
- ソース内の参照は `#components/...`・`#lib/...` など、`src` 基準の import に統一します。実行時は `package.json` の `imports`、拡張子なしの型解決は `tsconfig.json` の `paths` で同じ `#*` → `./src/*` を設定しています。Nodeで直接実行する参照は `.ts` を付け、自動生成ファイルとブラウザー内評価の `/src/...` URLは変更しません。
- Oxfmtはimportと`package.json`（scriptsを含む）をソートし、コードのインデントには幅2のタブを使います。YAMLはスペースを使い、`bun.lock`と生成済み`src/routeTree.gen.ts`は整形対象外です。副作用import同士の相対順は保持しますが、通常のimportはその前後に移動し得るため、初期化順への依存は差分で確認します。
- Workers の実行環境は Cloudflare workerd です。Bun 1.4.4 の組み込みundiciはCloudflare開発サーバーとMiniflareのホスト側R2ストリーム処理に必要な互換性を満たさないため、これらのホスト処理にはNodeを使用します。
- `bun run dev --host 0.0.0.0`（開発サーバー）
- `bun run typecheck`、`bun run lint`（Oxlint + oxlint-tsgolint の型対応ルール）、`bun run format`（Oxfmtで整形）、`bun run format:check`（整形の確認）、`bun run test`
- サーバー統合テスト: `bun run test:server`。実際のMiniflare R2と署名付きJWTを使用します。Miniflare 5のR2ストリーム処理はBunではなく、プロジェクトのNode.jsで検証します。
- ブラウザテスト初回: `bunx --bun --no-install playwright install chromium`、実行: `bun run test:e2e`。Playwright runner/workers は Bun、Playwright が起動する Vite webServer はNode 26.13.1です。包括的なデスクトップ Chromium、端末差が影響するモバイル経路、native実ウィンドウの複数スケールで検証します。重要な回帰・セキュリティ経路は維持し、同一の合成イベント設定や端末依存性の低い重複コンテキスト実行を減らしています。
- `bun run build`、本番ビルドのローカル確認: `bun run preview`（既定 `http://localhost:4173`）
- デプロイ: `bunx --no-install void deploy --platform cloudflare`。Void CLIはプロジェクト内のNodeで起動します。保護済みドメインへの再デプロイは、`/__void/ready` 専用Accessアプリでの認証が必要です。Void CLIがreadinessを確認します。

スマホから開く場合は同じネットワークの PC の IP アドレスと開発サーバーのポートを指定します。OS のファイアウォールや WSL の設定によってはポート転送が必要です。

## 静的解析ポリシー

Oxlint は TypeScript の型安全性に加えて React Hooks / Compiler correctness と JSX accessibility を error として検査します。`any` と unsafe な型の利用は許可せず、外部データは `unknown` として検証してから扱います。これらの検査は誤りを減らす補助であり、すべての不具合やアクセシビリティ上の問題を検出する保証ではありません。

例外は、意図した制御文字除去・拒否の正規表現、ブラウザー設定の hydration、native dialog の backdrop dismissal のように、個別の理由を隣接コメントで説明できる場合に限ります。テストでは、元のメソッドの復元や receiver を保持した呼び出しのための unbound-method 参照を限定的に許容します。例外は対象箇所だけに限定し、型安全性・React correctness のルール全体を無効化しません。

## 操作

左右端をクリック/タップしてページ移動。左から右へ読む LTR は右端が次、右から左へ読む RTL は左端が次です。←/→ は空間方向、PageDown / Space は次、PageUp / Shift+Space は前。スワイプは LTR では左へ、RTL では右へ動かすと次のページです。目次は EPUB のみで、ZIP は常に LTR です。読書画面の操作はアイコンにまとめています。

EPUB は現在のページが指に追従し、短いスワイプや中断時には元の位置へ戻ります。OS の「視差効果を減らす」設定が有効な場合は動きを抑えます。

### 表示と設定

- 表示は「自動／1ページ／見開き」。自動では、余白を除いた表示幅が 720 CSS px 以上なら見開きになります。回転や画面幅の変更にも追従します。
- 見開きは連続する2ページを表示し、移動も見開き単位です。EPUB の RTL は右から、LTR と ZIP は左から読みます。
- 画像は縦横比を保ち、切り抜かずに表示領域へ収めます。
- 歯車アイコンから `/config` を開き、文字サイズ・行間・上下左右の余白・ページ間隔を調整できます。設定画面への往復では本を開いたまま、読書位置を維持します。
- 書体は「書籍指定／端末の明朝体／端末のゴシック体」。Webフォントの選定・導入は保留しています。
- 設定だけをこのブラウザーの localStorage に保存します。本のデータや読書位置をブラウザーへ永続保存することはありません。ページを再読み込みした場合は、本を選び直してください。

## 非公開クラウド書庫

- ホスト名: `reader.rrrr.dev`。Cloudflare Accessのメール認証で `me@rrrr.dev` のみを許可します。
- R2バケット: `e-reader-books`。`r2.dev` の公開アクセスとR2カスタムドメインは使用しません。
- `GET /api/books` が一覧、`GET /api/books/:id` がファイル取得です。取得時に一度ダウンロードし、既存リーダーで開きます。
- APIはAccess JWTの署名・issuer・audience・期限・許可メールを検証します。メールを示すヘッダーだけでは認証しません。設定不足も拒否します。
- レスポンスは `private, no-store`。ファイルはR2からストリームで返し、`attachment` と `nosniff` を設定します。
- R2の `library.json` に `{ "books": [{ "id": "ファイルのSHA-256（64文字）", "name": "sample.epub", "format": "epub", "size": 1234 }] }` を保存します。実体は `books/<id>.<format>`。manifestにないIDは取得できません。書籍や実際のmanifestはリポジトリへ含めません。
- `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ACCESS_ALLOWED_EMAIL` は `void.config.ts` のWorker変数です。APIトークンやログインJWTをソース・ログへ保存しないでください。
- `workers.dev` とプレビューURLは無効にします。初回は公開ルートのないWorkerをデプロイし、Access設定完了後にカスタムドメインを接続します。

保護済みホストへの再デプロイでは、Void CLIが `/__void/ready` を確認します。手動デプロイでは、readiness専用Accessアプリの許可ユーザーとして通常の対話端末でログインしてください。専用アプリはルートアプリと異なるaudienceを持つため、root URLではなくreadiness URLを指定します。

```bash
cloudflared access login --quiet https://reader.rrrr.dev/__void/ready
CF_ACCESS_TOKEN="$(cloudflared access token --app=https://reader.rrrr.dev/__void/ready)" \
CF_ACCESS_READINESS_ORIGIN="https://reader.rrrr.dev" \
bunx --no-install void deploy --platform cloudflare
```

readiness専用アプリの認証はデプロイ時の準備確認だけに使われます。ルートアプリと `/api/books` は引き続き所有者のみです。CIのサービス認証情報を人に渡さず、手動デプロイは所有者の対話ログインで行います。

Cloudflare管理用のログイン（`bunx --no-install void cloudflare login`）と、アプリのAccessログインは別です。初回や別の環境では `bunx --no-install void connect --platform cloudflare` で管理CLIの接続先も保存してください。LinuxではVoidのブラウザーログインに利用可能なOS keyringが必要です。

初回の公開URLなしデプロイでは、Workerが作成済みでもURLを確認できずCLIが停止する場合があります。接続先を設定したうえで `bunx --no-install void project status` を確認し、Access保護済みの `reader.rrrr.dev` を `bunx --no-install void domain add reader.rrrr.dev` で接続します。現在のルートは `void.config.ts` と `void.lock.json` に保存しています。再デプロイのためにAccessを無効にしないでください。

## GitHub Actions CI/CD

- CIは `main` 向けの pull request、`main` への push、および手動実行で動きます。Node.js 26.13.1 / Bun 1.4.4 を使い、依存関係の凍結インストール、Void型生成、型検査、Oxlint、Oxfmt確認、ユニット・サーバー統合テスト、ChromiumによるPlaywright（デスクトップ／モバイル／native各プロジェクト）、ビルドを検証します。
- `main` へのpush（PRのマージを含む）で、全CI成功後に production Environment を使って本番へ自動デプロイします。Actionsから `main` を選んで `workflow_dispatch` を手動実行することもできます。PRや他ブランチではデプロイしません。Void CLIが `CF_ACCESS_READINESS_ORIGIN` の `/__void/ready` を確認し、失敗時はデプロイを失敗させます。CIは `/api/books` にアクセスしません。
- 本番配信は直列化し、後続のpushで進行中の配信をキャンセルしません。古いPRの検証だけをキャンセルします。
- GitHubリポジトリの Settings → Environments で `production` を作成し、Deployment branches and tags を `main` のみに制限してください。必要なら required reviewers も設定してください。ワークフローからEnvironmentが自動作成されても、保護ルールやsecretsは設定されません。デプロイ前に設定を完了してください。
- `production` Environment に次の3つのActions secretsを登録します。
  - `CLOUDFLARE_API_TOKEN`: VoidからWorkerをデプロイするCloudflare APIトークン。対象アカウントのWorkers Scripts Editと、利用リソースの読み取り権限が必要です。別途明示的にプロビジョニングする製品がある場合に限り、その製品の編集権限を追加してください。不要な広範権限は付与しません。
  - `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET`: `/__void/ready` 専用Cloudflare Accessアプリ用に発行したサービス認証情報。専用サービスTokenの有効期間は必要最小限にし、期限前にローテーションしてください。
- CI用に `reader.rrrr.dev/__void/ready` 専用のCloudflare Accessアプリを設定してください。ホスト名ワイルドカードを使わず、`/__void/ready` に限定します。許可ポリシーには特定のCIサービスTokenだけをService Authで許可し、手動デプロイ用として既存の所有者限定ポリシーも再利用します。BypassやEveryoneは設定しません。ルートアプリと `/api/books` は所有者限定のままにし、サービス認証情報を許可しないでください。未認証readinessもブロックしてください。

  `CLOUDFLARE_API_TOKEN` はCloudflareで別途作成し、同じEnvironmentのsecret設定画面から登録してください。Cloudflare管理APIの認証と、アプリへのAccess認証は別物です。

## 公開リポジトリでの取り扱い

本の実データ、実際の `library.json`、`.env` / `.dev.vars`、秘密鍵はコミットしません。Cloudflare のアカウントID、Access AUD、ドメイン、許可メールアドレスは運用設定として含まれますが、APIトークンや秘密鍵ではありません。ローカルの環境設定と書庫の作業ファイルは `.gitignore` で除外しています。

## 制限

安全のため `srcset` は除去して `src` にフォールバックします。インラインCSSはCSSOMで解析し、`@import` と未対応・不正な構文を除去します。`image-set()` / `-webkit-image-set()` を含むスタイル属性・ブロックは全体を除去します。

ブラウザーの対応範囲で EPUB の CSS、縦書き、ルビ、画像を表示します。DRM は非対応で、出版社ごとの特殊 CSS を完全再現する保証はありません。アプリ内アカウント管理、読書位置の同期、画面からのアップロード・削除は未対応です。ZIP は画像形式のみ（SVG 非対応）、項目数 5,000・展開総量 1GB・各画像 100MB までです。

Void は公式 npm `void@1.9.1` と公式 `voidPlugin()` を利用。EPUB 描画は MIT の foliate-js を GitHub commit `78914ae` に固定、ZIP は `@zip.js/zip.js` 2.25.0 を使用します。実サンプルの動作確認はユーザーの端末内で行い、本や本文をリポジトリに含めず、OPF の方向・CSS の縦書き指定・ルビ・画像表示と ZIP の自然順を確認してください。
