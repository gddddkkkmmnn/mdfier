# Vendored Mozilla Readability

`mozilla-readability.js` is the `Readability.js` file from the official
`@mozilla/readability` **0.6.0** npm archive. Its npm tarball SHA-1
is `134e3ce3ff1676716e550de0b8de957bcc59208b`; the upstream license is
Apache-2.0 and is included as `MOZILLA_READABILITY_LICENSE.md`.

The sole source change is its final CommonJS export, replaced with an ESM
export so WXT bundles it into the browser content script. The project
deliberately vendors this browser-side dependency so both extension bundles
are self-contained. `lib/readability.ts` is the only local adapter and
supplies a pre-sanitized detached DOM. LLMFeeder commit
`32f0f8b27d8bede59e886a63c81736c02f266747` informed the evaluation but no
LLMFeeder source is present here.
