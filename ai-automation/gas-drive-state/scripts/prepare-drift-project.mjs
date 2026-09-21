import fs from 'node:fs';

const [inputFile, outputFile, rootDir] = process.argv.slice(2);
if (!inputFile || !outputFile || !rootDir) {
  throw new Error('usage: prepare-drift-project.mjs <input-project> <output-project> <rootDir>');
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

fs.mkdirSync(rootDir, {recursive: true});
fs.writeFileSync(outputFile, JSON.stringify({
  scriptId: project.scriptId,
  rootDir
}, null, 2) + '\n');
console.log(JSON.stringify({scriptIdVerified: true, driftRootDir: rootDir}));
