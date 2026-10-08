# github-feedback

Chrome extension (Manifest V3, plain JavaScript, no build step) that turns a comment on a running web page into a GitHub Issue with a screenshot and page context. See [README.md](README.md) for the user-facing overview and [docs/SECURITY.md](docs/SECURITY.md) for the threat model.

## Layout

| Path | Role |
|---|---|
| `src/lib.js` | Pure shared logic (settings validation, host matching, redaction, issue body/URL building, upload detection). Loaded by the service worker, content scripts, the options page and Node tests. **Put testable logic here** |
| `src/background.js` | Service worker: injects comment mode, validates submissions, captures screenshots, fills the issue page (`fillIssue`), registers `hook.js` |
| `src/overlay.js` | Comment mode UI (closed Shadow DOM) and page context collection. Runs in the isolated world |
| `src/hook.js` | Error recorder in the page's MAIN world. Registered dynamically, only on hosts the user granted |
| `src/options.*` | Settings page |
| `test/lib.test.js` | Unit tests (`node --test`) |
| `test/e2e/run.js` | Puppeteer E2E with a test app and a fake GitHub over HTTPS |
| `scripts/` | Manifest checks, version sync, ZIP packaging |
| `store/` | Chrome Web Store listing notes and assets |

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Syntax check of `src/*.js` + unit tests + manifest checks. No dependencies required |
| `npm run e2e` | Full filing flow in Chrome for Testing (needs `npm install`) |
| `npm run package` | Builds `dist/github-feedback-<version>.zip` |
| `npm run release -- --dry-run` | Previews the next version and release notes (reverts `package.json` / `package-lock.json` afterwards with `git checkout`) |

CI (`.github/workflows/ci.yml`) runs `verify` and `e2e` on every push to `main` and on pull requests.

## Invariants

These protect the security properties listed in [docs/SECURITY.md](docs/SECURITY.md). Do not weaken them without updating that document.

- **The page is untrusted.** Anything read from the page (URL, DOM, text, `<meta>`, logs, requests, `ghfb:response`) must be validated (`validateDiag`), redacted (`redactUrl` / `redactText`) and placed inside a fenced block (`codeBlock`) before it reaches the issue body. Only the user's own comment is written as Markdown.
- **Decide in the service worker.** The target repository, environment name and labels are re-derived in `background.js` from settings and the sender tab URL. Never trust values sent by the content script for these.
- **Inject only into the expected issue page.** `fillIssue` runs only when the origin equals the configured GitHub host and the path is exactly `/<owner>/<repo>/issues/new`, and re-checks this inside the page.
- **Least privilege.** Do not add `<all_urls>`, static `content_scripts`, or new always-on host permissions. Host access beyond github.com / api.github.com goes through `optional_host_permissions` and is requested from the options page.
- **The body never goes into the URL.** The new-issue URL carries only the title, labels and the marker.
- **A human submits.** The extension never creates issues through the API and holds no GitHub token.
- **The extension has no runtime dependencies.** Everything under `src/` is plain JavaScript loaded as-is. Dev tooling lives in `devDependencies` only.

## Code conventions

- Match the surrounding style: plain JavaScript, 2-space indent, single quotes, comments explain *why*.
- Code comments and UI strings are Japanese; documentation (README, AGENTS.md, CHANGELOG, docs/, store/) is English.
- New pure logic goes into `src/lib.js` with unit tests. Behavior that spans the browser (injection, capture, issue page) gets an E2E check.
- When you change a countermeasure, update [docs/SECURITY.md](docs/SECURITY.md): its links are permalinks pinned to a commit, so re-pin them to a commit that contains the change.

## Commit rules

Use [Conventional Commits](https://www.conventionalcommits.org/). Release notes and the next version are generated from them, so the type matters.

```
<type>(<scope>): <summary in imperative mood, English>

<optional body: why, not what>
```

| Type | Use for | Release effect |
|---|---|---|
| `feat` | New user-visible behavior | minor |
| `fix` | Bug fixes, including security fixes | patch |
| `feat!` / `fix!` or a `BREAKING CHANGE:` footer | Changes that require users to reconfigure or break existing settings | major |
| `docs` | Documentation only | none |
| `test` | Tests only | none |
| `refactor` / `perf` / `style` | No behavior change | none |
| `ci` / `build` / `chore` | Workflows, tooling, dependencies | none |

Scopes (optional but preferred): `overlay`, `options`, `capture`, `attach` (filling the issue page), `redact`, `hook`, `security`, `release`, `store`, `deps`.

- **Verify before committing.** `npm run verify` must pass; run `npm run e2e` when you touch `background.js`, `overlay.js`, `hook.js` or the manifest.
- **One commit = one logical change.** Split unrelated changes into separate commits.
- **Do not rewrite published history.** No rebase, squash, amend or force push on `main` unless explicitly asked.
- **Do not edit `CHANGELOG.md` or bump versions by hand.** The release workflow owns them.
- Commit, push, and open pull requests only when asked or when it is part of a requested workflow. A normal implementation request ends with local changes and verification.

## Release process

Versions follow SemVer and are derived from commits by release-it.

1. Make sure `main` is green in CI.
2. Run **Actions → Release → Run workflow**.
   - Leave **version** empty to derive it from commits (`feat` → minor, `fix` → patch, breaking → major), or pass an explicit version (`1.2.3`) or increment (`patch` / `minor` / `major`).
3. The workflow (`.github/workflows/release.yml`) runs `npm run verify`, bumps `package.json`, syncs `manifest.json` (`scripts/sync-version.js`), builds the ZIP, prepends the notes to `CHANGELOG.md`, commits `chore(release): X.Y.Z`, tags `vX.Y.Z`, and publishes a GitHub Release with the ZIP attached.
4. Upload the ZIP from the release to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and submit for review. Follow [store/LISTING.md](store/LISTING.md) when permissions or data usage change, and update the privacy policy ([PRIVACY.md](PRIVACY.md)) at the same time.

Notes:

- Chrome only accepts numeric versions (`1.2.3`); do not use pre-release suffixes.
- If a release fails halfway, check whether the tag exists (`git ls-remote --tags origin vX.Y.Z`) before rerunning.
- A version uploaded to the Chrome Web Store can never be reused. If a release is rejected, fix it and release a new patch version.
