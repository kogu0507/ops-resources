import test from 'node:test';
import assert from 'node:assert/strict';
import {profile,raw,compare,good,bad,doc,bytes} from './harness.mjs';
const base='{"items":[]}';
test('stable error code vocabulary and preflight ordering',()=>{const cases=[
 [()=>raw(null,base),'BYTE_TYPE','BEFORE'],
 [()=>raw([-1],base),'BYTE_VALUE','BEFORE'],
 [()=>raw([0x80],base),'UTF8_INVALID','BEFORE'],
 [()=>raw([239,187,191,...bytes(base)],base),'UTF8_BOM','BEFORE'],
 [()=>raw('{',base),'JSON_SYNTAX','BEFORE'],
 [()=>raw('{"items":[],"x":"\\ud800"}',base),'JSON_SURROGATE','BEFORE'],
 [()=>raw('{"items":[],"x":1,"x":2}',base),'JSON_DUPLICATE_KEY','BEFORE'],
 [()=>raw('{"items":[],"x":1e999999}',base),'NUMBER_UNSAFE','BEFORE'],
 [()=>compare(doc([]),doc([]),{...profile,unknown:1}),'PROFILE_SCHEMA','PROFILE'],
 [()=>compare(doc([]),doc([]),{...profile,profileVersion:''}),'PROFILE_VERSION','PROFILE'],
 [()=>compare(doc([]),doc([]),{...profile,recordsPath:'/~3'}),'POINTER_INVALID','PROFILE'],
 [()=>compare(doc([]),doc([]),{...profile,idKey:''}),'PROFILE_ID_KEY','PROFILE'],
 [()=>compare(doc([]),doc([]),{...profile,ignorePaths:['/id']}),'IGNORE_INVALID','PROFILE'],
 [()=>compare(doc([]),doc([]),{...profile,ignorePaths:['/a','/a/b']}),'IGNORE_OVERLAP','PROFILE'],
 [()=>compare({},doc([])),'RECORDS_PATH','BEFORE'],
 [()=>compare({items:{}},doc([])),'RECORDS_TYPE','BEFORE'],
 [()=>compare(doc([null]),doc([])),'RECORD_TYPE','BEFORE'],
 [()=>compare(doc([{}]),doc([])),'ID_INVALID','BEFORE'],
 [()=>compare(doc([{id:'A'},{id:'A'}]),doc([])),'ID_DUPLICATE','BEFORE'],
 [()=>compare(doc([{id:'A',a:1}]),doc([]),{...profile,ignorePaths:['/a/b']}),'IGNORE_TRAVERSAL','BEFORE']
 ];for(const [run,code,input] of cases){const e=bad(run(),input);assert.equal(e.code,code);}
 assert.equal(bad(raw('{','{','{')).input,'PROFILE');
 assert.equal(bad(raw('{','{')).input,'BEFORE');
 assert.equal(bad(raw(base,'{',JSON.stringify({...profile,unknown:1}))).input,'AFTER');
 assert.equal(bad(raw(base,base,JSON.stringify({...profile,unknown:1}))).input,'PROFILE');
});
test('whole input validation before projection and before record selection',()=>{for(const section of ['ignored','unselected']){const text=section==='ignored'?'{"items":[{"id":"A","ignored":9007199254740993}]}':'{"items":[],"unselected":9007199254740993}';const e=bad(raw(text,base,JSON.stringify({...profile,ignorePaths:['/ignored']})),'BEFORE');assert.equal(e.code,'NUMBER_UNSAFE');}for(const input of ['BEFORE','AFTER','PROFILE']){const b=input==='BEFORE'?[0x80]:base,a=input==='AFTER'?[0x80]:base,p=input==='PROFILE'?[0x80]:JSON.stringify(profile);assert.equal(bad(raw(b,a,p),input).code,'UTF8_INVALID');}});
test('error messages do not disclose values and repeated errors are stable',()=>{for(const secret of ['PRIVATE-SECRET-1','PRIVATE-SECRET-2']){const run=()=>compare(doc([{id:secret},{id:secret}]),doc([]));const a=run();bad(a);assert.equal(a.error.message.includes(secret),false);assert.equal(JSON.stringify(a),JSON.stringify(run()));}});
test('UTF16 sorting differs from locale and Unicode codepoint order',()=>{const ids=['\ue000','😀','a','A'];const r=good(compare(doc([]),doc(ids.map(id=>({id})))));assert.deepEqual(r.changes.map(c=>c.recordId),['A','a','😀','\ue000']);});
test('array remains atomic but nested object key ordering never creates a change',()=>{const a=doc([{id:'A',v:[{a:{x:1,y:2},b:[{x:1,y:2}]}]}]),b=doc([{id:'A',v:[{b:[{y:2,x:1}],a:{y:2,x:1}}]}]);assert.equal(good(compare(a,b)).status,'UNCHANGED');b.items[0].v[0].a.x=2;const r=good(compare(a,b));assert.equal(r.changes.length,1);assert.equal(r.changes[0].path,'/v');});
test('escaped dangerous property is preserved in projected output',()=>{const before='{"items":[{"id":"A","__proto__":{"constructor":1}}]}';const after='{"items":[{"id":"A","__proto__":{"constructor":2}}]}';const r=good(raw(before,after));assert.equal(r.changes[0].path,'/__proto__/constructor');assert.equal(r.changes[0].before.value,1);assert.equal(r.changes[0].after.value,2);});
