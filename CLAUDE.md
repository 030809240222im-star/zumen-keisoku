# 図面計測ツール — 開発メモ（Claude Code / VS Code 用）

## 概要
PDF・画像の図面上で、距離・連続線・面積・円弧（R切替点ごとの区間計測）を計測し、
吉野石膏の壁仕様にもとづく壁面積集計・ボード割付図（展開図①②③…）を作る単一ページのWebアプリ。
利用者は日本の建設関係者。UIの文言はすべて日本語で、専門用語は現場で使う言い方に合わせる。

## ファイル
- `index.html` … アプリ本体（HTML・CSS・JavaScript をこの1ファイルに収めている）。**ここが正本**。
- `cmaps-ja.json` … 日本語PDFの文字を読むための CMap（base64）。通常は触らない。
- `lib/` … pdf.js 3.11.174（`pdf.min.js`・`pdf.worker.min.js`）、pdf-lib 1.17.1、日本語以外の CMap（`cmaps/`）。npm の公式パッケージから取り出し、CDN と同じ中身であることを確かめた物。**外の CDN からは読まない**（Claude 上など lib/ が無いときだけ、改ざん検査 SRI 付きで CDN を使う）。版を変えるときは `index.html` の `LIBS` の `sri` を作り直す（`test/security.mjs` が一致を確かめる）。
- `sw.js` … オフライン起動用 Service Worker。**index.html を変えたら `VER` の番号を1つ上げる**（例 zumen-v11 → zumen-v12）。
- `manifest.webmanifest` / `icon-*.png` / `apple-touch-icon.png` … ホーム画面追加（PWA）用。
- `admin.html` … 利用者（メールアドレス）の管理の画面。Cloudflare Pages の `/admin`。データは必ず `textContent` で出す（innerHTML に入れない）。
- `functions/` … Cloudflare Pages Functions。
  - `_middleware.js`：すべての要求で Access のログインの証明（JWT）を確かめる。設定が無ければ 503、証明が無ければ 403。管理の画面・API は管理者だけ。配ってよいファイル（`functions/_lib/http.js` の `ALLOW`）以外は 404。
  - `api/admin/members.js`：利用者の登録・削除（Access のグループを書き換える）。
- `_headers` … 安全のためのヘッダー（`functions/_lib/http.js` と同じ中身にする）。
- `tools/setup-cloudflare.mjs` … Cloudflare の初期設定の台本。`docs/公開と利用者の管理.md` … 管理者向けの手順書。

## index.html の中の構成（検索の目印）
- 状態は `S`（ページ・計測 `S.meas[page]`・ズームなど）。保存は `save()` → IndexedDB 自動保存（`autosave` 部分）。
- 外部ライブラリ: `LIBS`（pdf.js は `<head>` の `lib/pdf.min.js`、無ければ `ensurePdfjs()` が CDN から。pdf-lib は書き出し時に `loadPdfLib()`）。
- 主な区画（コメントで区切ってある）:
  - `円弧・円` / `連続曲線` … 円弧計測、ふくらみ(bulge)表現、R切替点ごとの区間（`curveRun`, `runSegs`）
  - `WALLS` / `W_ROWS` … 吉野石膏の壁仕様データ（アクリア・-S生活音対策は基本壁種の `opt`）
  - `computeWall` / `optimizeLayer` … 壁面積・スタッド・ボード割付（ロス最小の張り方向・定尺）
  - `壁の一括設定・集計・展開図` … `openWallBatch`, `openDevView`, `sheetSVG`
  - `Cloudflare Access` … ログイン中の表示（`accessCheck`）、ログアウトとこの端末のデータを消す（`openAccount`・`eraseDeviceData`）、ログインが切れたときの画面（`accessLocked`）
  - `---------- wiring ----------` 以降 … ボタン等のイベント登録
- `STANDALONE`（`window.claude` が無い）ときはブラウザ標準のダウンロードで保存し、AI・クラウド同期は出さない。
  Claude 上（アーティファクト）でも同じコードが動くので、両方で壊れないようにする。

## 安全の決まり
- HTML に入れる文字は必ず `esc()` を通す（`'` も直す）。PDF の文字・ファイル名・メモ・付箋はすべて外から来た物として扱う。
- 公開先の CSP は `connect-src 'self'`（外へ通信できない）。外のサイトへの通信・外のスクリプトを足すと、公開先で止まる。足すときは `functions/_lib/http.js`・`_headers`・試験を一緒に直し、ユーザーに確かめる。
- PDF は `PDF_OPTS`（`isEvalSupported:false`・`enableXfa:false`）で開く。PDF の中の名前（CMap など）を URL に使うときは文字を絞る。
- トークンなどの秘密の値はリポジトリに書かない（Cloudflare Pages の環境変数に入れる）。

