// Offline DOM benchmark. Does not install an extension, fetch pages or execute page scripts.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const temporary = mkdtempSync(join(tmpdir(), 'mdfier-benchmark-'));
await build({ entryPoints: ['lib/extract.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'capture.mjs') });
await build({ entryPoints: ['lib/conversion.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'convert.mjs') });
const { extractPageCaptureTimed } = await import(pathToFileURL(join(temporary, 'capture.mjs')).href);
const { convertCapture } = await import(pathToFileURL(join(temporary, 'convert.mjs')).href);
const cases = [24, 500].map(count => ({
  name: `feed-${count}`, count, html: '<h1>Community</h1><div>' + Array.from({ length: count }, (_, i) => `<article class="review-card"><h2><a href="/game">Review ${i}</a></h2><div><div><div><div><p>Useful loaded review number ${i}, preserve all the text and details.</p></div></div></div></div></article>`).join('') + '</div>',
}));
if (process.argv[2]) cases.push({ name: 'supplied-public-html', html: readFileSync(process.argv[2], 'utf8') });
const results = [];
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)];
for (const sample of cases) {
  const dom = new JSDOM(sample.html, { url: 'https://example.test/' });
  Object.assign(globalThis, { Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DOMParser: dom.window.DOMParser });
  let styleReads = 0;
  const style = dom.window.getComputedStyle.bind(dom.window);
  dom.window.getComputedStyle = element => { styleReads++; return style(element); };
  // One warmup plus ten Page+conversion measurements. The same loaded DOM is
  // intentionally reused: this is the repeat-capture case that matters for
  // responsiveness. It remains an offline jsdom benchmark, not browser UX.
  await extractPageCaptureTimed(dom.window.document);
  const measurements = [];
  let markdown = '';
  for (let run = 0; run < 10; run++) {
    const start = performance.now();
    const captured = await extractPageCaptureTimed(dom.window.document);
    const extracted = performance.now();
    markdown = convertCapture(captured.payload).markdown;
    measurements.push({ snapshotMs: captured.timing.snapshotMs, normalizationMs: captured.timing.normalizationMs,
      conversionMs: performance.now() - extracted, totalMs: performance.now() - start });
  }
  const summarize = key => ({ medianMs: Math.round(median(measurements.map(item => item[key]))), p95Ms: Math.round(p95(measurements.map(item => item[key]))) });
  results.push({ name: sample.name, runs: measurements.length, elements: dom.window.document.querySelectorAll('*').length, styleReads,
    snapshot: summarize('snapshotMs'), normalization: summarize('normalizationMs'), conversion: summarize('conversionMs'), total: summarize('totalMs'),
    allItemsRetained: sample.count === undefined ? null : Array.from({ length: sample.count }, (_, i) => markdown.includes(`Useful loaded review number ${i},`)).every(Boolean),
    markdownCharacters: markdown.length, headingCount: (markdown.match(/^#{1,6} .+/gm) || []).length,
    headings: sample.count === undefined ? markdown.match(/^#{1,6} .+/gm) : undefined,
    emptyLinks: (markdown.match(/\[\s*\]\(/g) || []).length, editLinks: (markdown.match(/\[edit\]\(/g) || []).length });
  dom.window.close();
}
console.log(JSON.stringify({ environment: `Offline jsdom, Node ${process.version}; no external CSS, images or scripts loaded. Timings are not live Firefox measurements.`, results }, null, 2));
