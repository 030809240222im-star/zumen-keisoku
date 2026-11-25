# 図面計測ツール — 開発メモ（Claude Code / VS Code 用）

## 概要
PDF・画像の図面上で、距離・連続線・面積・円弧（R切替点ごとの区間計測）を計測し、
吉野石膏の壁仕様にもとづく壁面積集計・ボード割付図（展開図①②③…）を作る単一ページのWebアプリ。
利用者は日本の建設関係者。UIの文言はすべて日本語で、専門用語は現場で使う言い方に合わせる。

## ファイル
- `index.html` … アプリ本体（HTML・CSS・JavaScript をこの1ファイルに収めている）。**ここが正本**。
- `cmaps-ja.json` … 日本語PDFの文字を読むための CMap（base64）。通常は触らない。
- `lib/` … pdf.js 3.11.174（`pdf.min.js`・`pdf.worker.min.js`）、pdf-lib 1.17.1、日本語以外の CMap（`cmaps/`）。npm の公式パッケージから取り出し、CDN と同じ中身であることを確かめた物。**外の CDN からは読まない**（Claude 上など lib/ が無いときだけ、改ざん検査 SRI 付きで CDN を使う）。版を変えるときは `index.html` の `LIBS` の `sri` を作り直す（`test/security.mjs` が一致を確かめる）。
- `sw.js` … オフライン起動用 Service Worker。**index.html を変えたら `VER` の番号を1つ上げる**（例 zumen-v14 → zumen-v15）。
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
- 公開先の CSP は `tools/fbbuild.mjs` の `csp()`（通信は自分と、ログイン・名簿のための Google の3か所だけ）。外のサイトへの通信・外のスクリプトを足すと、公開先で止まる。足すときは試験を一緒に直し、ユーザーに確かめる。
- PDF は `PDF_OPTS`（`isEvalSupported:false`・`enableXfa:false`）で開く。PDF の中の名前（CMap など）を URL に使うときは文字を絞る。
- トークンなどの秘密の値はリポジトリに書かない（Cloudflare Pages の環境変数に入れる）。

## メモリの決まり（iPad・iPhone で落ちないように。2026-11-24 から）
- PDF の重い仕事（`page.render`・`getTextContent` など）は、直接呼ばず `pdfJob(優先度, …)` の列に入れて1つずつ行う（ページ 10・書き出し 9・高精細 8・縮尺 6・縮小画像 3・記号 2）。`pdfJob` の中で別の `pdfJob` を待たない（止まる）。
- 描くときは `pdfRender`。スナップ用の線は描画と同じ命令から取る（`GeoHarvest`）。`getOperatorList()` でもう1組作らない（予備だけ）。
- `LOWMEM`（iPad・iPhone・メモリ4GB以下）では、命令の多いページ（`OP_HEAVY` 超）は描き終えた命令を捨て（`_zkHeavy`）、読み取りも待たせる（`hookStream`・`OP_BACKLOG`）。pdf.js の中の作り（`_intentStates`・`renderTasks`・`_transport.messageHandler`）を使うので、pdf.js の版を変えたら `test/ipad.mjs` を流す。
- PDF の中身の写しは持たない（`S.pdfFile`。書き出しは `readPdfBytes()`）。使い終わった canvas は `freeCanvas`。
- 開く途中で落ちた図面は次に軽い表示（`S.safe`）。印は `GUARD`・`CRASHED`。落ちる原因を直したら `CRASH_VER` を上げると、印を無効にできる。

## 区画の控え（動かすたびに描き直さない。2026-11-25 から）
- ページは1回だけ細かく描き（`TILE_LONG`）、512px の区画（PNG）に分けて IndexedDB `zumen-tiles` に置く。線・索引（`packGeo`）・縮尺の判定・記号も一緒に置き、2回目からは PDF を読み解かない（`loadTiles`・`tget`）。
- 見分けは **PDF の中身の SHA-256**（`S.hash`）。ファイル名を番号に使わない（改訂図と混ざる）。番号と持ち主は作業の始めに固定する（途中で図面が替わる）。パスワード付きの PDF は置かない。
- **描き方・線の取り方・縮尺や記号の判定を変えたら `TILE_VER` を上げる**（上げないと、古い結果が出続ける）。
- 図面を消す所では `tilesDropFile`、端末のデータを消す所では `tilesErase` を必ず呼ぶ。上限は `TILE_BYTES`（古い順に消す）。画像は Blob でなくデータ列で置く（プライベートブラウズの Safari のため）。
- 動かす処理は `viewChanged` → `flushView`（1コマに1回）。線の多い図面（`S.heavy`）は、古い端末では「ここを鮮明に」（`renderHi(true)`）のときだけ描き直す。
- 描きかけの表示（`onTick`）は Safari で描画を極端に遅くする。回数を増やさない。
- 図面を開く処理は1件ずつ（`openLock`・`openSeq`）。開き替えた後に前の図面の続きを書かない。

