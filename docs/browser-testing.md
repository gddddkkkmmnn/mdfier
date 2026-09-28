# Installed-browser smoke tests

These optional developer tests install the built extension in a **temporary, isolated browser profile**. They serve anonymized local fixtures, exercise the installed extension, and close the browser afterward. They do not access your regular browser profile.

## Setup

Build first with `npm run release`. Use Python 3.10+ and installed Firefox; use Chrome for Testing for Chrome automation, since branded Chrome restricts command-line extension loading.

```sh
python3 -m venv .venv
.venv/bin/pip install selenium==4.36.0 websocket-client==1.8.0
.venv/bin/python scripts/verify-firefox.py
MDFIER_CHROME_BINARY="/path/to/Chrome for Testing" .venv/bin/python scripts/verify-chrome.py
```

Selenium Manager may download a matching driver on first use. Python/browser automation dependencies are developer tools, not extension runtime dependencies.

Reports and screenshots are written under ignored `dist/qa/`. Firefox runs with geckodriver's `--allow-system-access` **only in its temporary profile** so the harness can click the real toolbar button and inspect the sidebar. Its document controls are driven through Firefox's privileged test bridge; Block selection uses trusted WebDriver page input. Chrome drives the installed side panel through CDP; opening uses an extension-page user gesture, so its native toolbar click remains a separate manual check.

## Optional clipboard test

`MDFIER_TEST_CLIPBOARD=1 .venv/bin/python scripts/verify-firefox.py` additionally clicks Copy and verifies the actual system clipboard. This intentionally replaces the clipboard with the test document; omit the flag to leave it untouched.

## Scope

Covered: 24/500 loaded records, text completeness, removal of navigation, Preview/Clear and paste focus, typed Markdown, separate tab drafts, Block and Escape, EN/UK, light/dark and 320px layout. Both browsers also verify article/documentation formatting, exact record order and retention of the current document after empty captures. Chrome additionally checks formatted HTML paste, UTF-8 downloads to an automation-selected directory, and failed-download draft retention. Firefox additionally checks the native toolbar, native selection context menu, extension reload without page reload, and a protected-page error that retains the document.

These are smoke tests, not an assertion that every website or OS integration works. The [verification record](verification.md) also records separate native Save dialog, clipboard, undo/redo and multi-window checks. Run the two smoke scripts sequentially: browser-native menus can lose focus when another browser starts. Neither script changes store listings or installs into the user's normal profile.
