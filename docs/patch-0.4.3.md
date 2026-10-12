# 0.4.3 release

The [GitHub release](https://github.com/gddddkkkmmnn/mdfier/releases/tag/v0.4.3) was published on 12 October 2026 from `fa8f637c56489e9eb7d7e9f03a1b0117252aa6cf`. Firefox 0.4.3 is approved and available on its public listing. Chrome 0.4.3 has been submitted and awaits review, with automatic publication after approval selected; Chrome’s public version remains 0.4.2 until then.

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

These automated and UI-fixture checks do not constitute installed-browser mail-handler acceptance. On 12 October 2026, the user reported that the local Firefox 0.4.3 extension appeared to work and requested release of the patch. This is a user-reported smoke check; the exact mail handler, short/long document cases and consent-revocation results were not individually recorded. The 0.4.2 browser checks in [verification](verification.md) remain historical evidence, not a run of 0.4.3.

## Installed-browser acceptance checklist

In each browser, capture a page containing a real comment with a reply button and confirm the text and quotes remain. Repeat after reloading the extension without reloading the website. Check a long loaded discussion, Page/Block/Selection, and Preview/Copy/Download. Check Email with a configured mail handler, including the long-document clipboard handoff and accepting, refusing and revoking Firefox optional data consent; do not send the test message. Upload the matching 0.4.3 browser ZIP and reviewer source; do not reuse the approved 0.4.2 package or its checksum. Update store copy and privacy disclosures to describe the explicit email handoff.

## Marketplace evidence on 12 October 2026

- PR #1 was squash-merged into main; the feature branch was removed. The release contains the Chrome/Firefox ZIPs, matching tracked source and SHA-256 record. Main CI passed.
- Chrome accepted the 0.4.3 package. The listing, single-purpose explanation, clipboard permission justification and reviewer test instructions were updated for Email. Submission confirmation and the developer dashboard show awaiting review; automatic publication after approval is enabled.
- Firefox version `6567645`, signed file `5111782`, changed to **Approved** on 12 October. The public listing offers `mdfier_web_to_markdown-0.4.3.xpi` and shows the optional website-content/browsing-activity data declaration. Server validation passed with 0 errors and 7 disclosed innerHTML warnings.
- Firefox listing/release/reviewer notes and its hosted privacy policy were updated. Matching source was uploaded in the submission flow and verified through the version editor’s **View current** source link. Source SHA-256: `317e44190287bcaef643548ae7835a852c35643511742a95a854a39b637fd075`.
- The custom Firefox Add-ons icon was uploaded from `public/icons/128.png` and verified on the public listing. The signed 0.4.3 package was unchanged.

The release archives remain tied to the tagged release commit; this subsequent status documentation does not replace those published assets or claim additional runtime tests.
