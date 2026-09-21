import fs from 'node:fs';
import path from 'node:path';

const [inputFile, workDir] = process.argv.slice(2);
if (!inputFile || !workDir) {
  throw new Error('usage: prepare-drift-project.mjs <input-project> <workDir>');
}

const project = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const keys = Object.keys(project).sort();
const expectedKeys = ['rootDir', 'scriptId'];
if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
  throw new Error('unexpected clasp project keys');
}
if (typeof project.scriptId !== 'string' || !project.scriptId.trim()) {
  throw new Error('scriptId missing');
}

const absoluteWorkDir = path.resolve(workDir);
fs.rmSync(absoluteWorkDir, {recursive: true, force: true});
fs.mkdirSync(absoluteWorkDir, {recursive: true});
fs.writeFileSync(
  path.join(absoluteWorkDir, '.clasp.json'),
  JSON.stringify({scriptId: project.scriptId}, null, 2) + '\n'
);

console.log(JSON.stringify({
  scriptIdVerified: true,
  driftWorkDir: absoluteWorkDir
}));
