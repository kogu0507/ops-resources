import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect,compare} from './check.mjs';
const c={gscSite:'sc-domain:example.invalid',ga4Property:'123',gscEnd:'2026-10-10',ga4End:'2026-10-10',gscConfirmedThrough:'2026-10-10',ga4ConfirmedThrough:'2026-10-10',ga4Timezone:'Asia/Tokyo'};
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
function fixture(time='2026-10-15T12:00:00+09:00'){
  const defs=[['gsc','total',[],['clicks','impressions','ctr','position']],['gsc','query',['query'],['clicks','impressions','ctr','position']],['gsc','page',['page'],['clicks','impressions','ctr','position']],['ga4','pages',['pagePathPlusQueryString','pageTitle'],['screenPageViews','activeUsers']],['ga4','acquisition',['sessionSource','sessionMedium'],['sessions']]];
  const a=[['snapshot_key','record_type','json_v1']];
  for(const [source,name,dimensions,metrics] of defs){
    const d={source,name,dimensions,metrics,scope:source==='gsc'?c.gscSite:'properties/123',period_end:'2026-10-10',period_start:'2026-09-13',filters:null,searchType:source==='gsc'?'web':null,metric_definition:`google-official-v1/${source}/${name}`};
    const timezone=source==='gsc'?'America/Los_Angeles':'Asia/Tokyo',dataState=source==='gsc'?'final':'not_guaranteed_final',key=stable({...d,timezone,dataState});
    const m={...d,timezone,dataState,observed_at:time,operator_confirmed_through:'2026-10-10',finalizedThrough:source==='gsc'?'2026-10-10':null,coverage:'returned_rows_only',known_gaps:['Synthetic fixture, not live evidence'],response_metadata:source==='ga4'?{timeZone:timezone}:null};
    a.push([key,'metadata',JSON.stringify(m)]);
    a.push([key,'row',JSON.stringify({dimensions:dimensions.map((_,i)=>'synthetic'+i),metrics:source==='gsc'?[1,10,0.1,2]:metrics.map(()=>1)})]);
  }return a;
}
test('all five reports pass independently constructed fixture',()=>assert.equal(inspect(fixture(),c).storedRecords,10));
test('calendar-normalized impossible observed date is rejected',()=>assert.throws(()=>inspect(fixture('2026-02-30T12:00:00+09:00'),c),/observed_at/));
test('impossible expected end date is rejected before normalized window comparison',()=>assert.throws(()=>inspect(fixture(),{...c,gscEnd:'2026-02-30'}),/Invalid expected end date/));
test('impossible confirmed-through date is rejected even when expected matches',()=>{const a=fixture();for(const r of a){if(r[1]==='metadata'){const m=JSON.parse(r[2]);m.operator_confirmed_through='2026-10-32';if(m.source==='gsc')m.finalizedThrough='2026-10-32';r[2]=JSON.stringify(m);}}assert.throws(()=>inspect(a,{...c,gscConfirmedThrough:'2026-10-32',ga4ConfirmedThrough:'2026-10-32'}),/date/);});
test('same-key rerun is timestamped, no growth, stale deletion honestly unobserved',()=>{const r=compare(inspect(fixture(),c),inspect(fixture('2026-10-15T12:01:00+09:00'),c));assert.equal(r.length,5);assert.ok(r.every(x=>x.dataUnchanged&&x.added===0&&x.removed===0&&x.staleRemovalEvidence.startsWith('NOT OBSERVED')));});
test('metadata duplicates fail',()=>{const a=fixture();a.push(a[1]);assert.throws(()=>inspect(a,c),/Duplicate\/missing metadata/);});
test('dimension duplicates fail',()=>{const a=fixture();a.push(a[4]);assert.throws(()=>inspect(a,c),/duplicate dimension/);});
test('wrong scope fails',()=>assert.throws(()=>inspect(fixture(),{...c,gscSite:'sc-domain:wrong.invalid'}),/scope/));
test('wrong timezone fails',()=>assert.throws(()=>inspect(fixture(),{...c,ga4Timezone:'UTC'}),/timezone/));
test('invalid metric fails',()=>{const a=fixture(),r=JSON.parse(a[4][2]);r.metrics[2]=2;a[4][2]=JSON.stringify(r);assert.throws(()=>inspect(a,c),/CTR/);});
test('partial sheet fails',()=>assert.throws(()=>inspect(fixture().slice(0,9),c),/five snapshot/));
test('unchanged observed_at fails rerun evidence',()=>assert.throws(()=>compare(inspect(fixture(),c),inspect(fixture(),c)),/timestamp unchanged/));
test('actual removed dimension is counted only when absent',()=>{const a=fixture(),b=fixture('2026-10-15T12:01:00+09:00');const extra=JSON.parse(a[4][2]);extra.dimensions=['another'];a.push([a[4][0],'row',JSON.stringify(extra)]);const r=compare(inspect(a,c),inspect(b,c));assert.equal(r.find(x=>x.report==='gsc/query').removed,1);});
test('growth reports distinct dimensions without declaring upstream legitimacy',()=>{const a=fixture(),b=fixture('2026-10-15T12:01:00+09:00');const extra=JSON.parse(b[4][2]);extra.dimensions=['another'];b.push([b[4][0],'row',JSON.stringify(extra)]);const r=compare(inspect(a,c),inspect(b,c));assert.match(r.find(x=>x.report==='gsc/query').countGrowthInterpretation,/requires API evidence/);});
