import fs from 'node:fs';
import path from 'node:path';

const projectFile = process.argv[2];
const expectedScriptId = process.env.EXPECTED_SCRIPT_ID;
const expectedRootDir = process.env.EXPECTED_ROOT_DIR || 'src';

if (!projectFile) throw new Error('project file path required');
if (!expectedScriptId) throw new Error('EXPECTED_SCRIPT_ID missing');

const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));

if (project.scriptId !== expectedScriptId) {
  throw new Error('TARGET_MISMATCH: project scriptId does not match independently configured EXPECTED_SCRIPT_ID');
}
if (project.rootDir !== expectedRootDir) {
  throw new Error(`ROOTDIR_MISMATCH: expected ${expectedRootDir}, got ${project.rootDir}`);
}

const allowedProjectKeys = new Set(['scriptId','rootDir']);
for (const key of Object.keys(project)) {
  if (!allowedProjectKeys.has(key)) throw new Error(`unexpected clasp project key: ${key}`);
}

const root = path.resolve(expectedRootDir);
const allowedFiles = new Set([
  path.resolve(root, 'appsscript.json'),
  path.resolve(root, 'Smoke.gs'),
  path.resolve(root, 'Acceptance.gs')
]);

const discovered = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else discovered.push(full);
  }
}
walk(root);

for (const file of discovered) {
  if (!allowedFiles.has(file)) throw new Error(`UNEXPECTED_PUSH_FILE: ${path.relative(process.cwd(), file)}`);
}
for (const file of allowedFiles) {
  if (!fs.existsSync(file)) throw new Error(`MISSING_PUSH_FILE: ${path.relative(process.cwd(), file)}`);
}

console.log('deploy target preflight PASS');
console.log(JSON.stringify({
  scriptIdVerified: true,
  rootDir: project.rootDir,
  pushFiles: [...allowedFiles].map(f => path.relative(process.cwd(), f))
}, null, 2));
