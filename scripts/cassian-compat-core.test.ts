import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import { validateProbe, maximumProbe, knownProbeJobs, probeJobs, probeParams, validateProbeProgress, validateReceipt, receiptAction, hash, type ProbeDesign, type ProbeJob, type Progress } from './cassian-compat-core';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const rawText='Mira Vale designed the lamp in 1842.';
const source=readableSource({id:'source-a',url:'https://example.com/history',title:'Fixture',section:'History',edition:null,captureSha:sha(rawText),extractionSha:sha(rawText),rawText,removed:[],locator:'fixture'});
function fixture():ProbeDesign{return{schemaVersion:4,id:'cassian-compat-v4-fixture',seed:'fixture',maxRunUsd:0.75,timeoutMs:60000,files:[{path:'scripts/cassian-compat-core.ts',sha:sha('fixture')}],priorDesignSha:sha('old'),priorGoldSha:sha('gold'),scope:'known-case-format-budget-compatibility-not-reliability',
 targets:[1,2].map(n=>({slot:n,packet:{requestId:`request-${n}`,domain:'Inventors',tier:'moderate',scope:'accepted',sources:[source],facts:[{id:'fact-a',assertion:rawText,evidence:[{sourceId:source.id,start:0,end:rawText.length,quote:rawText}],support:'reviewed',novelty:'clear',rationale:'Fixture'}],preparer:{role:'prompt-author',independent:false}},blind:{soft:`writer-${n}-soft`,strict:`writer-${n}-strict`}})),
 controls:Array.from({length:8},(_,n)=>({privateId:`gold-${n}`,card:{schemaVersion:4,id:`control-${n}`,question:'Who designed the lamp in 1842?',answer:'Mira Vale',explanation:rawText,variants:[],claims:[],scaffolding:[]},sources:[source],domain:'Inventors',tier:'moderate'}))};}
const empty=():Progress=>({calls:{},blocked:{}});
const receipt=(j:ProbeJob,raw:string,stop='end_turn')=>validateReceipt({designSha:sha('design'),key:j.key,requestSha:j.sha,raw,rawSha:hash(raw),model:j.model,requestId:'request-fixture',stopReason:stop,usd:j.kind==='writer'?0.0000006:0.000012,
 elapsedMs:1,usage:{inputTokens:1,outputTokens:1,cacheReadTokens:0,cacheCreateTokens:0}},j,sha('design'));
const candidate=(j:ProbeJob)=>JSON.stringify({status:'candidate',reason:'',card:{schemaVersion:4,id:j.bindings[0],question:'Who designed the lamp in 1842?',answer:'Mira Vale',explanation:rawText,variants:[],claims:[],scaffolding:[]}});

