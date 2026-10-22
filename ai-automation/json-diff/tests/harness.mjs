import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../src/JsonDiffCore.gs',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source,context,{filename:'JsonDiffCore.gs',timeout:10000});
export const profile={schemaVersion:'json-diff-profile/1',profileVersion:'1',recordsPath:'/items',idKey:'id',ignorePaths:[]};
export const bytes=s=>Array.from(Buffer.from(s,'utf8'));
export const raw=(b,a,p=JSON.stringify(profile))=>JSON.parse(JSON.stringify(context.JsonDiffCore.compareUtf8(typeof b==='string'?bytes(b):b,typeof a==='string'?bytes(a):a,typeof p==='string'?bytes(p):p)));
export const compare=(b,a,p=profile)=>raw(JSON.stringify(b),JSON.stringify(a),JSON.stringify(p));
export function good(r){assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(Object.keys(r).sort(),['ok','result']);assert.equal(r.result.counts.changeEntries,r.result.changes.length);return r.result;}
export function bad(r,input,code){assert.equal(r.ok,false,JSON.stringify(r));assert.deepEqual(Object.keys(r).sort(),['error','ok']);assert.deepEqual(Object.keys(r.error).sort(),['code','input','message','path']);assert.match(r.error.code,/^[A-Z][A-Z0-9_]*$/);assert.equal(typeof r.error.path,'string');if(input)assert.equal(r.error.input,input);if(code)assert.equal(r.error.code,code);return r.error;}
export const doc=items=>({items});
export const present=value=>({present:true,value});
export const absent={present:false};
