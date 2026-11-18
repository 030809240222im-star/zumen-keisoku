# 図面計測ツール — 開発メモ（Claude Code / VS Code 用）

## 概要
PDF・画像の図面上で、距離・連続線・面積・円弧（R切替点ごとの区間計測）を計測し、
吉野石膏の壁仕様にもとづく壁面積集計・ボード割付図（展開図①②③…）を作る単一ページのWebアプリ。
利用者は日本の建設関係者。UIの文言はすべて日本語で、専門用語は現場で使う言い方に合わせる。

## ファイル
- `index.html` … アプリ本体（HTML・CSS・JavaScript をこの1ファイルに収めている）。**ここが正本**。
- `cmaps-ja.json` … 日本語PDFの文字を読むための CMap（base64）。通常は触らない。
- `sw.js` … オフライン起動用 Service Worker。**index.html を変えたら `VER` の番号を1つ上げる**（例 zumen-v3 → zumen-v4）。
- `manifest.webmanifest` / `icon-*.png` / `apple-touch-icon.png` … ホーム画面追加（PWA）用。

## index.html の中の構成（検索の目印）
- 状態は `S`（ページ・計測 `S.meas[page]`・ズームなど）。保存は `save()` → IndexedDB 自動保存（`autosave` 部分）。
- 外部ライブラリ: pdf.js 3.11.174（cdnjs）、pdf-lib 1.17.1（jsdelivr、書き出し時に遅延読込）。
- 主な区画（コメントで区切ってある）:
  - `円弧・円` / `連続曲線` … 円弧計測、ふくらみ(bulge)表現、R切替点ごとの区間（`curveRun`, `runSegs`）
  - `WALLS` / `W_ROWS` … 吉野石膏の壁仕様データ（アクリア・-S生活音対策は基本壁種の `opt`）
  - `computeWall` / `optimizeLayer` … 壁面積・スタッド・ボード割付（ロス最小の張り方向・定尺）
  - `壁の一括設定・集計・展開図` … `openWallBatch`, `openDevView`, `sheetSVG`
  - `---------- wiring ----------` 以降 … ボタン等のイベント登録
- `STANDALONE`（`window.claude` が無い）ときはブラウザ標準のダウンロードで保存し、AI・クラウド同期は出さない。
  Claude 上（アーティファクト）でも同じコードが動くので、両方で壊れないようにする。

## 動作確認
- VS Code の Live Server で `index.html` を開く（右下の「Go Live」→ http://127.0.0.1:5500/ ）。
- 確認の基本: PDFを開く → 縮尺が自動で入る → 距離/連続線/面積/円弧を計測 → 🧱壁の一括設定 → 展開図 → 書き出し。
- スマホ表示は ブラウザの開発者ツールのデバイス表示（iPhone）でも確認する。

## 公開
- `main` に push すると GitHub Pages（および Cloudflare Pages を接続済みならそちら）に自動で反映される。
- 計測データは各利用者の端末内（IndexedDB）にだけ保存される。サーバーに送る処理は加えない。
