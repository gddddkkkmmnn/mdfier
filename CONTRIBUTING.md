# Contributing to mdfier

Thanks for helping improve mdfier. Keep capture local, predictable, and careful with user text.

## Before a change

- Check the existing behavior and tests before changing extraction rules.
- Add a small anonymized fixture for any reported parsing loss or unwanted content.
- Prefer retaining ambiguous page text over deleting it based on a class name alone.
- Keep Page, Block, Selection, and Paste behavior distinct. Block and Selection must retain the scope chosen by the user.
- Do not add remote services, telemetry, automatic clipboard reads, new host access, or site-specific adapters without an explicit product decision.

## Development setup

- Node.js 24 (see `.node-version`) and npm.
- `npm ci` installs the locked toolchain.
- `npm test` runs the unit suite.
- `npm run typecheck` checks TypeScript.
- `npm run verify:parser-lab` verifies 24 and 500 loaded entries in Page and Block.
- `npm run build` builds both browser targets.
- `npm run package:firefox` creates the local Firefox review bundle and source archive.

Please state which commands you ran and whether a check used a real browser or an offline fixture. A jsdom test does not establish Firefox sidebar, clipboard, save-dialog, or performance behavior.

## Pull requests

Keep changes focused. Include the user-visible behavior, regression fixture, and test evidence. Do not include browser profiles, downloaded pages, personal URLs, output archives, `node_modules`, or generated build folders.
