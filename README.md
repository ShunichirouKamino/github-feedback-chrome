# github-feedback

動作中の画面（localhost / AWS の検証環境など）にコメントを付けて、そのまま GitHub Issue を起票する Chrome 拡張機能です。

## 流れ

1. `Alt+Shift+C`（または拡張アイコン）でコメントモードに入る
2. 要素をクリックするか、範囲をドラッグして選択する
3. コメントを書いて「Issue を開く」（`Ctrl+Enter`）
4. 入力済みの Issue 作成画面が新しいタブで開き、スクショが本文に自動で添付される。内容を確認して Submit する

スクショは選択範囲が赤枠で示され、範囲外は少し暗くなります。

### スクショの自動添付のしくみ
API は使わず、開いた Issue 作成画面の本文欄に画像の paste イベントを送り、GitHub 自身のアップロード処理に添付させています（ログイン中のセッションでアップロードされるため、トークンは不要です）。
GitHub の画面の変更などで添付に失敗した場合は、画面右上に「📋 スクショをコピー」ボタンが出るので、コピーして本文に `Ctrl+V` してください。

## Issue に自動で入る情報

- URL、環境名、画面サイズ、ブラウザ、日時
- 対象要素の CSS セレクタ、テキスト、HTML の抜粋
- 直近の `console.error` / `console.warn`、未捕捉の例外、失敗した fetch/XHR やリソースの読み込み
- `<meta name="version|app-version|build|commit">` があればその値

AI エージェント（Claude Code、Copilot など）に Issue をそのまま渡しても、修正箇所を特定しやすい形を意識しています。

## インストール（開発版）

1. `chrome://extensions` を開き、右上の「デベロッパー モード」を ON にする
2. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
3. 拡張機能の「詳細」→「拡張機能のオプション」で起票先リポジトリを設定する

ビルドは不要です。コードを変更したら `chrome://extensions` で再読み込みしてください。

## 設定例

| ホストのパターン | リポジトリ | 環境名 | ラベル |
|---|---|---|---|
| `localhost:*` | `org/app` | `local` | `feedback,env:local` |
| `*.stg.example.com` | `org/app` | `stg` | `feedback,env:stg` |

## 制約・注意

- スクショの自動添付は GitHub の画面の作りに依存しています。GitHub 側の変更で動かなくなる可能性があります。
- 本文は URL で渡すため、長すぎる場合は HTML やログを自動で削ります。
- エラーの収集は、拡張機能を入れた後に読み込んだページだけが対象です。入れる前から開いていたタブは再読み込みしてください。
- `console.error` をフックしているため、DevTools 上のログの発生元が `hook.js` と表示されます。
- `chrome://` などの拡張機能が動かないページでは使えません。

## 構成

```
manifest.json
src/
  background.js   アイコン/ショートカットで overlay を注入、撮影と注釈、Issue 画面へのスクショ添付
  hook.js         MAIN world。console と通信のエラーを記録
  overlay.js      コメントモードの UI、コンテキスト収集、Issue URL の組み立て
  options.*       設定画面
```
