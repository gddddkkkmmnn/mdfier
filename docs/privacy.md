# Privacy

mdfier captures page content only after the user chooses Page, Block, or the selection context-menu command. A paste event handles only content deliberately pasted by the user. The extension does not read the clipboard in the background.

Page text, Markdown drafts, and preferences stay in the browser profile. Drafts are stored per open tab and cleared when the browser starts; language preferences remain. A one-time upgrade can move an older single draft into the active tab so it is not lost during migration. Copy and Download act only after the user selects those actions. No captured content or browsing history is transmitted. mdfier has no AI service, account, server, analytics, or remote conversion service.

Exported Markdown includes the full source URL (including its query and fragment when present) and capture time. Review or remove that metadata before sharing a document if the URL contains private information.

Preview sanitizes rendered Markdown. It does not execute imported HTML or fetch remote images. Page capture uses the loaded main-document DOM. Form values, hidden content, images, iframe contents, Shadow DOM, canvas, and media are excluded. Some web apps put useful content in unsupported embedded regions; mdfier warns when it detects those regions.

## Firefox permissions

| Permission | Why it is needed |
|---|---|
| `<all_urls>` host access | Capture a page or chosen block from the open sidebar on ordinary websites. The content is read only after the user invokes capture. |
| `scripting` | Install the local capture and block-picker handler in the current page after a user action. |
| `storage` | Save tab drafts, pending capture routing, and language preference locally. |
| `contextMenus` | Offer **Capture selection as Markdown** when text is selected. |
| `downloads` | Save the Markdown file requested by the user and detect whether a download completed or was canceled. |
| `clipboardWrite` | Copy Markdown after the user presses **Copy Markdown**. |

Firefox's `data_collection_permissions` declares `required: ["none"]`. The host permission is broad because Page and Block must work across the sites the user chooses; protected browser pages remain unavailable. There is no clipboard-read permission.

Uninstalling the extension or clearing browser-profile data can remove local drafts. Firefox's temporary developer installation is removed when the browser restarts.