## 割付の条件とキワのカット寸法（2026-11-26 から）
- LGS（`arr`・`pitch`・`base`・`lgsFirst`）、捨て貼り＝下張（`orientLow`・`layLow`・`firstLow`・`vLow`・`jtLow`・`lenLow`）、上貼り＝上張（同 `…Up`）、端（`fin`・`gapS/E/T/B`）を壁ごとに選ぶ。値は `normLay` で決まった物だけ残す。欄は `layPanel`（展開図・割付図で共通）。
- 選んだ層だけ `optimizeLayer` の `pick` の道を通る。上貼りの「目地ずらし」（`jOffX`・`jOffY`）は、捨て貼りの1本目の目地からその寸法だけずらす。
- **端の標準は「取り合いの壁厚を引く」**（`finOf`。2026-11-26 ユーザーの決定。壁芯までは `fin:'core'`）。`autoTrim` はページの壁が変わったときだけ計算し直す（`pageSig`。描き直しのたびに全部の壁を見ない）。張る範囲（`boards[k].fs`）だけが変わり、壁面積・積算への書き出しは壁芯のまま。
- 枚数の見積もり（`estimateSheets`）：定尺の半分より大きい切り物は同じ向きに詰めて数える（2026-11-26 から。1枚から取れる物を2枚と数えない）。
- キワの寸法は `cutList`（開口で分かれる所は分け、切り欠きを付ける）。足すと張る面積に合うことを試験で確かめる。
- 画面の言葉は「捨て貼り・上貼り」、内部の番号は `A下張`・`A上張` のまま（`sideName` で直す）。A面は始点→終点を見て左側で、標準の図は裏（B面側）から見た向き（`LV.front` で正面から）。

## 動作確認
- VS Code の Live Server で `index.html` を開く（右下の「Go Live」→ http://127.0.0.1:5500/ ）。
- 確認の基本: PDFを開く → 縮尺が自動で入る → 距離/連続線/面積/円弧を計測 → 🧱壁の一括設定 → 展開図 → 書き出し。
- スマホ表示は ブラウザの開発者ツールのデバイス表示（iPhone）でも確認する。
- 試験（どれも「すべて合格」が出ればよい。部品の jsdom・ws は dxf-takeoff の試験と同じ `%LOCALAPPDATA%\dxf-takeoff`）：
  - `node test/link.mjs`：積算へ書き出した作業データを dxf-takeoff の材料積算（`../../dxf-takeoff/app/material-estimate.html`）で開き、同じ壁の面積が両方で同じかと、天井高＋100・画面の操作を確かめる。壁の計算・書き出し・壁の設定欄を変えたら流す。
  - `node test/layout.mjs`：割付の条件・キワのカット寸法・端の寸法・展開図の画面。割付・展開図を変えたら流す。
  - `node test/security.mjs`：ログインの証明・入口・利用者の管理 API・管理の画面・初期設定の台本（にせの Cloudflare）・アプリの安全の直し。functions/・admin.html・tools/・ライブラリ・ログイン関係を変えたら流す。
  - `node tools/fbbuild.mjs && node test/firebase.mjs`：Firebase のエミュレータと Chrome で、決まり・登録・名簿・外す・電波なし。firebase/・名簿・ログインを変えたら流す（Java が要る）。
  - `node test/ipad.mjs`：iPad の条件で、線の多い図面を開く・拡大・ページ移動・区画の控え（一致・取り違え・開き直し）・落ちた後の軽い表示。`ENGINE=webkit` でも流す（Chrome だけでは Safari の遅さに気付けない）。PDF の読み込み・描画・線の読み取り・縮小画像を変えたら流す。
  - `node test/browser.mjs`：本物の Chrome（headless）で、公開先と同じ CSP の下で PDF を開けるか・外への通信が止まるか・管理の画面が動くか。ライブラリ・CSP・PDF の読み込みを変えたら流す。

## dxf-takeoff の積算とのつなぎ（2026-11-24 から）
- 数量の決まりは dxf-takeoff に合わせる（ユーザーの決定）。このアプリからは「積算へ書き出し」で壁の長さ・高さ・ボード高さ・開口・壁種を作業データ（`format:'dxf-takeoff/作業データ'`）で渡し、材料の数・割増（ボード倍率・下地倍率）は積算で数える（`takeoffWork`）。
- 壁は開口の所で切って渡す（積算は壁片が開口をまたぐと開口を引かない）。窓の下（腰）は開口の上の面積にまとめる。壁種は `DXF_SPEC` で積算の仕様名（A2000WI など）に対応させる。
- 壁の `ceil`（天井高）を入れると、ボードは天井高＋100 まで、LGS は高さ H まで（dxf-takeoff の天井までの壁と同じ）。入れていない壁は今までどおり。

## 公開（Firebase。2026-11-24 から）
- 正式な公開先は Firebase（プロジェクト zumen-keisoku、<https://zumen-keisoku.web.app> → firebaseapp.com に移る）。**名簿（Firestore の members/<メール>）の人だけ**。公開は `node tools/fbdeploy.mjs`（push では出ない）。確認だけは `--check`。
- 作り：`firebase/src/index.html`・`shell.js`（ログイン画面。誰でも見える）→ 名簿を確かめ → アプリ本体（`index.html`）を Firestore の `app/current`・`parts` から受け取り、`document.write` で入れ替える。**アプリ本体を hosting に置かない**（`fbbuild.mjs` が紛れ込みを止める）。
- アプリ側は `window.zumenAuth`（shell.js の `api()`）で 名簿・ログアウト・確かめ直し（`ZA`・`openRoster`）。
- 決まりは `firebase/firestore.rules.tpl`。持ち主のメールは `firebase/local.json`（git に入れない）から入れる。**リポジトリは公開なので、メール・鍵を書かない**（接続の設定は hosting の `/__/firebase/init.json` から読む）。
- ログインの部品は `firebase/fb/`（Firebase JS SDK 10.14.1。npm の公式の物、読み込み先だけ書き換え）。
- `functions/`・`admin.html`・`_headers`・`tools/setup-cloudflare.mjs` は前の案（Cloudflare）の物で、使っていない。
- GitHub Pages（github.io）は登録なしで誰でも開ける。ユーザーが Firebase 版を確かめたら、止めてリポジトリを非公開にする（ユーザーの決定。合図を待つ）。`main` に push すると GitHub Pages には出る。
- 計測データは各利用者の端末内（IndexedDB）にだけ保存される。サーバーに送る処理は加えない。
