# Firefox Add-ons (AMO) review preparation

Release: **0.4.2 MVP**. Store submission status is separate from the local [verification record](verification.md).

## Listing copy

**Name**

mdfier — Web to Markdown

**Summary (under 250 characters)**

Capture a page, a useful block, selected text, or pasted content as editable Markdown — locally in Firefox.

**Description**

Turn useful web content into a clean Markdown file with mdfier.

• Capture the loaded page or pick one part of it.
• Capture selected text from the page context menu.
• Paste rich text, plain text, or existing Markdown.
• Edit the result, preview it, copy it, or download a UTF-8 `.md` file.
• Use the sidebar in English or Ukrainian.

mdfier processes captures locally in Firefox. It does not send page content anywhere and does not include an AI service, account, analytics, or background clipboard reading. Website access is used only when you choose to capture a page, block, or selection. Some browser-protected pages and embedded iframe/Shadow DOM content cannot be captured.

**Category**

Web Development (the closest available AMO category for the Markdown capture utility).

**Tags/keywords**

AMO's current fixed tag list offers `download`; this relevant tag is selected. Markdown, capture and export are described in the listing copy.

**Privacy policy URL**

Use `https://github.com/gddddkkkmmnn/mdfier/blob/main/docs/privacy.md`.

**Support URL**

`https://github.com/gddddkkkmmnn/mdfier/issues`

**License**

MIT, matching the root `LICENSE` file. Third-party licenses are supplied in the bundled notices.

**Artwork**

Use the shipped 128px extension mark at `public/icons/128.png` as the source for the AMO icon. Genuine 1280 × 800 Firefox screenshots are in `assets/screenshots/`: preview, Markdown and empty state. Confirm the current upload requirements in AMO. Do not submit design templates or generated mock interfaces as product screenshots.

## Reviewer notes

> mdfier is a local-only Firefox sidebar extension. It has no account or sign-in flow. To test it, open any ordinary public article or documentation page, click the mdfier toolbar icon to open its sidebar, and choose Page. Block opens the element picker; Escape cancels it. Select text and use the page context menu to test Selection. Paste, Copy, and Download run only after explicit user actions.
>
> Page, Block, and Selection require access to the current site. The manifest uses `<all_urls>` so these user-invoked actions work across ordinary websites without asking the user to reopen the toolbar popup on every domain. Browser-internal and other protected pages are unavailable. `clipboardWrite` is used only after Copy; no clipboard-read permission is requested. The manifest declares `data_collection_permissions.required: ["none"]`.
>
> The extension is built with WXT and bundles/minifies local modules. Matching tracked source files, lockfile, tests, and build instructions are supplied in the source archive; generated files and untracked local files are excluded. Build with Node.js 24 and npm using `npm ci` followed by `npm run build`. No network requests are made by capture or conversion at runtime. The AMO validator reports `UNSAFE_VAR_ASSIGNMENT` for `innerHTML` in the following bounded cases: the panel shell uses fixed extension-owned markup; preview HTML is sanitized by DOMPurify with an explicit tag/attribute allowlist before insertion; Readability output is parsed in a detached document created from a visible-DOM snapshot that already excludes scripts, styles, form values, and unsupported embedded nodes. The rendered extension source and tests are included for review.
>
> Third-party source: Mozilla Readability 0.6.0: https://github.com/mozilla/readability/tree/0.6.0 ; Turndown: https://github.com/mixmark-io/turndown ; Turndown GFM: https://github.com/GerHobbelt/turndown-plugin-gfm ; Marked: https://github.com/markedjs/marked ; DOMPurify: https://github.com/cure53/DOMPurify . Exact package versions are in `package-lock.json`; license notices are included in the add-on archive.
>
> Matching source archive: https://github.com/gddddkkkmmnn/mdfier/releases/download/v0.4.2/mdfier-0.4.2-sources.zip . SHA-256: `f2d22abf6bc36cdafb38e30092d50fdd4f1682f93b2e64c93ab288a452d459cf`. A clean Node.js 24 / `npm ci` / `npm run build` rebuild reproduced every browser bundle file byte-for-byte.

## Build and upload

1. Use Node 24, then run `npm ci`, `npm test`, `npm run typecheck`, `npm run verify:parser-lab`, and `npm run package:firefox`.
2. Review the generated manifest and run AMO's current add-on validator on `dist/firefox/mdfier-0.4.2.zip`.
3. Upload the generated source archive alongside the minified/bundled add-on. It contains source code, the lockfile, notices, and reproducible build instructions.
4. Add the exact source links and reviewer notes above. Include the verification record and its scope limits.
5. The manifest declares the stable Gecko ID `mdfier@gddddkkkmmnn`. Confirm that AMO accepts it and that it is available before submitting. If it collides, choose another stable ID before the first submission and keep it unchanged after publication.
6. Select MIT consistently in AMO and the repository, then complete the dashboard disclosures and submit for review.

## Verification status

See the [verification record](verification.md) for automated, installed-browser and native OS evidence. A successful local release does not imply AMO approval.

## Marketplace status

As of 29 September 2026, AMO lists version 0.4.2 as **Awaiting Review**, with the slug `mdfier-web-to-markdown` and stable ID `mdfier@gddddkkkmmnn`. Its server validation passed with 0 errors and 7 disclosed warnings. Listing copy, MIT license, privacy text, support and repository links are saved. Reviewer notes include a direct link to the matching public source archive and its checksum. The archive and genuine product-page images still need to be attached through AMO's upload fields; the submission is not fully prepared for reviewer acceptance until those uploads are complete. Approval and public availability are pending.
