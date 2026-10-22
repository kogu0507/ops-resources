import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const sourceUrl = new URL('../src/JsonDiffCore.gs', import.meta.url);
export function loadCore() {
  const sandbox = Object.create(null);
  vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(readFileSync(sourceUrl, 'utf8'), { filename: 'JsonDiffCore.gs' }).runInContext(sandbox);
  return sandbox.JsonDiffCore;
}
export const utf8 = value => Array.from(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8'));