describe('frozen compatibility scheduler',()=>{
 it('fits an eighteen-call maximum, uses native formats, and alternates writer order',()=>{
  const d=validateProbe(fixture()),jobs=knownProbeJobs(d);expect(jobs).toHaveLength(12);expect(maximumProbe(d).maximumCalls).toBe(18);expect(maximumProbe(d).reserveUsd).toBeLessThan(0.75);
  expect(jobs.slice(0,4).map(j=>j.arm)).toEqual(['soft','strict','strict','soft']);
  for(const j of jobs){expect(probeParams(j).output_config?.format?.type).toBe('json_schema');expect(probeParams(j)).not.toHaveProperty('tools');}
  expect(probeParams(jobs[0]).max_tokens).toBe(3500);
 });
 it('blinds source controls and transmits operational policy without private gold or inventories',()=>{
  const j=knownProbeJobs(fixture()).find(j=>j.arm==='control')!,body=JSON.parse(j.body);
  expect(j.body).not.toContain('gold-');expect(body).not.toHaveProperty('claims');expect(body.acceptancePolicy).toBeDefined();
 });
 it('defers stable mixed quality batches until all writers finish and excludes variants',()=>{
  const d=fixture(),p=empty(),known=knownProbeJobs(d);p.calls[known[0].key]=receipt(known[0],candidate(known[0]));
  expect(probeJobs(d,p).filter(j=>j.kind==='quality')).toHaveLength(0);
  for(const j of known.filter(j=>j.kind==='writer'))p.calls[j.key]=receipt(j,candidate(j));
  const jobs=probeJobs(d,p);expect(jobs).toHaveLength(18);expect(jobs.filter(j=>j.kind==='quality')).toHaveLength(2);
  for(const j of jobs.filter(j=>j.kind==='quality')){expect(JSON.parse(j.body).items).toHaveLength(6);expect(j.body).not.toContain('variants');expect(j.body).not.toContain('explanation');}
 });
 it('does not create generated reviews for nonfinal writer JSON or add repair calls',()=>{
  const d=fixture(),p=empty(),known=knownProbeJobs(d);for(const j of known.filter(j=>j.kind==='writer'))p.calls[j.key]=receipt(j,candidate(j),'max_tokens');
  const jobs=probeJobs(d,p);expect(jobs).toHaveLength(14);expect(jobs.filter(j=>j.kind==='factual')).toHaveLength(8);expect(jobs.every(j=>j.attempt===0)).toBe(true);
 });
 it('binds dynamic requests to exact writer receipts and rejects stale provenance',()=>{
  const d=fixture(),p=empty(),w=knownProbeJobs(d)[0];p.calls[w.key]=receipt(w,candidate(w));
  const jobs=validateProbeProgress(d,p,sha('design')),sourceJob=jobs.find(j=>j.arm==='soft'&&j.kind==='factual')!;
  expect(sourceJob.parents).toEqual([{key:w.key,rawSha:p.calls[w.key].rawSha}]);
  p.calls[w.key]={...p.calls[w.key],rawSha:sha('different')};expect(()=>validateProbeProgress(d,p,sha('design'))).toThrow();
 });
 it('preserves settlement recovery and blocks lost or uncertain responses',()=>{
  const j=knownProbeJobs(fixture())[0],r=receipt(j,candidate(j));
  expect(receiptAction({status:'reserved'},r)).toBe('settle');expect(receiptAction({status:'done',actualUsd:r.usd},r)).toBe('reuse');
  expect(receiptAction({status:'uncertain'},r)).toBe('block');expect(receiptAction({status:'done',actualUsd:r.usd},undefined)).toBe('block');
 });
 it('rejects unsafe paths, duplicate identities, source preparation shortages and receipt price drift',()=>{
  const d=fixture();d.files[0].path='../other';expect(()=>validateProbe(d)).toThrow();
  const duplicate=fixture();duplicate.controls[0].card.id=duplicate.targets[0].blind.soft;expect(()=>validateProbe(duplicate)).toThrow();
  const missing=fixture();missing.targets[0].packet.scope='unresolved';expect(()=>validateProbe(missing)).toThrow();
  const j=knownProbeJobs(fixture())[0],r=receipt(j,candidate(j));expect(()=>validateReceipt({...r,usd:1},j,sha('design'))).toThrow();
 });
 it('keeps default and zero-limit execution free with poisoned credentials',()=>{
  const root=`_scratch/Cassian/probe-free-${randomUUID()}`;mkdirSync(root,{recursive:true});const pin=root+'/pin.txt';writeFileSync(pin,'fixture');
  const d=fixture();d.files=[{path:pin,sha:sha('fixture')}];const path=root+'/design.json';writeFileSync(path,JSON.stringify(d));
  for(const flags of [[],['--run','--limit','0']]){const r=spawnSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),'scripts/cassian-compat-calls.ts',...flags],{
   encoding:'utf8',env:{...process.env,CASSIAN_COMPAT_DESIGN:path,ANTHROPIC_API_KEY:'poison',DATABASE_URL:'poison',CASSIAN_ENV_FILE:'missing-env-file'},timeout:15000});
   expect(r.status,r.stderr).toBe(0);const out=JSON.parse(r.stdout.trim());expect(out.paidCalls).toBe(0);expect(out.tokenCalls).toBe(0);}
 });
});
