import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const canonical = x => Array.isArray(x) ? '['+x.map(canonical).join(',')+']' : x && typeof x === 'object' ? '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}' : JSON.stringify(x);
const specs = [ ['gsc','total',[],['clicks','impressions','ctr','position']], ['gsc','query',['query'],['clicks','impressions','ctr','position']], ['gsc','page',['page'],['clicks','impressions','ctr','position']], ['ga4','pages',['pagePathPlusQueryString','pageTitle'],['screenPageViews','activeUsers']], ['ga4','acquisition',['sessionSource','sessionMedium'],['sessions']] ];
const check = (ok, msg) => {if (!ok) throw Error(msg);};
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function inspect(input, expected) {
  const values = Array.isArray(input) ? input : input.values;
  check(Array.isArray(values) && canonical(values[0])===canonical(['snapshot_key','record_type','json_v1']), 'Header missing or different');
  const groups = new Map();
  for (const [i,row] of values.slice(1).entries()) {
    check(Array.isArray(row)&&row.length===3&&row.every(v=>typeof v==='string'),`Malformed record ${i+2}`);
    const [key,type,json]=row; check(type==='metadata'||type==='row', 'Unexpected record type');
    if (!groups.has(key)) groups.set(key,{metadata:[],rows:[]});
    groups.get(key)[type==='row'?'rows':'metadata'].push(JSON.parse(json));
  }
  check(groups.size===5,'Expected exactly five snapshot keys in fresh dedicated sheet');
  const reports=[], names=new Set(), observed=new Set();
  for (const [key,g] of groups) {
    check(g.metadata.length===1,'Duplicate/missing metadata');
    const m=g.metadata[0], name=m.source+'/'+m.name;
    check(!names.has(name),'Duplicate report semantic identity'); names.add(name);
    const spec=specs.find(s=>s[0]===m.source&&s[1]===m.name); check(spec,'Unexpected report');
    const end=expected[m.source+'End']; check(validDate(end),'Invalid expected end date');
    check(validDate(expected[m.source+'ConfirmedThrough']),'Invalid expected confirmed-through date');
    const start=new Date(Date.parse(end+'T00:00:00Z')-27*86400000).toISOString().slice(0,10);
    const d={source:m.source,name:m.name,dimensions:spec[2],metrics:spec[3],scope:m.source==='gsc'?expected.gscSite:'properties/'+expected.ga4Property,period_end:end,period_start:start,filters:null,searchType:m.source==='gsc'?'web':null,metric_definition:'google-official-v1/'+name};
    for (const [k,v] of Object.entries(d)) check(canonical(m[k])===canonical(v),name+' metadata mismatch: '+k);
    const timezone=m.source==='gsc'?'America/Los_Angeles':expected.ga4Timezone;
    check(typeof timezone==='string'&&timezone.length>0,'Expected GA4 timezone missing');
    const dataState=m.source==='gsc'?'final':'not_guaranteed_final';
    check(m.timezone===timezone&&m.dataState===dataState,name+' timezone/dataState mismatch');
    check(key===canonical({...d,timezone,dataState}),name+' snapshot key mismatch');
    check(typeof m.observed_at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/.test(m.observed_at)&&Number.isFinite(Date.parse(m.observed_at))&&new Date(Date.parse(m.observed_at)+9*3600000).toISOString().slice(0,19)===m.observed_at.slice(0,19),name+' invalid observed_at'); observed.add(m.observed_at);
    check(m.operator_confirmed_through===expected[m.source+'ConfirmedThrough']&&m.operator_confirmed_through>=end,name+' confirmed-through mismatch');
    check(m.finalizedThrough===(m.source==='gsc'?expected.gscConfirmedThrough:null),name+' finalizedThrough mismatch');
    check(m.coverage===(g.rows.length?'returned_rows_only':'empty_response_not_zero'),name+' coverage mismatch');
    check(Array.isArray(m.known_gaps)&&m.known_gaps.length>0,name+' known gaps missing');
    if(m.source==='ga4') check(m.response_metadata?.timeZone===timezone,name+' response timezone mismatch');
    const seen=new Set();
    for(const r of g.rows){
      check(Array.isArray(r.dimensions)&&r.dimensions.length===spec[2].length&&r.dimensions.every(v=>typeof v==='string'),name+' dimensions malformed');
      const dim=canonical(r.dimensions);check(!seen.has(dim),name+' duplicate dimension');seen.add(dim);
      check(Array.isArray(r.metrics)&&r.metrics.length===spec[3].length,name+' metrics malformed');
      r.metrics.forEach((v,i)=>{check(typeof v==='number'&&Number.isFinite(v)&&v>=0,name+' metric invalid'); if(m.source==='ga4'||i<2)check(Number.isSafeInteger(v),name+' count invalid');if(m.source==='gsc'&&i===2)check(v<=1,name+' CTR invalid');});
    }
    if(name==='gsc/total')check(g.rows.length<=1,'Multiple total rows');
    reports.push({name,key,observed_at:m.observed_at,count:g.rows.length,dimensions:seen,rows:g.rows});
  }
  check(observed.size===1,'Within-run observed_at differs');
  return {status:'PASS',storedRecords:values.length-1,reports};
}
export function compare(a,b){
  return b.reports.map(next=>{const prev=a.reports.find(r=>r.name===next.name);check(prev?.key===next.key,next.name+' rerun key changed');check(prev.observed_at!==next.observed_at,next.name+' rerun timestamp unchanged');
    const removed=[...prev.dimensions].filter(d=>!next.dimensions.has(d)).length,added=[...next.dimensions].filter(d=>!prev.dimensions.has(d)).length;
    return {report:next.name,before:prev.count,after:next.count,added,removed,dataUnchanged:canonical(prev.rows)===canonical(next.rows),duplicateKeys:false,staleRemovalEvidence:removed?'Observed prior dimensions absent from second readback':'NOT OBSERVED: no removed dimensions; live stale-row removal not proven',countGrowthInterpretation:next.count>prev.count?'Distinct dimensions added; upstream change requires API evidence, not assumed legitimate':'No row count growth'};
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [expectedPath,firstPath,secondPath]=process.argv.slice(2);check(expectedPath&&firstPath,'Usage: node check.mjs expected.json first.json [second.json]');
    const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));const expected=read(expectedPath),a=inspect(read(firstPath),expected);
    const result={status:'PARTIAL',scope:'Sheet structure and same-key replacement evidence only; not OAuth/API provenance or full M2 acceptance',first:{storedRecords:a.storedRecords,reports:a.reports.map(({name,count,observed_at})=>({name,count,observed_at}))}};
    if(secondPath){const b=inspect(read(secondPath),expected);result.rerun=compare(a,b);result.status=result.rerun.some(r=>r.added>0)?'REVIEW_SOURCE_CHANGE':'PASS_SHEET_CHECKS';}else result.rerun='UNKNOWN: second readback unavailable';
    console.log(JSON.stringify(result,null,2));
  }catch(e){console.error(JSON.stringify({status:'FAIL_OR_INCOMPLETE',message:e.message}));process.exitCode=1;}
}
