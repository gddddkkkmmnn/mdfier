# Chrome Web Store preparation

Release: **0.4.2 MVP**. Consult [verification](verification.md) for local acceptance evidence; Chrome Web Store approval is a separate step.

## Listing

- **Name from the package:** mdfier
- **Summary from the package:** Turn pages, selections and clipboard text into Markdown, locally.
- **Single purpose:** Convert user-chosen web content into an editable Markdown document.
- **Description:** Capture a loaded page, pick one block, save a text selection from its context menu, or paste copied content. Edit and preview the Markdown, copy it, or download a UTF-8 file. Keep separate working drafts for open tabs. English and Ukrainian interfaces. No account, AI service, analytics, or upload.
- **Support:** https://github.com/gddddkkkmmnn/mdfier/issues
- **Privacy policy:** https://github.com/gddddkkkmmnn/mdfier/blob/main/docs/privacy.md (must be publicly accessible before submission).

## Privacy and permissions

No user data is transmitted to the developer or a third party. Page contents and drafts are processed locally. Explain local draft storage accurately; do not imply that mdfier never reads page content.

Disclose local handling of website content and the captured source URL, including deliberately pasted or edited content. Chrome requires disclosure even when information stays on the device. The public privacy policy includes the Limited Use statement. Match the dashboard's current category definitions to this behavior rather than declaring that the extension handles no data.

| Permission | Justification |
| --- | --- |
| `<all_urls>` | User-invoked Page, Block, and Selection capture on ordinary websites, including when the sidebar is already open. |
| `scripting` | Install the capture handler on the chosen page when capture is requested. |
| `storage` | Store per-tab working drafts, pending imports, and language preference. |
| `contextMenus` | Offer Capture selection as Markdown on selected text. |
| `downloads` | Save a Markdown file following an explicit Download action. |
| `clipboardWrite` | Copy Markdown following an explicit Copy action. No clipboard-read permission. |
| `sidePanel` | Display the editor alongside the current page. |

All executable code is bundled locally. No remote hosted code, external API, or dynamic code download is used.

## Submission

1. Use Node 24, run `npm ci`, tests, typecheck, parser-lab, then `npm run release`.
2. Load `../mdfier-chrome-unpacked` at `chrome://extensions` and follow the [release verification](verification.md), including the native toolbar, clipboard and Save dialog checks.
3. Upload `../mdfier-0.4.2-chrome.zip`. Keep the source archive and SHA-256 record with this release.
4. Supply the genuine Chrome screenshots in `assets/screenshots/`, the 128px icon in `public/icons/128.png`, and the promotional artwork in `assets/store/`.
5. Complete the dashboard's privacy disclosures and permission justifications. Check the public privacy/support links.
6. Submit after the dashboard disclosures, account verification and listing fields are complete. Store approval is a separate review and is not implied by a successful build.

Official references: [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies), [review process](https://developer.chrome.com/docs/webstore/review-process).

## Marketplace status

Version **0.4.2 is published** at the [public Chrome Web Store listing](https://chromewebstore.google.com/detail/mdfier/lijohkibeolboenfibbehganjcllmlll), verified on 9 October 2026. The listing shows an update date of 1 October 2026; the exact approval date was not checked in the developer dashboard. The public card includes the genuine icon and screenshots, description, privacy disclosures and support link.

The release was submitted on 29 September 2026 with automatic publication after approval selected. Permission justifications, local data handling disclosures and reviewer instructions were supplied. The developer dashboard currently requests a renewed Google sign-in; this is not needed to verify the live public listing.

## Upcoming 0.4.3 update — not submitted

Keep the 0.4.2 notes above as historical submission evidence. For 0.4.3, use the matching package/source archive and [patch verification](patch-0.4.3.md).

Add to the listing: **Share the current Markdown document via Email. mdfier opens a compose draft in your configured mail app or webmail handler with the document name and exported text, including its source/date. Long documents offer Copy & open email for pasting the full text. No mail account connection, recipient selection, attachment or automatic sending.**

Replace any blanket “no third-party transmission” statement: capture and conversion stay local, and no document is sent to the developer or a conversion server. The optional Email action hands the chosen document to the configured mail handler, which may autosave it according to the mail provider's own policy. Update the store dashboard privacy disclosures to match this behavior and the updated privacy policy. `clipboardWrite` also serves the explicit Copy & open email action.
