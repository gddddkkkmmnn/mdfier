import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? '');
const relativeOutput = relative(project, output);
if (!relativeOutput || relativeOutput.startsWith(`..${sep}`) || relativeOutput === '..' || relativeOutput.split(sep).includes('.git')) {
  throw new Error('Source archive output must be a file inside the project directory.');
}

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: project, encoding: 'buffer' });
if (tracked.status !== 0) throw new Error('Create the source archive from a Git checkout.');
const excluded = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials?(?:[._-].*)?|secrets?(?:[._-].*)?)(?:\/|$)|\.(?:pem|p12|pfx|key|log|sqlite|db)$/i;
const generated = /^(?:\.git|node_modules|\.output|dist|coverage|outputs)(?:\/|$)/;
const files = tracked.stdout.toString('utf8').split('\0').filter(Boolean).filter((path) => {
  if (generated.test(path) || excluded.test(path) || /[\r\n]/.test(path) || !existsSync(resolve(project, path))) return false;
  return lstatSync(resolve(project, path)).isFile();
});
if (!files.length) throw new Error('No tracked source files are available for the archive.');

mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
const result = spawnSync('zip', ['-X', '-q', '-@', output], {
  cwd: project,
  input: `${files.join('\n')}\n`,
  encoding: 'utf8',
});
if (result.status !== 0) throw new Error(result.stderr || 'Could not create the source archive; install the standard zip utility.');

const listing = spawnSync('unzip', ['-Z1', output], { encoding: 'utf8' });
if (listing.status !== 0) throw new Error('Could not verify the source archive.');
const archived = new Set(listing.stdout.split('\n').filter(Boolean));
const missing = files.filter((path) => !archived.has(path));
if (missing.length) throw new Error(`Source archive is missing tracked files: ${missing.slice(0, 5).join(', ')}`);
const leaked = [...archived].find((path) => generated.test(path) || excluded.test(path));
if (leaked) throw new Error(`Generated or private file found in source archive: ${leaked}`);
console.log(`Created source archive with ${files.length} tracked files: ${output}`);
