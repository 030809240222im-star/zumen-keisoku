# 図面計測ツール

PDF・画像の図面から、2点間距離・連続線・面積・円弧を計測し、壁面積の集計とボード割付図（展開図）を作成するWebアプリです。

- 管理者が名簿に登録したメールアドレスの人だけが使えます（Firebase）。使用者の追加などは [docs/公開と利用者の管理.md](docs/公開と利用者の管理.md)。
- 図面や計測データは、使う人の端末（ブラウザ）の中だけに保存され、外部には送信されません（ログインと名簿のための通信だけがあります）。
- 壁仕様のデータは、吉野石膏の公開カタログ・認定書一覧をもとにしています。施工の前に、必ずメーカーの最新資料で確認してください。
- 同梱のライブラリ：[pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0）、[pdf-lib](https://github.com/Hopding/pdf-lib)（MIT）、[Firebase JS SDK](https://github.com/firebase/firebase-js-sdk)（Apache-2.0）。

## VS Code で編集する

1. [Git](https://git-scm.com/) と [VS Code](https://code.visualstudio.com/) をインストールします。
2. VS Code で `Ctrl+Shift+P` →「Git: クローン」→ このリポジトリのアドレスを入力し、保存先を選んで開きます。
3. 右下に「推奨の拡張機能をインストールしますか？」と出たら「インストール」を押します（Claude Code と Live Server）。
4. 画面右下の「Go Live」を押すと、ブラウザでアプリが開き、保存するたびに自動で再読み込みされます。
5. 変更したら、左の「ソース管理」で内容を書いてコミット →「変更の同期」で GitHub に反映。Firebase への公開は `node tools/fbdeploy.mjs`。

開発メモは `CLAUDE.md` にあります（Claude Code はこのファイルを自動で読みます）。
