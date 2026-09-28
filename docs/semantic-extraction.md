# Page extraction

mdfier has two local paths for a Page capture:

1. It makes one snapshot of the currently visible, loaded light DOM. Hidden regions, scripts, form values, images, media, extension UI, and unsupported embedded content are excluded. The page itself is not modified.
2. A deliberately narrow route sends a detached safe snapshot to Mozilla Readability for a single article-like page. The route is skipped for catalogs, feeds, long lists, code-heavy pages, tables, definition lists, and oversized snapshots.
3. Before accepting Readability output, mdfier checks that the candidate keeps the article's meaningful text and contentful branches elsewhere in the selected page. If not, it uses the fuller conservative structure.
4. A local Turndown/GFM converter formats headings, lists, links, tables, quotes, code and supported card metadata as Markdown.

The rule favors retaining useful page material when the structure is uncertain. `Block` captures the user's chosen element without searching for a different main section. `Selection` captures only the selected range. Neither uses Readability.

## Implementation

Mozilla Readability 0.6.0 is vendored locally under Apache-2.0. Its route is skipped for snapshots over 1,800 elements and structured content better handled by the conservative converter. Acceptance checks cover neighboring content branches as well as article headings and paragraphs. CSS names such as `profile`, `comments`, and `related` alone do not justify deleting text. See [vendor notes](../lib/vendor/README.md).

Code blocks retain indentation and use a fence long enough to protect literal Markdown fences in the source. Capture work is bounded by the limits in `lib/capture-limits.ts`.

## Limits

The extension does not fetch the page, load resources, follow links, autoscroll, read iframe contents, enter Shadow DOM, or inspect canvas. Long lists include only items already loaded in the page. Sites can change markup at any time, so no heuristic can guarantee that every page converts perfectly; edit the Markdown or pick a smaller block when needed.

## Tests

Run `npm test` for semantic, conversion and state regressions. Run `npm run verify:parser-lab` to verify full order and tail retention for 24 and 500 loaded entries, with and without `main/article` landmarks. Run `npm run benchmark:offline` for repeatable jsdom timings; these timings do not represent real Firefox performance. Current candidate results and their limits are in [verification](verification.md).
