# Verification record — mdfier 0.4.2 MVP

Verified on macOS with Node.js 24.21.0, Firefox 156.0.1 and Chrome for Testing 154.0.8037.57. Browser runs used isolated profiles and the installed production bundles. Local acceptance was completed on 29 September 2026. This record does not imply store approval.

## Automated checks

- 93 unit tests pass, including synchronous toolbar handling in both browser branches, tab isolation, stale imports, conversion and sanitization.
- TypeScript and the offline parser lab pass: 24/500 records, with and without landmarks, in Page and Block.
- Chrome and Firefox builds share byte-identical panel HTML/JS/CSS, capture code and icons.
- Extracting the reviewer source ZIP into a fresh directory, running `npm ci` under Node 24 and `npm run build` reproduced all 12 files of each browser bundle byte-for-byte.
- Firefox AMO lint: 0 errors, 0 notices, 7 `UNSAFE_VAR_ASSIGNMENT` warnings. The bounded HTML insertion cases and sanitization are documented for reviewers in [Firefox review preparation](firefox-review.md); these are disclosed warnings, not silently suppressed.
- Dependency audit reported no known vulnerabilities. This does not prove the absence of all vulnerabilities.
- Repository hygiene checks exclude common credential formats and private local paths. Generated packages, dependencies, profiles and private page captures are not tracked. MIT and third-party notices are present.

## Installed Firefox

Passed: a trusted click on the native toolbar button opens the sidebar; Page retains 24/24 and 500/500 records and the final paragraph; navigation is removed; Preview → Clear returns focus to Paste; typed Markdown creates a draft; two tab drafts stay separate; clearing one leaves the other intact; EN/UK switches; Copy writes the expected Markdown to the system clipboard; Block selects the exact text with parent/back and Escape; the native selection context menu captures the selected text; extension reload followed by Page works without reloading the website; protected-page errors preserve the draft.

Article and documentation fixtures preserve headings, quotes, lists, code, tables and useful links. Empty captures preserve the existing document; switching to Paste does not erase it.

320px sidebar checks pass in EN/UK and light/dark with no horizontal overflow. The screenshot was visually inspected. The 500-record capture completed in approximately 0.52–0.55 seconds in these smoke runs, including automation overhead. This is a fixture result, not a performance guarantee for all sites.

## Installed Chrome for Testing

Passed in the real side panel: Page retains 24/24 and 500/500 records and the final paragraph; navigation is removed; Preview/Clear restores paste focus; typed Markdown, tab isolation, Block trusted click and Escape work; EN/UK and light/dark at 320px have no horizontal overflow. The dark Ukrainian screenshot was visually inspected. The 500-record capture took approximately 0.52–0.53 seconds in this smoke run.

Additional checks pass: formatted HTML paste, preservation of article/documentation structure, empty-capture draft retention, and actual UTF-8 download contents using an automation-selected destination. A denied download reports an error and retains the document.

The automated harness opens the side panel through an extension-page CDP user gesture. Separately, a trusted click on the pinned toolbar icon in a regular Chrome profile opened the panel and captured the documentation fixture. The final accessibility build was also exercised through Chrome for Testing’s native extensions menu; its Markdown editor is exposed as an editable text field.

Reproduce these checks with [the installed-browser test scripts](browser-testing.md). Reports are local artifacts under `dist/qa/`, excluded from Git. Selected genuine Firefox screenshots are published in `assets/screenshots/`.

## Native OS and window checks

In ordinary Firefox and Chrome profiles: HTML clipboard paste preserved headings, emphasis, lists and Ukrainian text; editor Undo/Redo worked; Copy followed by Paste reproduced the Markdown; the native Save dialog opened; cancelling retained the document; actual exported files contained the expected UTF-8 Markdown bytes. These were manual checks, separate from the scripted downloads.

The final Firefox isolated run also passed two-window capture: each window used its active tab’s own draft, and closing the second window preserved the first. The same flow passed with native input in Chrome for Testing. After an explicit quit and fresh launch of its isolated Chrome profile, the sidebar started empty and kept the selected Ukrainian language. The shared background startup cleanup is unit-tested; Firefox’s unsigned temporary installation disappears on restart, so persistent Firefox restart acceptance needs the AMO-signed package.

Genuine Firefox and Chrome screenshots are in `assets/screenshots/`. The Chrome smoke harness waits for two animation frames before pointer input and emits diagnostics on failure. Native menu tests should run sequentially because starting another browser can steal focus.

## Store submission

Browser ZIPs, matching reviewer source, SHA-256 checksums, icons, real screenshots, promotional artwork, privacy text and listing/reviewer notes are prepared. Developer registration, any required agreements, marketplace disclosures, upload validation and store review remain external steps. Track actual marketplace status separately; do not describe the extension as store-approved before approval.

## Scope limits

Capture reads the loaded, visible main-document DOM. It does not parse PDFs, follow links, scroll to load more content, or read iframe, Shadow DOM, canvas, media, or form values. Images are not inserted into Markdown. Browser-internal pages are protected. Merged tables may be simplified. See [Privacy](privacy.md) and [extraction rules](semantic-extraction.md).
