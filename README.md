# 家計簿アプリ（自分用PWA）

## ファイル構成
- `index.html` … 画面
- `style.css` … 見た目
- `app.js` … 動き（記録・集計・バックアップ）
- `manifest.json` … ホーム画面に置いたときの名前・アイコン
- `sw.js` … オフラインでも動かすための仕組み
- `icons/` … アイコン画像（差し替えOK）

## パソコンで試す（VS Code）
1. VS Codeでこのフォルダを開く
2. 拡張機能「Live Server」を入れる
3. `index.html` を右クリック →「Open with Live Server」

## スマホのホーム画面に置く（GitHub Pagesの例）
1. GitHubで新しいリポジトリを作り、このフォルダの中身を全部アップロード
2. リポジトリの Settings → Pages → Branch を `main` にして Save
3. 数分後に表示される `https://ユーザー名.github.io/リポジトリ名/` をスマホで開く
4. iPhone：Safariの共有ボタン →「ホーム画面に追加」
   Android：Chromeのメニュー →「ホーム画面に追加」

## 注意
- データはスマホの中（ブラウザ）だけに保存されます。設定画面からときどきバックアップを。
- iPhoneではSafariから追加したアイコンで使ってください（Safariで開いた時とデータは別扱いになることがあります）。
- アプリを修正したら `sw.js` の `CACHE` を `kakeibo-v2` のように上げると、スマホにも反映されます。
