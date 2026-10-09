# 0.4.3 patch candidate

The published MVP remains 0.4.2. This patch has not been submitted to either store.

## Change

A Page capture could discard an entire authored comment, profile or related section if it contained a reply button. Capture now removes these ambiguous regions only when they consist entirely of controls or a recognized sign-in prompt. Short comments, quotes, useful links and complete loaded discussions survive. Large or uncertain regions are kept; the additional check is bounded and does not introduce a page-wide scoring pass.

The capture protocol changes from 8 to 9 so the next capture after an extension update reinjects the new handler into an already-open tab. Permissions, dependencies, UI and local-only processing remain the same.

## Verification on 9 October 2026

- 98 tests pass under Node.js 24.19.0. Regression tests cover comments, related sections, profiles, Ukrainian sign-in UI and 500 loaded comments in source order.
- TypeScript checks pass.
- Offline parser-lab keeps all 24/500 records, in order, in Page and Block, with and without main/article landmarks.
- Release packaging checks shared panel and capture files for byte equality between Chrome and Firefox.

These are automated/offline checks. Installed-browser acceptance for this patch is still pending; the 0.4.2 browser checks in [verification](verification.md) are historical evidence, not a run of 0.4.3.

## Before store submission

In each browser, capture a page containing a real comment with a reply button and confirm the text and quotes remain. Repeat after reloading the extension without reloading the website. Check a long loaded discussion, Page/Block/Selection, and Preview/Copy/Download. Upload the matching 0.4.3 browser ZIP and reviewer source; do not reuse the approved 0.4.2 package or its checksum.
