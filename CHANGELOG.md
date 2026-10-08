# Changelog

## 1.0.0 - 2026-10-08

First stable release, distributed through the Chrome Web Store (unlisted).

### Features
- Click an element or drag an area on a running page, write a comment, and open GitHub's new-issue page (`Ctrl+Shift+1`)
- Automatically attach a screenshot (whole viewport with the selection highlighted, or only the area around the selection) to the issue body
- Include the URL, environment name, viewport size, browser, and the selected element's CSS selector. On registered hosts, also include console/network errors and an HTML snippet
- Route issues to a target repository, environment name, and labels per host pattern. GitHub Enterprise Server is supported

### Security (see [docs/SECURITY.md](docs/SECURITY.md))
- The UI lives in a closed Shadow DOM. The service worker re-validates the target repository, environment name, and labels
- Values from the page are redacted and isolated in code blocks (prevents mention, link, HTML, and prompt injection)
- The body is not put in the URL; it is typed into the issue page after it opens
- Screenshots are only placed into `/<target>/issues/new` on the configured GitHub host. The sender tab is checked before and after capture
- The only always-on permissions are github.com and api.github.com. Error recording is registered dynamically only on hosts the user registered and granted
- Filing to a public repository shows a warning and leaves diagnostics out by default

### Development
- Unit tests for the shared logic, Puppeteer E2E (test app + fake GitHub), and GitHub Actions CI