## メモリの決まり（iPad・iPhone で落ちないように。2026-11-24 から）
- PDF の重い仕事（`page.render`・`getTextContent` など）は、直接呼ばず `pdfJob(優先度, …)` の列に入れて1つずつ行う（ページ 10・書き出し 9・高精細 8・縮尺 6・縮小画像 3・記号 2）。`pdfJob` の中で別の `pdfJob` を待たない（止まる）。
- 描くときは `pdfRender`。スナップ用の線は描画と同じ命令から取る（`GeoHarvest`）。`getOperatorList()` でもう1組作らない（予備だけ）。
- `LOWMEM`（iPad・iPhone・メモリ4GB以下）では、命令の多いページ（`OP_HEAVY` 超）は描き終えた命令を捨て（`_zkHeavy`）、読み取りも待たせる（`hookStream`・`OP_BACKLOG`）。pdf.js の中の作り（`_intentStates`・`renderTasks`・`_transport.messageHandler`）を使うので、pdf.js の版を変えたら `test/ipad.mjs` を流す。
- PDF の中身の写しは持たない（`S.pdfFile`。書き出しは `readPdfBytes()`）。使い終わった canvas は `freeCanvas`。
- 開く途中で落ちた図面は次に軽い表示（`S.safe`）。印は `GUARD`・`CRASHED`。落ちる原因を直したら `CRASH_VER` を上げると、印を無効にできる。

## 動作確認
- VS Code の Live Server で `index.html` を開く（右下の「Go Live」→ http://127.0.0.1:5500/ ）。
- 確認の基本: PDFを開く → 縮尺が自動で入る → 距離/連続線/面積/円弧を計測 → 🧱壁の一括設定 → 展開図 → 書き出し。
- スマホ表示は ブラウザの開発者ツールのデバイス表示（iPhone）でも確認する。
- 試験（どれも「すべて合格」が出ればよい。部品の jsdom・ws は dxf-takeoff の試験と同じ `%LOCALAPPDATA%\dxf-takeoff`）：
  - `node test/link.mjs`：積算へ書き出した作業データを dxf-takeoff の材料積算（`../../dxf-takeoff/app/material-estimate.html`）で開き、同じ壁の面積が両方で同じかと、天井高＋100・画面の操作を確かめる。壁の計算・書き出し・壁の設定欄を変えたら流す。
  - `node test/security.mjs`：ログインの証明・入口・利用者の管理 API・管理の画面・初期設定の台本（にせの Cloudflare）・アプリの安全の直し。functions/・admin.html・tools/・ライブラリ・ログイン関係を変えたら流す。
  - `node test/ipad.mjs`：iPad の条件で、線の多い図面を開く・拡大・ページ移動・落ちた後の軽い表示。PDF の読み込み・描画・線の読み取り・縮小画像を変えたら流す。
  - `node test/browser.mjs`：本物の Chrome（headless）で、公開先と同じ CSP の下で PDF を開けるか・外への通信が止まるか・管理の画面が動くか。ライブラリ・CSP・PDF の読み込みを変えたら流す。

## dxf-takeoff の積算とのつなぎ（2026-11-24 から）
- 数量の決まりは dxf-takeoff に合わせる（ユーザーの決定）。このアプリからは「積算へ書き出し」で壁の長さ・高さ・ボード高さ・開口・壁種を作業データ（`format:'dxf-takeoff/作業データ'`）で渡し、材料の数・割増（ボード倍率・下地倍率）は積算で数える（`takeoffWork`）。
- 壁は開口の所で切って渡す（積算は壁片が開口をまたぐと開口を引かない）。窓の下（腰）は開口の上の面積にまとめる。壁種は `DXF_SPEC` で積算の仕様名（A2000WI など）に対応させる。
- 壁の `ceil`（天井高）を入れると、ボードは天井高＋100 まで、LGS は高さ H まで（dxf-takeoff の天井までの壁と同じ）。入れていない壁は今までどおり。

## 公開
- 正式な公開先は **Cloudflare Pages ＋ Cloudflare Access**（管理者が登録したメールアドレスの人だけ）。手順は `docs/公開と利用者の管理.md`。`main` に push すると自動で反映される。
- GitHub Pages（github.io）は登録なしで誰でも開けてしまうので、Cloudflare の設定が済んだら止める（止めるか・リポジトリを非公開にするかはユーザーが決める）。
- 計測データは各利用者の端末内（IndexedDB）にだけ保存される。サーバーに送る処理は加えない。
