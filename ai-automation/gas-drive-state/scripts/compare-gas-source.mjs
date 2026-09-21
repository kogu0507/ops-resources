import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [canonicalDirArg, pulledDirArg] = process.argv.slice(2);
if (!canonicalDirArg || !pulledDirArg) {
  throw new Error('usage: compare-gas-source.mjs <canonicalDir> <pulledDir>');
}

const canonicalDir = path.resolve(canonicalDirArg);
const pulledDir = path.resolve(pulledDirArg);

const canonicalNames = [
  'Acceptance',
  'Collector',
  'CollectorAcceptance',
  'DriveMutation',
  'LockProbe',
  'MechanicalHealth',
  'Smoke',
  'TriggerPreflight'
];

function normalizeText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n*$/, '\n');
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableJson(value[key])])
    );
  }
  return value;
}

function readScript(dir, base) {
  const candidates = [path.join(dir, base + '.gs'), path.join(dir, base + '.js')];
  const found = candidates.filter(fs.existsSync);
  if (found.length !== 1) {
    throw new Error(`expected exactly one pulled source for ${base}, found ${found.length}`);
  }
  return normalizeText(fs.readFileSync(found[0], 'utf8'));
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

const results = [];
for (const base of canonicalNames) {
  const canonicalPath = path.join(canonicalDir, base + '.gs');
  if (!fs.existsSync(canonicalPath)) throw new Error(`canonical file missing: ${base}.gs`);
  const canonical = normalizeText(fs.readFileSync(canonicalPath, 'utf8'));
  const pulled = readScript(pulledDir, base);
  results.push({
    file: base,
    match: canonical === pulled,
    canonicalSha256: hash(canonical),
    pulledSha256: hash(pulled)
  });
}

const canonicalManifest = stableJson(JSON.parse(fs.readFileSync(path.join(canonicalDir, 'appsscript.json'), 'utf8')));
const pulledManifest = stableJson(JSON.parse(fs.readFileSync(path.join(pulledDir, 'appsscript.json'), 'utf8')));
const canonicalManifestText = JSON.stringify(canonicalManifest);
const pulledManifestText = JSON.stringify(pulledManifest);
results.push({
  file: 'appsscript.json',
  match: canonicalManifestText === pulledManifestText,
  canonicalSha256: hash(canonicalManifestText),
  pulledSha256: hash(pulledManifestText)
});

const allowedPulled = new Set([
  'appsscript.json',
  ...canonicalNames.flatMap(name => [name + '.gs', name + '.js'])
]);
const unexpected = fs.readdirSync(pulledDir)
  .filter(name => !allowedPulled.has(name))
  .sort();

const mismatches = results.filter(x => !x.match);
const status = mismatches.length === 0 && unexpected.length === 0 ? 'MATCH' : 'DRIFT';

console.log(JSON.stringify({
  status,
  comparedFiles: results.length,
  mismatches,
  unexpectedPulledFiles: unexpected
}, null, 2));

if (status !== 'MATCH') process.exit(1);
