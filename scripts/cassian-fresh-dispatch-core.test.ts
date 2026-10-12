import {describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readableSource,RECONSTRUCTION_PROMPT_V3,type CardV3,type ReviewV3} from './cassian-evidence-v3';
import {QUALITY_PROMPT_V3} from './cassian-quality-v3';
import {estimateCostUsd} from '../src/server/llm/pricing';
import {validateDesign,knownJobs,maximumPlan,materializeJobs,validateProgress,validateReceipt,receiptAction,assessWriterV3,paramsForJob,jobSha,
 emptyProgress,hash,WRITER_COMMON_V3,WRITER_SOFT_V3,WRITER_STRICT_V3,REPAIR_V3,type FreshDesign,type Job,type Receipt,type Progress} from './cassian-fresh-dispatch-core';
const raw='Mira Vale built the blue gauge in 1802.';
const source=readableSource({id:'archive',url:'https://example.org/archive',title:'Workshop archive',section:'Origins',edition:'First edition',
 captureSha:hash('raw HTML'),extractionSha:hash(raw),rawText:raw,locator:'archive:UTF16',removed:[]});
function design(active=22):FreshDesign{
 const controls=Array.from({length:19},(_,n)=>({privateId:`gold-${n}`,blindId:`case-${n}`,factual:JSON.stringify({id:`case-${n}`,question:'Who built the blue gauge?',
  answer:'Mira Vale',variants:[],explanation:raw,sources:[{id:source.id,url:source.url,title:source.title,section:source.section,edition:source.edition,locator:source.locator,text:raw,sha:hash(raw)}]}),
  quality:JSON.stringify({id:`case-${n}`,question:'Who built the blue gauge?',answer:'Mira Vale',variants:[],domain:'Workshop history',tier:'moderate'})}));
 return validateDesign({schemaVersion:3,id:'cassian-fresh-v3-test',seed:'fixed-test-seed',maxRunUsd:4,
  preparation:{selectionSha:hash('selection'),sourceFreezeSha:hash('source freeze'),accountingSha:hash('accounting'),measurement:'cached-curated-replay-not-production-readiness',independentAdjudicator:'unassigned'},
  files:[{path:'scripts/cassian-fresh-dispatch-core.ts',sha:hash(readFileSync(resolve('scripts/cassian-fresh-dispatch-core.ts')))}],
  prompts:{common:WRITER_COMMON_V3,soft:WRITER_SOFT_V3,strict:WRITER_STRICT_V3,repair:REPAIR_V3,quality:QUALITY_PROMPT_V3,factual:RECONSTRUCTION_PROMPT_V3},
  targets:Array.from({length:23},(_,n)=>({slot:n+1,snapshotTargetId:`target-${n}`,historySha:hash(`history-${n}`),stratum:{breadth:'broad',role:'cold',sourceCold:true,depleted:false},
   blind:{soft:`card-s-${n}`,strict:`card-t-${n}`},packet:{requestId:`request-${n}`,domain:'Workshop history',tier:'moderate',
   scope:n<active?'accepted':'unresolved',sources:[source],preparer:{role:'prompt-author',independent:false},facts:[{id:`fact-${n}`,assertion:raw,
    evidence:[{sourceId:source.id,start:0,end:raw.length,quote:raw}],support:'reviewed',novelty:'clear',rationale:'Author supplied fixture judgment.'}]}})),
  controls,repairs:{perArm:2,perRequestArm:1,policy:'hash-ranked-initial-nonpass-no-new-evidence'}});
}
function receipt(j:Job,raw:string):Receipt{
 const usage={inputTokens:100,outputTokens:100,cacheReadTokens:0,cacheCreateTokens:0};
 return{designSha:hash('design'),key:j.key,requestSha:j.sha,raw,rawSha:hash(raw),model:j.model,requestId:'receipt-fixture',stopReason:'end_turn',
  usd:estimateCostUsd(j.model,usage).usd!,elapsedMs:1,usage};
}
function card(j:Job):CardV3{
 const c:CardV3={schemaVersion:3,id:j.bindings[0],question:'Who built the blue gauge?',answer:'Mira Vale',variants:[],explanation:raw,claims:[],scaffolding:[]};
 c.claims=(['question','answer','explanation'] as const).map(field=>({id:`claim-${field}`,target:{field},span:{start:0,end:c[field].length,text:c[field]},
  assertion:raw,evidence:[{sourceId:source.id,start:0,end:raw.length,quote:raw}]}));return c;
}
function sourceReply(c:CardV3):ReviewV3{
 return{schemaVersion:3,id:c.id,claims:c.claims.map(a=>({...a,status:'supported',reason:'Fixture archive provides the relation.'})),
  coverage:([{field:'question'},{field:'answer'},{field:'explanation'}] as const).map(target=>({target,status:'complete',reason:'Supplied fixture review.'})),
  answers:[{target:{field:'answer'},status:'valid',basis:'source_relation',reason:'Correct builder.',evidence:[{sourceId:source.id,start:0,end:raw.length,quote:raw}]}]};
}
function fillInitial(d:FreshDesign,p:Progress,failSources=false){
 for(const j of knownJobs(d))p.calls[j.key]=receipt(j,j.kind==='writer'?JSON.stringify({status:'candidate',card:card(j)}):j.kind==='quality'?
  JSON.stringify({items:j.bindings.map(id=>({id,decision:'pass',category:'clear',reason:'Clear ask',spans:[]}))}):'{}');
 for(const j of materializeJobs(d,p).filter(j=>j.kind!=='writer'&&!p.calls[j.key])){
  if(j.kind==='quality')p.calls[j.key]=receipt(j,JSON.stringify({items:j.bindings.map(id=>({id,decision:'pass',category:'clear',reason:'Clear ask',spans:[]}))}));
  else{const writer=knownJobs(d).find(w=>w.kind==='writer'&&w.bindings[0]===j.bindings[0])!;p.calls[j.key]=receipt(j,failSources?'{}':JSON.stringify(sourceReply(card(writer))));}
 }
}
describe('fresh bounded plan and input isolation',()=>{
 it('retains 23 requests with 44 initial writers and all controls inside the $4 maximum',()=>{
  const d=design(),max=maximumPlan(d);
  expect(max.requests).toBe(23);expect(max.sourceShortageRequests).toBe(1);expect(max.initialWriters).toBe(44);expect(max.repairs).toBe(4);
  expect(max.maximumCalls).toBe(131);expect(max.reserveUsd).toBeCloseTo(3.9664,8);expect(knownJobs(d)).toHaveLength(67);
  expect(knownJobs(d).some(j=>j.requestId==='request-22')).toBe(false);
 });
 it('rejects a fully populated plan that exceeds the frozen cap, duplicate identities and control-label contamination',()=>{
  expect(()=>design(23)).toThrow('cap');
  const d=design();d.targets[1].blind.soft=d.targets[0].blind.soft;expect(()=>validateDesign(d)).toThrow('identities');
  const b=design();const payload=JSON.parse(b.controls[0].factual);payload.expectedSource='hold';b.controls[0].factual=JSON.stringify(payload);
  expect(()=>validateDesign(b)).toThrow('blind');
 });
 it('preserves exact source bytes and hashes actual effective SDK parameters',()=>{
  const j=knownJobs(design())[0];j.body='{"quote":"</items> remains data"}';j.sha=jobSha(j);
  expect(paramsForJob(j).messages[0].content).toBe(j.body);expect(paramsForJob(j).temperature).toBeUndefined();
  expect(jobSha({...j,maxOutputTokens:j.maxOutputTokens-1})).not.toBe(j.sha);
 });
 it('never sends writer claims, arm or explanations through the wrong reviewer channel',()=>{
  const d=design(),p=emptyProgress();fillInitial(d,p);
  for(const j of materializeJobs(d,p).filter(j=>j.kind==='factual'&&j.arm!=='control')){
   const b=JSON.parse(j.body);expect(b.claims).toBeUndefined();expect(b.arm).toBeUndefined();expect(b.scaffolding).toBeUndefined();
  }
  for(const j of materializeJobs(d,p).filter(j=>j.kind==='quality'))for(const i of JSON.parse(j.body).items){
   expect(i.explanation).toBeUndefined();expect(i.arm).toBeUndefined();expect(i.expectedSource).toBeUndefined();
  }
 });
});
describe('resumption and output-dependent stages',()=>{
 it('prepares factual requests from durable writers but waits for the full initial set before freezing quality batches',()=>{
  const d=design(),p=emptyProgress(),w=knownJobs(d)[0];p.calls[w.key]=receipt(w,JSON.stringify({status:'candidate',card:card(w)}));
  const jobs=materializeJobs(d,p);expect(jobs.filter(j=>j.kind==='factual'&&j.arm!=='control')).toHaveLength(1);
  expect(jobs.some(j=>j.key.startsWith('quality-generated'))).toBe(false);expect(jobs.some(j=>j.attempt===1)).toBe(false);
  expect(validateProgress(d,p,hash('design'))).toEqual(jobs);
 });
 it('chooses at most two repairs per arm deterministically and gives each only its own feedback',()=>{
  const d=design(),p=emptyProgress();fillInitial(d,p,true);
  const jobs=materializeJobs(d,p),repairs=jobs.filter(j=>j.kind==='writer'&&j.attempt===1);
  expect(repairs).toHaveLength(4);expect(repairs.filter(j=>j.arm==='soft')).toHaveLength(2);expect(repairs.filter(j=>j.arm==='strict')).toHaveLength(2);
  expect(materializeJobs(d,{calls:Object.fromEntries(Object.entries(p.calls).reverse()),blocked:{}})).toEqual(jobs);
  for(const r of repairs){const body=JSON.parse(r.body);expect(body.repairFeedback.quality.id).toBe(r.bindings[0]);
   expect(body.packet.eligibleFacts).toEqual(JSON.parse(knownJobs(d).find(j=>j.requestId===r.requestId&&j.arm===r.arm)!.body).packet.eligibleFacts);
  }
 });
 it('does not add repairs after a complete all-pass supplied review, and preserves a completed plan on resume',()=>{
  const d=design(),p=emptyProgress();fillInitial(d,p);
  const jobs=validateProgress(d,p,hash('design'));expect(jobs.some(j=>j.attempt===1)).toBe(false);
  expect(jobs.every(j=>!!p.calls[j.key])).toBe(true);expect(validateProgress(d,p,hash('design'))).toEqual(jobs);
 });
 it('refuses stale receipts, parent mutations, unknown ledger jobs and changed usage prices',()=>{
  const d=design(),p=emptyProgress(),j=knownJobs(d)[0],r=receipt(j,JSON.stringify({status:'candidate',card:card(j)}));
  for(const patch of [{requestSha:hash('changed')},{raw:r.raw+'x'},{usd:r.usd+0.01},{model:'claude-sonnet-5-5'}])expect(()=>validateReceipt({...r,...patch},j,hash('design'))).toThrow();
  p.calls[j.key]=r;const review=materializeJobs(d,p).find(j=>j.kind==='factual'&&j.arm!=='control')!;
  p.calls[review.key]=receipt(review,'{}');p.calls[j.key]={...r,raw:'{}',rawSha:hash('{}')};expect(()=>validateProgress(d,p,hash('design'))).toThrow();
 });
 it('reuses settled calls, settles an exact journal after a crash, and blocks every unknown charge or lost response',()=>{
  const j=knownJobs(design())[0],r=receipt(j,'{}');
  expect(receiptAction({status:'done',actualUsd:r.usd},r)).toBe('reuse');
  expect(receiptAction({status:'reserved'},r)).toBe('settle');
  expect(receiptAction({status:'reserved'},undefined)).toBe('block');
  expect(receiptAction({status:'uncertain'},r)).toBe('block');
  expect(receiptAction({status:'done',actualUsd:r.usd},undefined)).toBe('block');
  expect(receiptAction(undefined,r)).toBe('block');expect(receiptAction(undefined,undefined)).toBe('dispatch');
 });
 it('keeps malformed/truncated/oversized candidates unresolved and does not turn them into free successes',()=>{
  const d=design(),j=knownJobs(d)[0],c=card(j),r=receipt(j,JSON.stringify({status:'candidate',card:c})),packet=d.targets[0].packet;
  expect(assessWriterV3({...r,stopReason:'max_tokens'},packet,c.id).status).toBe('invalid');
  c.variants=['one','two','three'];expect(assessWriterV3(receipt(j,JSON.stringify({status:'candidate',card:c})),packet,c.id).status).toBe('invalid');
  expect(assessWriterV3(receipt(j,'{"status":"insufficient_supported_facts","reason":"No supported question at tier."}'),packet,c.id).status).toBe('shortage');
 });
 it('free planning finishes with poisoned credentials without constructing a provider or database client',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cassian-plan-')),file=join(dir,'design.json'),d=design();d.id=`cassian-fresh-v3-test-${hash(dir).slice(0,12)}`;
  writeFileSync(file,JSON.stringify(d));
  const result=spawnSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('scripts/cassian-fresh-calls.ts')],{
   encoding:'utf8',timeout:10000,env:{...process.env,CASSIAN_FRESH_DESIGN:file,ANTHROPIC_API_KEY:'invalid-test-key',DATABASE_URL:'invalid-test-url'}});
  expect(result.status).toBe(0);const summary=JSON.parse(result.stdout.trim());expect(summary.paidCalls).toBe(0);expect(summary.tokenCalls).toBe(0);
  const zero=spawnSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('scripts/cassian-fresh-calls.ts'),'--run','--limit','0'],{
   encoding:'utf8',timeout:10000,env:{...process.env,CASSIAN_FRESH_DESIGN:file,ANTHROPIC_API_KEY:'invalid-test-key',DATABASE_URL:'invalid-test-url'}});
  expect(zero.status).toBe(0);expect(JSON.parse(zero.stdout.trim()).tokenCalls).toBe(0);
 },15000);
});
