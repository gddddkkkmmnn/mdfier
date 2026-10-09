# 0.4.3 patch candidate

The published MVP remains 0.4.2. This patch has not been submitted to either store.

## Change

Email opens a compose draft through the configured mail handler, using the current document name and the same Markdown export as Preview, Copy and Download. No recipient, connector, attachment or automatic send is supplied. The mailto URL uses encoded UTF-8 text and CRLF line breaks. A conservative 1,800-character encoded-link budget selects the explicit **Copy & open email** fallback; it is an interoperability choice, not a claim that every mail app has this exact limit. The full document is copied only after that second action. Pending clipboard work cannot open an old message after Clear or a tab/document switch.

A Page capture could discard an entire authored comment, profile or related section if it contained a reply button. Capture now removes these ambiguous regions only when they consist entirely of controls or a recognized sign-in prompt. Short comments, quotes, useful links and complete loaded discussions survive. Large or uncertain regions are kept; the additional check is bounded and does not introduce a page-wide scoring pass.

The capture protocol changes from 8 to 9 so the next capture after an extension update reinjects the new handler into an already-open tab. Host/API permissions and dependencies remain the same. Firefox declares optional `websiteContent` and `browsingActivity` transmission permissions for Email and requests them from the Email action before any clipboard or mail handoff; refusal leaves the document and all local features available. Chrome has no new permissions. The panel adds a compact Email action and a long-document handoff; privacy text explains the user-requested mail handoff.

## Verification on 9–10 October 2026

- All 119 unit tests pass. Extraction regression tests cover comments, related sections, profiles, Ukrainian sign-in UI and 500 loaded comments in source order. Email tests cover current edits, Preview, UTF-8 text, safe header encoding, full-text clipboard handoff, cancellation, empty documents, failures and EN/UK labels.
- TypeScript checks pass.
- The actual panel code was checked at 320 px in a local browser UI fixture, in EN/UK and light/dark themes. The long-document action fits without horizontal overflow. Mail opening and clipboard writes were simulated in that fixture; this is not installed-browser mail-handler acceptance.
- Offline parser-lab keeps all 24/500 records, in order, in Page and Block, with and without main/article landmarks.
- Release packaging checks shared panel and capture files for byte equality between Chrome and Firefox.

These are automated/offline checks. Installed-browser acceptance for this patch is still pending; the 0.4.2 browser checks in [verification](verification.md) are historical evidence, not a run of 0.4.3.

## Before store submission

In each browser, capture a page containing a real comment with a reply button and confirm the text and quotes remain. Repeat after reloading the extension without reloading the website. Check a long loaded discussion, Page/Block/Selection, and Preview/Copy/Download. Check Email with a configured mail handler, including the long-document clipboard handoff and accepting, refusing and revoking Firefox optional data consent; do not send the test message. Upload the matching 0.4.3 browser ZIP and reviewer source; do not reuse the approved 0.4.2 package or its checksum. Update store copy and privacy disclosures to describe the explicit email handoff.
