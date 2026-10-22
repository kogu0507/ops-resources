import assert from 'node:assert/strict';
import { loadCore, utf8 } from './load-core.mjs';
const core=loadCore();
const profile=utf8({schemaVersion:'json-diff-profile/1',profileVersion:'1',recordsPath:'',idKey:'id',ignorePaths:[]});
let seed=0x10202026,checks=0;
const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const keys=['a','b','__proto__','constructor','toString','/','~','😀'];
function value(depth=0) {
  const type=next()%(depth>=3?4:6);
  if(type===0)return null;
  if(type===1)return (next()%10000)/100;
  if(type===2)return Boolean(next()%2);
  if(type===3)return ['','x','😀','~ /','\u0000'][next()%5];
  if(type===4)return Array.from({length:next()%4},()=>value(depth+1));
  return Object.fromEntries(Array.from({length:next()%5},()=>[keys[next()%keys.length],value(depth+1)]));
}
const canonical=v=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const reversed=v=>Array.isArray(v)?v.map(reversed):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reversed(v[k])])):v;
for(let i=0;i<300;i++) {
  const x=value(),y=value(),before=utf8([{id:'a',v:x}]),after=utf8([{id:'a',v:y}]);
  const snapshot=[...before],r=core.compareUtf8(before,after,profile),rev=core.compareUtf8(after,before,profile);
  assert.equal(r.ok,true);assert.equal(rev.ok,true);assert.deepEqual(before,snapshot);
  const same=JSON.stringify(canonical(x))===JSON.stringify(canonical(y));
  assert.equal(r.result.status,same?'UNCHANGED':'CHANGED');
  assert.equal(rev.result.counts.changeEntries,r.result.counts.changeEntries);
  assert.equal(core.compareUtf8(before,utf8([{id:'a',v:reversed(x)}]),profile).result.status,'UNCHANGED');
  const normalized=rev.result.changes.map(c=>({...c,kind:c.kind==='ADDED'?'REMOVED':c.kind==='REMOVED'?'ADDED':c.kind,before:c.after,after:c.before}));
  assert.equal(JSON.stringify(normalized),JSON.stringify(r.result.changes));
  checks+=6;
}
// Parse-valid JSON strings roundtrip through escape encodings; hostile encodings
// are tested before projection so ignored content cannot hide them.
for(const raw of ['0','-0','1.0','1e2','0.1','5e-324','2.2250738585072014e-308','0e999999']) {
  const r=core.compareUtf8(utf8('[{"id":"a","n":'+raw+'}]'),utf8([]),profile);
  assert.equal(r.ok,true,raw);checks++;
}
for(const raw of ['1e-999999','1e999999','9007199254740993','0.10000000000000001','1.0000000000000001']) {
  assert.equal(core.compareUtf8(utf8('[{"id":"a","n":'+raw+'}]'),utf8([]),profile).error.code,'NUMBER_UNSAFE');checks++;
}
for(const bytes of [[0xC0,0x80],[0xED,0xA0,0x80],[0xF4,0x90,0x80,0x80],[0x80],[0xE0,0xA0]]) {
  assert.equal(core.compareUtf8(bytes,utf8([]),profile).error.code,'UTF8_INVALID');checks++;
}
assert.equal(core.compareUtf8({length:2,0:91,1:93,[Symbol.toStringTag]:'Uint8Array'},utf8([]),profile).error.code,'BYTE_TYPE');checks++;
console.log(JSON.stringify({suite:'seeded self-adversarial metamorphic',seed:'0x10202026',iterations:300,checks,pass:true}));
