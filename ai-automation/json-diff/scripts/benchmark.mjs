import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadCore, sourceUrl, utf8 } from './load-core.mjs';
const core = loadCore();
const p = utf8({schemaVersion:'json-diff-profile/1',profileVersion:'1',recordsPath:'',idKey:'id',ignorePaths:[]});
const cases = [
  ['1000-record reversed unchanged', Array.from({length:1000},(_,i)=>({id:String(i),a:{x:i,y:[1,2,3]}})), a=>[...a].reverse()],
  ['10000 changes exact cap', Array.from({length:1000},(_,i)=>Object.fromEntries([['id',String(i)],...Array.from({length:10},(_,j)=>['k'+j,0])])), a=>a.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,k==='id'?v:1])))],
  ['50000 nodes exact cap', [{id:'a',payload:Array(49996).fill(0)}], a=>a],
  ['near-byte-limit strings', Array.from({length:4},(_,i)=>({id:String(i),payload:'x'.repeat(250000)})), a=>a.map(r=>({...r,payload:'y'+r.payload.slice(1)}))],
  // Repeated field paths amplify result size without exceeding source or
  // change-entry caps.
  ['output limit fail-closed', [{id:'a', ['x'.repeat(10000)]:Object.fromEntries(Array.from({length:1000},(_,i)=>['k'+i,0]))}], a=>[{id:'a',['x'.repeat(10000)]:Object.fromEntries(Array.from({length:1000},(_,i)=>['k'+i,1]))}]],
];
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,sourceSha256:createHash('sha256').update(readFileSync(sourceUrl)).digest('hex'),note:'Local Node observation only; no GAS runtime or latency guarantee'}));
for (const [name,before,makeAfter] of cases) {
  const b=utf8(before),a=utf8(makeAfter(before)), start=performance.now();
  const result=core.compareUtf8(b,a,p),elapsedMs=performance.now()-start;
  console.log(JSON.stringify({name,beforeBytes:b.length,afterBytes:a.length,elapsedMs:+elapsedMs.toFixed(2),ok:result.ok,changes:result.result?.counts.changeEntries,error:result.error?.code,outputBytes:Buffer.byteLength(JSON.stringify(result))}));
}
