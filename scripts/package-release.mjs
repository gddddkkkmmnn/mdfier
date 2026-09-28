import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = resolve(project, '..');
const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
const version = pkg.version;

function run(script) {
  const result = spawnSync('npm', ['run', script], { cwd: project, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`npm run ${script} failed`);
}

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertManifest(path, browser) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.version !== version || manifest.manifest_version !== 3) throw new Error(`${browser} manifest has the wrong version`);
  if (!manifest.host_permissions?.includes('<all_urls>') || manifest.permissions?.includes('activeTab')) throw new Error(`${browser} manifest has stale page permissions`);
  if (browser === 'chrome' && !manifest.side_panel) throw new Error('Chrome side panel is missing');
  if (browser === 'firefox' && !manifest.sidebar_action) throw new Error('Firefox sidebar is missing');
  if (!manifest.action || manifest.action.default_popup) throw new Error(`${browser} toolbar entry point is missing or intercepted by a popup`);
  if (browser === 'firefox' && (manifest.browser_specific_settings?.gecko?.id !== 'mdfier@gddddkkkmmnn' || !manifest.browser_specific_settings.gecko.data_collection_permissions?.required?.includes('none'))) throw new Error('Firefox identity or privacy declaration mismatch');
}

function assertSharedFiles(chrome, firefox) {
  const chromePanel = readFileSync(join(chrome, 'panel.html'), 'utf8');
  const firefoxPanel = readFileSync(join(firefox, 'panel.html'), 'utf8');
  if (chromePanel !== firefoxPanel) throw new Error('Chrome and Firefox panel HTML differ');
  const references = [...chromePanel.matchAll(/(?:src|href)="\/([^"?]+)["?]/g)].map((match) => match[1]);
  const shared = ['content-scripts/capture.js', ...references, ...readdirSync(join(chrome, 'icons')).map((name) => `icons/${name}`)];
  for (const relative of new Set(shared)) {
    const left = join(chrome, relative);
    const right = join(firefox, relative);
    if (!existsSync(left) || !existsSync(right) || sha(left) !== sha(right)) throw new Error(`Browser builds differ at ${relative}`);
  }
}

function assertBundledReadability(build) {
  const capture = readFileSync(join(build, 'content-scripts', 'capture.js'), 'utf8');
  if (!capture.includes('First argument to Readability')) throw new Error('Mozilla Readability was not bundled into the capture script');
}

run('zip');
const sourceArchive = spawnSync(process.execPath, ['scripts/create-source-archive.mjs', join(project, '.output', `mdfier-${version}-sources.zip`)], { cwd: project, stdio: 'inherit' });
if (sourceArchive.status !== 0) throw new Error('Could not create the tracked-source archive.');

const chromeBuild = join(project, '.output', 'chrome-mv3');
const firefoxBuild = join(project, '.output', 'firefox-mv3');
assertManifest(join(chromeBuild, 'manifest.json'), 'chrome');
assertManifest(join(firefoxBuild, 'manifest.json'), 'firefox');
assertSharedFiles(chromeBuild, firefoxBuild);
assertBundledReadability(chromeBuild);
assertBundledReadability(firefoxBuild);

const generatedChrome = join(project, '.output', `mdfier-${version}-chrome.zip`);
const generatedFirefox = join(project, '.output', `mdfier-${version}-firefox.zip`);
const generatedSources = join(project, '.output', `mdfier-${version}-sources.zip`);
if (!existsSync(generatedChrome) || !existsSync(generatedFirefox) || !existsSync(generatedSources)) throw new Error('WXT release archives are missing');

mkdirSync(outputs, { recursive: true });
const chromeUnpacked = join(outputs, 'mdfier-chrome-unpacked');
const firefoxUnpacked = join(outputs, 'mdfier-firefox-unpacked');
const chromeZip = join(outputs, basename(generatedChrome));
const firefoxZip = join(outputs, basename(generatedFirefox));
const sourcesZip = join(outputs, basename(generatedSources));
for (const path of [chromeUnpacked, firefoxUnpacked]) rmSync(path, { recursive: true, force: true });
cpSync(chromeBuild, chromeUnpacked, { recursive: true });
cpSync(firefoxBuild, firefoxUnpacked, { recursive: true });
cpSync(generatedChrome, chromeZip);
cpSync(generatedFirefox, firefoxZip);
cpSync(generatedSources, sourcesZip);

// Both packaging commands refresh the same builds, after all checks pass.
const amo = join(project, 'dist', 'firefox');
rmSync(amo, { recursive: true, force: true });
mkdirSync(amo, { recursive: true });
cpSync(firefoxBuild, join(amo, 'unpacked'), { recursive: true });
cpSync(generatedFirefox, join(amo, `mdfier-${version}.zip`));
cpSync(generatedSources, join(amo, `mdfier-${version}-source.zip`));
writeFileSync(join(amo, 'SHA256SUMS.txt'), `${sha(generatedFirefox)}  mdfier-${version}.zip\n${sha(generatedSources)}  mdfier-${version}-source.zip\n`);

writeFileSync(join(outputs, 'SHA256SUMS.txt'), [
  `${sha(chromeZip)}  ${basename(chromeZip)}`,
  `${sha(firefoxZip)}  ${basename(firefoxZip)}`,
  `${sha(sourcesZip)}  ${basename(sourcesZip)}`,
  '',
].join('\n'));

// Retire only older mdfier release archives after the new packages are complete.
for (const name of readdirSync(outputs)) {
  const match = /^mdfier-(\d+\.\d+\.\d+)-(?:chrome|firefox|source|sources)\.zip$/.exec(name);
  if (match && match[1] !== version) rmSync(join(outputs, name));
}
console.log(`Packaged mdfier ${version}:`);
console.log(`- ${chromeUnpacked}`);
console.log(`- ${firefoxUnpacked}`);
console.log(`- ${chromeZip}`);
console.log(`- ${firefoxZip}`);
console.log(`- ${sourcesZip}`);
