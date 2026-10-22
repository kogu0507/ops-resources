import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { loadCore, sourceUrl, utf8 } from './load-core.mjs';

const source = readFileSync(sourceUrl, 'utf8');
new vm.Script(source, { filename: 'JsonDiffCore.gs' });
// Conservative static boundary check, followed by execution in an empty context.
const forbidden = /\b(?:Buffer|TextDecoder|TextEncoder|require|process|fetch|UrlFetchApp|DriveApp|SpreadsheetApp|ScriptApp|PropertiesService|LockService|Utilities|console|Date|Math\.random)\b/;
const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
if (forbidden.test(code)) throw new Error('Core contains a platform or nondeterminism dependency');
const core = loadCore();
const p = {schemaVersion:'json-diff-profile/1',profileVersion:'1',recordsPath:'',idKey:'id',ignorePaths:[]};
const result = core.compareUtf8(utf8([]), utf8([]), utf8(p));
if (!result.ok || result.result.status !== 'UNCHANGED') throw new Error('Empty-context smoke failed');
console.log(JSON.stringify({check:'GAS V8 syntax and dependency boundary (Node static proxy)',pass:true,node:process.version,sourceSha256:createHash('sha256').update(source).digest('hex')}));
