import { describe, it, expect } from 'vitest';
import { assessWriter, requestSha, sha256, validateEvidenceManifest, validateEvidenceCheckpoint, type EvidenceManifest, type EvidenceRequest, type EvidenceReply } from './cassian-evidence-core';
import { assessReviewReply } from './cassian-targeted-core';
const req = (): EvidenceRequest => { const r: EvidenceRequest = { key:'writer-soft-a',kind:'writer',model:'claude-haiku-5-5',system:'System',body:'Input',maxTokens:3000,timeoutMs:30000,maxRetries:0,temperature:.8,thinking:'adaptive-low',sha:'' };r.sha=requestSha(r);return r; };
const manifest = (): EvidenceManifest => ({schemaVersion:1,id:'cassian-evidence-test',maxRunUsd:.5,files:[{path:'_scratch/Cassian/test/source.json',sha:sha256('source')}],requests:[req()]});
const reply = (): EvidenceReply => ({raw:'{}',rawSha:sha256('{}'),model:'claude-haiku-5-5',requestId:null,stopReason:'end_turn',usd:.001,elapsedMs:1000,usage:{inputTokens:100,outputTokens:50,cacheReadTokens:0,cacheCreateTokens:0}});
const context = {facts:[{id:'fact-a',evidence:[{sourceId:'source-a',quote:'Mira built the blue gauge.'}]}],sources:[{id:'source-a',text:'Mira built the blue gauge.'}]};
const card = () => { const c={status:'candidate',question:'Who built the blue gauge?',answer:'Mira',variants:['Mira'],explanation:'Mira built it.',factIds:['fact-a'],claims:[] as {field:string;quote:string;assertion:string;factIds:string[];evidence:{sourceId:string;quote:string}[]}[]};for(const f of ['question','answer','explanation','variants'] as const)c.claims.push({field:f,quote:f==='variants'?c.variants[0]:c[f],assertion:'Relation',factIds:['fact-a'],evidence:context.facts[0].evidence});return c; };
describe('offline evidence trial',()=>{
 it('accepts frozen writer requests and rejects body/settings/model drift',()=>{
  expect(validateEvidenceManifest(manifest()).requests).toHaveLength(1);
  for(const change of [{body:'changed'},{maxRetries:1},{model:'claude-sonnet-5-5'},{temperature:0},{thinking:'native-lowest'}]){
   const m=manifest();Object.assign(m.requests[0],change);m.requests[0].sha=requestSha(m.requests[0]);
   if('body' in change)m.requests[0].sha=req().sha;
   expect(()=>validateEvidenceManifest(m)).toThrow();
  }
 });
 it('rejects duplicate keys, excessive input and unsafe file identities',()=>{
  const m=manifest();m.requests.push(req());expect(()=>validateEvidenceManifest(m)).toThrow();
  for(const path of ['../secret','_scratch/Cassian/../secret','C:/secret','_scratch\\Cassian\\x'])expect(()=>validateEvidenceManifest({...manifest(),files:[{path,sha:sha256('x')}]})).toThrow();
  const oversized=req();oversized.body='x'.repeat(50001);oversized.sha=requestSha(oversized);expect(()=>validateEvidenceManifest({...manifest(),requests:[oversized]})).toThrow();
 });
 it('refuses changed raw content, model, unknown call and invalid costs',()=>{
  expect(()=>validateEvidenceCheckpoint(manifest(),{'writer-soft-a':reply()})).not.toThrow();
  for(const change of [{raw:'tampered'},{model:'wrong'},{usd:NaN},{elapsedMs:-1}])expect(()=>validateEvidenceCheckpoint(manifest(),{'writer-soft-a':{...reply(),...change}})).toThrow();
  expect(()=>validateEvidenceCheckpoint(manifest(),{unknown:reply()})).toThrow();
 });
 it('keeps truthful shortages and invalid/truncated cards in the attempt denominator',()=>{
  expect(assessWriter('{"status":"insufficient_supported_facts","reason":"No appropriate supported fact"}','end_turn','strict',context).status).toBe('shortage');
  expect(assessWriter(JSON.stringify(card()),'max_tokens','strict',context).status).toBe('invalid');
  expect(assessWriter('prose '+JSON.stringify(card()),'end_turn','strict',context).status).toBe('invalid');
 });
 it('accepts valid strict mechanics without claiming semantic truth',()=>{
  const c=card();c.answer='Nora';c.claims[1].quote='Nora';c.variants=['Nora'];c.claims[3].quote='Nora';
  expect(assessWriter(JSON.stringify(c),'end_turn','strict',context)).toMatchObject({status:'candidate',issues:[]});
 });
 it('rejects omitted claims, unselected fact links and fabricated source quotes',()=>{
  const c=card();c.claims.pop();c.claims[0].factIds=['other'];c.claims[1].evidence=[{sourceId:'source-a',quote:'Nora built it.'}];
  const result=assessWriter(JSON.stringify(c),'end_turn','strict',context);
  expect(result.issues).toEqual(expect.arrayContaining(['missing_field_claims','claim_fact_not_selected','source_quote_not_in_packet','unmapped_card_text']));
 });
 it('detects extra unsupported text outside supplied claim substrings',()=>{
  const c=card();c.explanation+=' The workshop opened in 1899.';
  expect(assessWriter(JSON.stringify(c),'end_turn','strict',context).issues).toContain('unmapped_card_text');
 });
 it('does not impose strict metadata on the soft comparator but still rejects malformed envelopes',()=>{
  const c=card();c.claims=[];c.factIds=[];
  expect(assessWriter(JSON.stringify(c),'end_turn','soft',context).issues).toEqual([]);
  expect(assessWriter(JSON.stringify({...c,question:' '}),'end_turn','soft',context).status).toBe('invalid');
 });
 it('checks whole-batch review IDs/quotes and fails closed on incomplete or nonfinal replies',()=>{
  const i={id:'a',question:'Who built the blue gauge?',answer:'Mira',variants:[],sources:context.sources};
  const a={id:'a',requestedFact:'builder',uncertain:false,disclosure:null,requestGroups:[{quote:'Who built',attribute:'name'}],otherDefects:[]};
  const r={...reply(),model:'claude-sonnet-5-5',raw:JSON.stringify({items:[a]})};
  expect(assessReviewReply('quality',[i],r)[0].decision).toBe('pass');
  expect(assessReviewReply('quality',[i],{...r,stopReason:'max_tokens'})[0].decision).toBe('review');
  expect(assessReviewReply('quality',[i],{...r,raw:'{"items":[]}'})[0].decision).toBe('review');
  expect(()=>assessReviewReply('quality',[i,i],r)).toThrow();
 });
 it('refuses reviewer metadata, labeled IDs and explanation contamination at quality input',()=>{
  const r: EvidenceRequest={...req(),key:'quality-controls',kind:'quality',model:'claude-sonnet-5-5',temperature:0,thinking:'native-lowest',body:''};
  const input={id:'case-01',question:'Who built the gauge?',answer:'Mira',variants:[],domain:'Gauge history',tier:'moderate'};
  const check=(body:object)=>{r.body=JSON.stringify({items:[body]});r.sha=requestSha(r);return()=>validateEvidenceManifest({...manifest(),requests:[r]});};
  expect(check(input)).not.toThrow();
  for(const extra of [{expectedDecision:'hold'},{writer:'haiku'},{explanation:'private evidence'},{id:'case-defect'}])expect(check({...input,...extra})).toThrow();
 });
});
