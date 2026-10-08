# github-feedback

A Chrome extension that lets you comment on a running web app (localhost, AWS staging environments, and so on) and file the comment as a GitHub Issue, together with a screenshot and context about the page.
It is built for teams that increasingly review the *running product* rather than the code.

> The extension UI is currently in Japanese.

## Usage

1. Press `Ctrl+Shift+1` (or click the toolbar icon) to enter comment mode
2. Click an element, or drag to select an area
3. Check the target repository, write your comment, and click "Issue を開く" (Open issue, `Ctrl+Enter`)
4. GitHub's new-issue page opens with the body and screenshot filled in. Review it and submit

A human always submits the issue. The extension holds no GitHub token; it simply uses the browser session you are already signed in with.

## What goes into the issue

| Item | Content |
|---|---|
| Comment | What you wrote |
| Screenshot | The whole viewport (selection highlighted in red) or only the area around the selection, configurable |
| Environment | URL, page title, environment name, viewport size, browser, timestamp, and values such as `<meta name="version">` |
| Target element | CSS selector and text |
| Diagnostics (optional) | HTML snippet, recent console errors/warnings, uncaught exceptions, and failed requests |

Every value taken from the page is placed inside a code block so it cannot be interpreted as a mention, link, or HTML.
The format is designed so that an AI agent (Claude Code, Copilot, and others) can pick up the issue and locate the fix.

## Privacy and security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and countermeasures, with links to the implementation.

- **Secret redaction**: tokens, passwords, signed URLs, API keys, JWTs, and email addresses found in URL queries/fragments, logs, and HTML are replaced with `REDACTED`. Input values, hidden/password inputs, and scripts are excluded from HTML snippets. Redaction is heuristic, so always review the content on GitHub before submitting.
- **The body is never put in the URL**: the new-issue URL only carries the title and labels. The body is typed into the form after the page opens, so it does not end up in browser history or access logs.
- **Public repository warning**: if the target repository is public, the extension warns you and leaves diagnostics out by default.
- **No automatic target on unknown hosts**: on pages that do not match a routing rule, you must choose the target repository every time.
- **When the screenshot is uploaded**: the screenshot is uploaded to GitHub as soon as it is pasted into the new-issue page (the same as a normal GitHub image attachment). It stays on GitHub even if you close the page without submitting.
- **The page cannot touch the extension UI**: the comment UI lives in a closed Shadow DOM, and values such as the target repository are re-validated inside the extension.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` / `scripting` | Show comment mode in the tab where you clicked the icon or pressed the shortcut, and capture that tab |
| `storage` | Settings, and temporary storage of the body and image until they are placed into the issue page |
| `https://github.com/*` | Fill the body and screenshot into the new-issue page |
| `https://api.github.com/*` | Check whether the target repository is public (unauthenticated) |
| Any host (granted individually in settings) | Record console and network errors on hosts you registered in the routing rules. Also the GitHub Enterprise Server host if you use one |

Error recording is enabled only for hosts you register and grant in the settings page. Records are kept in the browser for recent events only, and you choose whether to include them when filing. Nothing is sent anywhere else.

## Download

Download `github-feedback-<version>.zip` from the [latest release](https://github.com/ShunichirouKamino/github-feedback-chrome/releases/latest), extract it, open `chrome://extensions`, turn on "Developer mode", and click "Load unpacked" to select the extracted folder.
The extension will also be available from the Chrome Web Store (unlisted) once it passes review.

## Installation (development build)

1. Open `chrome://extensions` and turn on "Developer mode" in the top-right corner
2. Click "Load unpacked" and select this folder
3. Open the extension's "Details" → "Extension options" and configure the target repositories

Reload the extension in `chrome://extensions` after changing the code.
If the shortcut does not work, check the assignment in `chrome://extensions/shortcuts` (combinations such as Alt+Shift may be captured by Windows or resident apps).

## Example settings

| Host pattern | Target repository | Environment | Labels |
|---|---|---|---|
| `localhost:*` | `org/app` | `local` | `feedback,env:local` |
| `*.stg.example.com` | `org/app` | `stg` | `feedback,env:stg` |

## Limitations

- Attaching the screenshot and filling the body depend on how GitHub's page is built. If they fail, "copy body" and "copy screenshot" buttons appear in the top-right corner so you can paste manually.
- In repositories that only allow Issue Forms (YAML templates), the body cannot be filled automatically (use the buttons above).
- Elements inside an iframe are selected as the whole iframe. Error recording covers the top frame only.
- It does not work on pages where extensions cannot run, such as `chrome://` pages and the Chrome Web Store.

## Development

```sh
npm run verify    # syntax check + unit tests + manifest checks (no dependencies needed)
npm install       # for E2E (Puppeteer and Chrome for Testing)
npm run e2e       # starts a test app and a fake GitHub, then runs the whole filing flow
npm run package   # builds the distributable ZIP into dist/
```

No build step is needed (plain JavaScript, Manifest V3), and the extension itself has no dependencies.
Because permission prompts cannot be clicked in automation, the E2E run uses a copy of the manifest with extra test permissions. Verify against the real github.com manually.

### Releasing

Releases are cut with [release-it](https://github.com/release-it/release-it) and [Conventional Commits](https://www.conventionalcommits.org/).

1. Write commit messages as `feat: …`, `fix: …`, `docs: …` (add `!` or a `BREAKING CHANGE:` footer for breaking changes)
2. Run **Actions → Release → Run workflow** on `main`. Leave the version empty to derive it from the commits (`feat` → minor, `fix` → patch, breaking → major), or enter an explicit version / increment
3. The workflow runs the checks, bumps `package.json` and `manifest.json`, updates [CHANGELOG.md](CHANGELOG.md), tags `vX.Y.Z`, and publishes a GitHub Release with generated notes and the extension ZIP attached

`npm run release -- --dry-run` previews the next version and notes locally.

```
manifest.json
icons/            icons (icon.svg / icon-16.svg are the sources)
src/
  lib.js          shared logic (settings validation, host matching, redaction, body building); unit tested
  background.js   injects comment mode, validates submissions, captures, fills the issue page, registers error recording
  overlay.js      comment mode UI and page context collection
  hook.js         error recording (registered only in the MAIN world of configured hosts)
  options.*       settings page
test/             unit tests (node --test) and E2E (test/e2e)
scripts/          manifest checks, version sync and ZIP packaging
store/            Chrome Web Store listing notes and assets
```

## License

No license has been specified yet.
