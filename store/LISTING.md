# Chrome Web Store submission notes (v1.0.0)

What to enter in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Copy each value into the matching field.

## Before submitting

- [ ] Register as a developer (one-time fee of USD 5). If publishing on behalf of a company, use the company's publisher name and contact email
- [x] Fill in the contact in `PRIVACY.md`
- [x] Publish the privacy policy at a URL anyone can open (the repository is public)
- [x] Build `dist/github-feedback-1.0.0.zip` with `npm run package` (also attached to the GitHub Release)

## Package

| Field | Value |
|---|---|
| File to upload | `dist/github-feedback-1.0.0.zip` (or the asset on the [v1.0.0 release](https://github.com/ShunichirouKamino/github-feedback-chrome/releases/tag/v1.0.0)) |

## Store listing

The extension UI and the manifest summary are in Japanese, so set the listing language to **Japanese** and use the Japanese description below. An English description is included in case you add English as a second listing language.

| Field | Value |
|---|---|
| Language | Japanese |
| Name (from the manifest) | github-feedback |
| Summary (from the manifest) | 動作中の画面にコメントを付けて、スクリーンショットと画面の情報付きで GitHub Issue を起票します（GitHub 非公式） |
| Category | Developer Tools |
| Store icon | `icons/icon128.png` |
| Screenshots | `store/screenshot-1-select.png` / `store/screenshot-2-comment.png` / `store/screenshot-3-options.png` (1280×800). If possible, add one more showing the real GitHub new-issue page with the body and screenshot filled in |
| Small promo tile | `store/promo-small-440x280.png` |
| Homepage URL | https://github.com/ShunichirouKamino/github-feedback-chrome |
| Support URL | https://github.com/ShunichirouKamino/github-feedback-chrome/issues |

### Description (Japanese, for the listing)

```
開発中・検証中の Web アプリを触りながら、気づいたことをその場で GitHub Issue にするための拡張機能です。
コードではなく「動いている画面」を見てレビューすることが増えた開発チーム向けに作りました。

■ 使い方
1. Ctrl+Shift+1（または拡張アイコン）でコメントモードに入る
2. 気になる要素をクリック、または範囲をドラッグして選択
3. コメントを書いて「Issue を開く」
4. GitHub の Issue 作成画面に、本文とスクリーンショットが自動で入る。内容を確認して作成

■ Issue に自動で入る情報
・スクリーンショット（選択範囲を赤枠で強調。選択範囲の周辺だけにも設定可能）
・ページの URL、環境名（local / stg など）、画面サイズ、ブラウザ、日時
・選択した要素の CSS セレクタとテキスト
・登録したホストでは、コンソールのエラー・警告と失敗した通信、HTML の抜粋（含めるかは起票時に選択）
AI エージェントに Issue を渡しても修正箇所を特定しやすい形で記載します。

■ 起票先の振り分け
localhost:*、*.stg.example.com のようなホストのパターンごとに、起票先リポジトリ・環境名・ラベルを設定できます。GitHub Enterprise Server にも対応しています。

■ プライバシーとセキュリティ
・GitHub のトークンは使いません。ログイン中のブラウザで GitHub の画面を開き、Issue の作成は利用者自身が行います
・URL・ログ・HTML に含まれるトークン、パスワード、署名付き URL などはマスクしてから記載します
・本文は URL に載せず、ブラウザの履歴に残りません
・起票先が公開リポジトリの場合は警告します
・開発者や第三者のサーバーには一切データを送信しません

※ 本拡張機能は GitHub, Inc. とは関係のない非公式のツールです。
```

### Description (English, optional)

```
Comment on the web app you are testing and turn it into a GitHub Issue on the spot.
Built for teams that increasingly review the running product rather than the code.

■ How it works
1. Press Ctrl+Shift+1 (or click the toolbar icon) to enter comment mode
2. Click an element or drag to select an area
3. Write your comment and open the issue
4. GitHub's new-issue page opens with the body and screenshot filled in. Review it and submit

■ What goes into the issue
- A screenshot (selection highlighted in red, or only the area around the selection)
- Page URL, environment name (local / stg ...), viewport size, browser, timestamp
- CSS selector and text of the selected element
- On hosts you register: console errors/warnings, failed requests, and an HTML snippet (you choose whether to include them)
The format is designed so that an AI agent can pick up the issue and locate the fix.

■ Routing
Map host patterns such as localhost:* or *.stg.example.com to a target repository, environment name, and labels. GitHub Enterprise Server is supported.

■ Privacy and security
- No GitHub token is used. The issue page opens in your signed-in browser and you submit it yourself
- Tokens, passwords, signed URLs, and similar values in URLs, logs, and HTML are redacted
- The body is never put in the URL, so it does not end up in your browser history
- Warns you when the target repository is public
- No data is ever sent to the developer or any third-party server

Note: The UI is in Japanese. This is an unofficial tool and is not affiliated with GitHub, Inc.
```

## Privacy practices tab

### Single purpose description

```
Add a comment to the web page being viewed and fill it, together with a screenshot and information about the page, into GitHub's new-issue page.
```

### Permission justifications

| Permission | Justification to enter |
|---|---|
| activeTab | Used to show the comment UI in the tab where the user clicked the icon or pressed the shortcut, and to capture a screenshot of that tab. |
| scripting | Used to show the comment UI, to fill the body and screenshot into GitHub's new-issue page, and to register the error-recording script on hosts the user registered. |
| storage | Used to store settings such as target repositories, and to keep the body and screenshot temporarily until they are filled into the new-issue page. |
| Host permissions (github.com / api.github.com) | Used to fill the body and screenshot into the new-issue page on github.com, and to check through the GitHub API whether the target repository is public. |
| Host permissions (optional: all sites) | Not required. Requested only for hosts the user registers in the settings page (for example localhost or a staging domain), with the user's consent, to record console errors and failed requests. Also used to fill the issue page when the user uses GitHub Enterprise Server. |

### Remote code

- Select "No, I am not using remote code" (all scripts are included in the package)

### Data usage

Check these data types:

- [x] Web history (the URL of the page displayed when filing is included in the issue)
- [x] Website content (the screenshot, the selected element's text and HTML snippet, and console errors are included in the issue)
- Do not check the others (personally identifiable information, health, financial and payment, authentication, personal communications, location, user activity)

Check all three certifications:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

- https://github.com/ShunichirouKamino/github-feedback-chrome/blob/main/PRIVACY.md

## Distribution

| Field | Value |
|---|---|
| Visibility | Unlisted (only people with the link) |
| Regions | All regions (Japan only is fine for internal use) |

## Points reviewers may raise

- **"GitHub" in the name**: the summary and description state that the tool is unofficial, and no GitHub logo is used. If the review still flags trademark or impersonation, rename it to something like "Issue Feedback for GitHub" and resubmit.
- **Optional all-sites permission**: explain, as in the justification above, that permission is requested only for hosts the user registers.
