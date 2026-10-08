# Privacy Policy (github-feedback)

Last updated: 2026-10-08

github-feedback ("the extension") is a Chrome extension for writing comments while checking a web page and filing them as GitHub Issues. It is an unofficial tool and is not affiliated with GitHub, Inc.

## Information the extension handles

The extension handles the following information only when the user starts comment mode and clicks the button to open the issue.

| Information | Details | Purpose |
|---|---|---|
| Website content | A screenshot of the visible page; the CSS selector, text, and an HTML snippet of the selected element; the page title | To include it in the issue body |
| Web history (URL of the current page) | The URL of the page displayed when filing | To include it in the issue body |
| Diagnostics | Console errors/warnings, uncaught exceptions, and URLs of failed requests, only on hosts the user registered and granted in the settings page | To include it in the issue body (the user chooses whether to include it when filing) |
| Settings | Target repositories, host patterns, environment names, labels | To route issues to the right repository |

Before anything is placed into the issue body, values that look like secrets (tokens, passwords, signed URLs, API keys, email addresses, and so on) in URLs, logs, and HTML are redacted. Redaction is not perfect, so please review the content on GitHub before submitting.

## Where information is sent

- The information above is only filled into the new-issue page of the GitHub instance the user configured (github.com or GitHub Enterprise Server), at the moment the user takes the action. The user creates (submits) the issue themselves.
- The screenshot is uploaded through GitHub's regular image attachment mechanism when it is attached to the new-issue page.
- To check whether the target repository is public, the extension queries the GitHub API (api.github.com, or the GitHub Enterprise Server API) for the repository name without authentication.
- No information is ever sent to the developer or to any third-party server. The extension uses no analytics and no advertising.

## Storage

- Settings are stored in `chrome.storage.sync` (synced through the user's Google account if Chrome sync is enabled).
- The body and screenshot to be filled into the new-issue page are kept temporarily in `chrome.storage.session` (in browser memory) and deleted once they are filled in, or after 10 minutes.
- Diagnostics are kept in the page's memory, for recent events only, while a page on a registered host is open.

## Limited use

Information handled by the extension is used only for the purpose above (filing issues). It is never sold, and never used for advertising, creditworthiness, or any other purpose. The extension complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Permissions

| Permission | Reason |
|---|---|
| activeTab | To show comment mode in the tab where the icon or shortcut was used, and to capture that tab |
| scripting | To show comment mode, fill the body into the new-issue page, and register error recording |
| storage | To store settings, and to keep data temporarily until it is filled into the new-issue page |
| github.com / api.github.com | To fill the new-issue page and to check whether the repository is public |
| Any host (granted individually by the user) | To record errors on hosts the user registered, and to support GitHub Enterprise Server |

## Contact

For questions about this policy, please contact:

- Email: syuniti0617@gmail.com
- GitHub: https://github.com/ShunichirouKamino/github-feedback-chrome/issues
