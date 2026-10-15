import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(dir + 'test/fixtures/reports.json', 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
function harness() {
  const state = {cells: [], calls: [], writes: 0, released: 0, locked: false, transform: x => x};
  const config = {liveEnabled:true,gscSite:'sc-domain:example.test',ga4Property:'123',spreadsheetId:'fixture_sheet',sheetId:77,sheetTitle:'analytics_snapshots',gscEnd:'2026-10-10',gscConfirmedThrough:'2026-10-10',ga4End:'2026-10-10',ga4ConfirmedThrough:'2026-10-10',pageSize:2,maxPages:3};
  const context = vm.createContext({
    LockService:{getScriptLock:()=>({tryLock:()=>!state.locked,releaseLock:()=>{state.released++;}})},
    Utilities:{formatDate:()=> '2026-10-15T18:00:00+09:00'},
    ScriptApp:{getOAuthToken:()=> 'offline-fixture-token'},
    UrlFetchApp:{fetch:(url, options)=>{
      const body = options.payload ? JSON.parse(options.payload) : null;
      state.calls.push({url,options:clone(options),body});
      let result;
      if (url.includes(':checkCompatibility')) result = {
        dimensionCompatibilities:body.dimensions.map(x=>({dimensionMetadata:{apiName:x.name},compatibility:'COMPATIBLE'})),
        metricCompatibilities:body.metrics.map(x=>({metricMetadata:{apiName:x.name},compatibility:'COMPATIBLE'}))
      };
      else if (url.includes('/searchAnalytics/query')) result = clone(fixture[body.dimensions.length===0?'gscTotal':body.dimensions[0]==='query'?'gscQuery':'gscPage']);
      else if (url.includes(':runReport')) result = clone(fixture[body.metrics[0].name==='sessions'?'ga4Acquisition':'ga4Pages']);
      else if (url.includes('/values/')) result = {values:clone(state.cells)};
      else if (url.endsWith(':batchUpdate')) {
        state.writes++; const update = body.requests[0].updateCells;
        assert.equal(update.range.sheetId,77); assert.equal(update.fields,'userEnteredValue');
        // Model Sheets range replacement/clear semantics rather than production helper.
        state.cells = update.rows.map(r=>r.values.map(v=>v.userEnteredValue.stringValue));
        result={replies:[{}]};
      } else result={sheets:[{properties:{sheetId:77,title:'analytics_snapshots',gridProperties:{rowCount:20000,columnCount:3}}}]};
      const altered = state.transform(result,url,body,state);
      if (altered instanceof Error) throw altered;
      return {getResponseCode:()=>altered?.http || 200,getContentText:()=>altered?.raw ?? JSON.stringify(altered)};
    }}
  });
  for (const file of ['Collector.gs','GasIo.gs','Config.gs']) vm.runInContext(fs.readFileSync(dir+'src/'+file,'utf8'),context,{filename:file});
  return {state,config,context,run:()=>context.SiteAnalytics.run(config,context.siteAnalyticsGasIo(config))};
}
test('five official reports through real GAS HTTP adapter, atomic write and readback',()=>{
  const h=harness(); assert.equal(h.run().status,'verified'); assert.equal(h.state.writes,1); assert.equal(h.state.cells.length,11);
  const calls=h.state.calls; const write=calls.findIndex(x=>x.url.endsWith(':batchUpdate'));
  assert.equal(calls.slice(0,write).filter(x=>x.url.includes(':runReport')||x.url.includes('/searchAnalytics/query')).length,5);
  const gsc=calls.find(x=>x.url.includes('/searchAnalytics/query')); assert.equal(gsc.body.type,'web'); assert.equal(gsc.body.dataState,'final'); assert.equal(gsc.body.startDate,'2026-09-13');
  const meta=JSON.parse(h.state.cells.find(x=>x[1]==='metadata')[2]); assert.equal(meta.timezone,'America/Los_Angeles'); assert.equal(meta.observed_at,'2026-10-15T18:00:00+09:00');
  const ga=h.state.cells.filter(x=>x[1]==='metadata').map(x=>JSON.parse(x[2])).filter(x=>x.source==='ga4');
  assert.equal(ga[0].dataState,'not_guaranteed_final'); assert.equal(ga[0].finalizedThrough,null); assert.equal(ga[0].response_metadata.subjectToThresholding,true); assert.ok(ga[1].response_metadata.samplingMetadatas);
});
test('rerun is idempotent and replacing smaller snapshot clears stale dimension rows',()=>{
  const h=harness(); h.state.transform=(r,url,body)=>{
    if(url.includes('/searchAnalytics/query')&&body.dimensions[0]==='query') r.rows.push({keys:['second'],clicks:1,impressions:2,ctr:0.5,position:1});
    // Full page requires a terminating empty page.
    if(url.includes('/searchAnalytics/query')&&body.startRow===2) r.rows=[];
    return r;
  }; h.run(); assert.equal(h.state.cells.length,12); h.state.transform=x=>x; h.run(); assert.equal(h.state.cells.length,11);
  h.run(); assert.equal(h.state.cells.length,11); const updates=h.state.calls.filter(x=>x.url.endsWith(':batchUpdate')); assert.equal(updates[1].body.requests[0].updateCells.range.endRowIndex,12);
});
test('different source window retains earlier snapshot',()=>{const h=harness();h.run();h.config.gscEnd='2026-10-09';h.run();assert.equal(h.state.cells.filter(x=>x[1]==='metadata').length,8);});
test('empty source preserves missing != zero as metadata with no invented rows',()=>{const h=harness();h.state.transform=(r,url)=>{if(url.includes('/searchAnalytics/query')) delete r.rows;if(url.includes(':runReport')){r.rows=[];r.rowCount=0;}return r;};h.run();assert.equal(h.state.cells.length,6);assert.equal(JSON.parse(h.state.cells[1][2]).coverage,'empty_response_not_zero');});
test('default live entry point stops before token/network/lock',()=>{const h=harness();assert.throws(()=>h.context.runSiteAnalytics(),/Human Gate/);assert.equal(h.state.calls.length,0);});
test('wrong dedicated script stops live entry before token/network',()=>{const h=harness();h.context.siteAnalyticsConfig=()=>({...h.config,expectedScriptId:'dedicated'});h.context.ScriptApp.getScriptId=()=> 'different';assert.throws(()=>h.context.runSiteAnalytics(),/script ID mismatch/);assert.equal(h.state.calls.length,0);});
test('valid GA4 protobuf empty response can omit rows and default rowCount zero',()=>{const h=harness();h.state.transform=(r,url)=>{if(url.includes(':runReport')){delete r.rows;delete r.rowCount;}return r;};h.run();assert.equal(h.state.cells.length,9);assert.ok(h.state.cells.filter(x=>x[1]==='metadata').map(x=>JSON.parse(x[2])).filter(x=>x.source==='ga4').every(x=>x.coverage==='empty_response_not_zero'));});
test('GSC anonymous query gap belongs to query report only',()=>{const h=harness();h.run();const g=h.state.cells.filter(x=>x[1]==='metadata').map(x=>JSON.parse(x[2])).filter(x=>x.source==='gsc');assert.equal(g.filter(x=>x.known_gaps.includes('anonymized queries omitted')).length,1);assert.equal(g.find(x=>x.known_gaps.includes('anonymized queries omitted')).name,'query');});
test('GA4 changing metadata between pages fails before storage',()=>{const h=harness();h.state.transform=(r,url,body)=>{if(url.includes(':runReport')){r.rowCount=3;if(body.offset==='0')r.rows.push({...clone(r.rows[0]),dimensionValues:r.rows[0].dimensionValues.map(v=>({value:v.value+'2'}))});else r.metadata.timeZone='UTC';}return r;};assert.throws(h.run,/changed during pagination/);assert.equal(h.state.writes,0);});
test('literal formula-like dimensions are sent as stringValue only',()=>{const h=harness();h.state.transform=(r,url,body)=>{if(url.includes('/searchAnalytics/query')&&body.dimensions[0]==='query')r.rows[0].keys=['=IMPORTXML("private")'];return r;};h.run();const values=h.state.calls.find(x=>x.url.endsWith(':batchUpdate')).body.requests[0].updateCells.rows.flatMap(x=>x.values);assert.ok(values.every(x=>Object.keys(x.userEnteredValue).join()==='stringValue'));});
for (const [label,mutate] of [
  ['missing metric',r=>{delete r.rows[0].clicks;}],
  ['null metric',r=>{r.rows[0].clicks=null;}],
  ['negative count',r=>{r.rows[0].clicks=-1;}],
  ['fractional count',r=>{r.rows[0].clicks=1.5;}],
  ['invalid CTR',r=>{r.rows[0].ctr=2;}],
  ['bad keys',r=>{r.rows[0].keys=['unexpected'];}],
  ['missing aggregation',r=>{delete r.responseAggregationType;}],
  ['invalid rows',r=>{r.rows={};}]
]) test('reject GSC '+label+' without any write',()=>{const h=harness();h.state.transform=(r,url,body)=>{if(url.includes('/searchAnalytics/query')&&!body.dimensions.length)mutate(r);return r;};assert.throws(h.run);assert.equal(h.state.writes,0);assert.equal(h.state.released,1);});
for (const [label,mutate] of [
  ['header mismatch',r=>{r.metricHeaders[0].name='activeUsers';}],
  ['missing rowCount',r=>{delete r.rowCount;}],
  ['missing timezone',r=>{delete r.metadata.timeZone;}],
  ['missing dimension',r=>{r.rows[0].dimensionValues=[];}],
  ['missing metric',r=>{r.rows[0].metricValues=[];}],
  ['non numeric metric',r=>{r.rows[0].metricValues[0].value='';}],
  ['inconsistent count',r=>{r.rowCount=0;}]
]) test('reject GA4 '+label+' after earlier GSC fetches without partial success',()=>{const h=harness();h.state.transform=(r,url)=>{if(url.includes(':runReport'))mutate(r);return r;};assert.throws(h.run);assert.equal(h.state.writes,0);});
for(const code of [401,403,429,500,504]) test('HTTP '+code+' fails closed without body disclosure or retries',()=>{const h=harness();h.state.transform=()=>({http:code,secret:'private'});assert.throws(h.run,new RegExp('HTTP '+code));assert.equal(h.state.calls.length,1);assert.equal(h.state.writes,0);});
test('transport timeout fails closed and releases lock',()=>{const h=harness();h.state.transform=()=>new Error('secret');assert.throws(h.run,/transport failure/);assert.equal(h.state.writes,0);assert.equal(h.state.released,1);});
test('invalid JSON fails closed',()=>{const h=harness();h.state.transform=()=>({raw:'not json'});assert.throws(h.run,/invalid JSON/);assert.equal(h.state.writes,0);});
test('compatibility must be explicitly confirmed before GA4 report',()=>{const h=harness();h.state.transform=(r,url)=>{if(url.includes(':checkCompatibility'))r.metricCompatibilities[0].compatibility='INCOMPATIBLE';return r;};assert.throws(h.run,/compatibility/);assert.equal(h.state.writes,0);});
test('page bound does not silently save truncated GSC results',()=>{const h=harness();h.config.pageSize=1;h.config.maxPages=1;assert.throws(h.run,/Pagination limit/);assert.equal(h.state.writes,0);});
test('repeated pagination dimension fails closed',()=>{const h=harness();h.config.pageSize=1;assert.throws(h.run,/Repeated dimension/);assert.equal(h.state.writes,0);});
test('GA4 pagination advances offset and checks metadata/count consistency',()=>{const h=harness();h.config.pageSize=2;h.state.transform=(r,url,body)=>{if(url.includes(':runReport')){r.rowCount=3;if(body.offset==='0')r.rows.push({dimensionValues:r.rows[0].dimensionValues.map(v=>({value:v.value+'2'})),metricValues:r.rows[0].metricValues.map(()=>({value:'1'}))});else r.rows[0].dimensionValues=r.rows[0].dimensionValues.map(v=>({value:v.value+'3'}));}return r;};h.run();assert.ok(h.state.calls.some(x=>x.body?.offset==='2'));assert.equal(h.state.cells.length,15);});
test('incomplete GA4 pagination is never saved',()=>{const h=harness();h.state.transform=(r,url)=>{if(url.includes(':runReport'))r.rowCount=3;return r;};assert.throws(h.run,/incomplete page/);assert.equal(h.state.writes,0);});
test('readback mismatch returns UNKNOWN even after atomic commit',()=>{const h=harness();h.state.transform=(r,url,b,s)=>{if(url.includes('/values/')&&s.writes)r.values=r.values.slice(0,-1);return r;};assert.throws(h.run,/UNKNOWN.*readback/);assert.equal(h.state.writes,1);});
test('batch failure does not return success or automatically retry',()=>{const h=harness();h.state.transform=(r,url)=>url.endsWith(':batchUpdate')?{http:503}:r;assert.throws(h.run,/HTTP 503/);assert.equal(h.state.writes,1);});
test('concurrent run cannot read or mutate',()=>{const h=harness();h.state.locked=true;assert.throws(h.run,/already running/);assert.equal(h.state.calls.length,0);assert.equal(h.state.released,0);});
test('wrong existing sheet and sheet ID/title are rejected',()=>{const h=harness();h.state.cells=[['unrelated']];assert.throws(h.run,/header mismatch/);assert.equal(h.state.writes,0);const j=harness();j.config.sheetId=99;assert.throws(j.run,/ID\/title mismatch/);assert.equal(j.state.writes,0);});
test('end date requires explicit confirmation, invalid dates rejected before network',()=>{const h=harness();h.config.gscConfirmedThrough='2026-10-09';assert.throws(h.run,/confirmed-through/);assert.equal(h.state.calls.length,0);h.config.gscEnd='2026-02-30';assert.throws(h.run,/Invalid date/);});
test('manifest scopes are explicit and no trigger/deploy entry point exists',()=>{const manifest=JSON.parse(fs.readFileSync(dir+'src/appsscript.json'));assert.equal(manifest.runtimeVersion,'V8');assert.equal(manifest.oauthScopes.length,4);assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/analytics.readonly'));assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/webmasters.readonly'));for(const f of ['Collector.gs','GasIo.gs','Config.gs'])assert.doesNotMatch(fs.readFileSync(dir+'src/'+f,'utf8'),/newTrigger|\.create\(|Logger\.|console\./);});
