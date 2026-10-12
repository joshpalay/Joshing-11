/** Pure, bounded v4 compatibility probe. No credentials, provider client or database. */
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { hash, receiptAction, validateReceipt, receiptSchema, type Job, type Progress, type Receipt } from './cassian-fresh-dispatch-core';
import { packetWriterInput, type PreparedPacket } from './cassian-source-packets';
import { sourceV3Schema } from './cassian-evidence-v3';
import { ACCEPTANCE_POLICY_V4, cardV4Schema, assessWriterV4, assessReviewV4, assessEvidenceV4, reconstructionInputV4, outputFormatV4,
  writerV4Schema, reviewV4Schema, WRITER_COMMON_V4, WRITER_SOFT_V4, WRITER_STRICT_V4, RECONSTRUCTION_PROMPT_V4 } from './cassian-evidence-v4';
import { qualityInputV4, qualityV4Schema, assessQualityV4, QUALITY_PROMPT_V4 } from './cassian-quality-v4';
import { estimateCostUsd } from '../src/server/llm/pricing';
export { hash, receiptAction, receiptSchema, validateReceipt };
export type { Progress, Receipt };
const id=z.string().regex(/^[a-z0-9-]+$/),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const probeSchema=z.object({schemaVersion:z.literal(4),id:z.string().regex(/^cassian-compat-v4-[a-z0-9-]+$/),seed:z.string().min(1),maxRunUsd:z.literal(0.75),
  timeoutMs:z.literal(60000),files:z.array(z.object({path:z.string().min(1),sha}).strict()).min(1),
  priorDesignSha:sha,priorGoldSha:sha,scope:z.literal('known-case-format-budget-compatibility-not-reliability'),
  targets:z.array(z.object({slot:z.number().int().min(1).max(23),packet:z.custom<PreparedPacket>(),blind:z.object({soft:id,strict:id}).strict()}).strict()).length(2),
  controls:z.array(z.object({privateId:id,card:cardV4Schema,sources:z.array(sourceV3Schema),domain:z.string().min(1),tier:z.enum(['accessible','moderate','specialist'])}).strict()).length(8),
}).strict();
export type ProbeDesign=z.infer<typeof probeSchema>;
export type ProbeJob=Job&{format:Anthropic.JSONOutputFormat};
const limits={writer:{input:10000,output:3500},factual:{input:6500,output:3600},quality:{input:6500,output:1600}} as const;
const formats={writer:outputFormatV4(writerV4Schema),factual:outputFormatV4(reviewV4Schema),quality:outputFormatV4(qualityV4Schema)};
export function probeParams(j:ProbeJob):Anthropic.MessageCreateParamsNonStreaming{
  return{model:j.model,max_tokens:j.maxOutputTokens,system:j.system,messages:[{role:'user',content:j.body}],output_config:{format:j.format,...(j.kind==='writer'?{effort:'low' as const}:{})},
    thinking:j.kind==='writer'?{type:'adaptive'}:{type:'between_tools'} as unknown as Anthropic.ThinkingConfigParam};
}
export const probeBytes=(j:ProbeJob)=>Buffer.byteLength(JSON.stringify(probeParams(j)),'utf8');
const cost=(model:string,input:number,output:number)=>estimateCostUsd(model,{inputTokens:input,outputTokens:output,cacheReadTokens:0,cacheCreateTokens:0}).usd??Infinity;
function job(v:Omit<ProbeJob,'model'|'maxInputTokens'|'maxOutputTokens'|'reserveUsd'|'sha'|'format'>):ProbeJob{
  const model=v.kind==='writer'?'claude-haiku-5-5':'claude-sonnet-5-5';
  const input=v.kind==='factual'&&v.arm==='control'?(Buffer.byteLength(v.body,'utf8')>15000?13500:10000):limits[v.kind].input;
  const j={...v,model,maxInputTokens:input,maxOutputTokens:limits[v.kind].output,reserveUsd:cost(model,input,limits[v.kind].output),format:formats[v.kind],sha:''} as ProbeJob;
  const{sha:_sha,...rest}=j;j.sha=hash(JSON.stringify({job:rest,params:probeParams(j)}));return j;
}
export function knownProbeJobs(d:ProbeDesign):ProbeJob[]{
  const writers=d.targets.flatMap((t,n)=>(n%2?['strict','soft']:['soft','strict']).map(arm=>job({key:`writer-${t.packet.requestId}-${arm}`,kind:'writer',arm:arm as 'soft'|'strict',requestId:t.packet.requestId,attempt:0,
    system:WRITER_COMMON_V4+'\n'+(arm==='soft'?WRITER_SOFT_V4:WRITER_STRICT_V4),body:JSON.stringify({id:t.blind[arm as 'soft'|'strict'],packet:JSON.parse(packetWriterInput(t.packet)),acceptancePolicy:ACCEPTANCE_POLICY_V4}),bindings:[t.blind[arm as 'soft'|'strict']],parents:[]})));
  return[...writers,...d.controls.map(c=>job({key:`factual-${c.card.id}-control`,kind:'factual',arm:'control',requestId:null,attempt:0,system:RECONSTRUCTION_PROMPT_V4,
    body:reconstructionInputV4(c.card,c.sources),bindings:[c.card.id],parents:[]}))];
}
export function maximumProbe(d:ProbeDesign){
  const known=knownProbeJobs(d),factual=4,quality=2;
  return{writers:4,generatedFactual:factual,controlFactual:8,quality,maximumCalls:18,reserveUsd:known.reduce((s,j)=>s+j.reserveUsd,0)+factual*cost('claude-sonnet-5-5',6500,3600)+quality*cost('claude-sonnet-5-5',6500,1600)};
}
export function validateProbe(raw:unknown):ProbeDesign{
  const d=probeSchema.parse(raw),paths=d.files.map(f=>f.path),ids=d.targets.flatMap(t=>[t.blind.soft,t.blind.strict]).concat(d.controls.map(c=>c.card.id));
  if(new Set(paths).size!==paths.length||paths.some(p=>p.includes('..')||p.includes(':')||p.includes('\\')||! /^(scripts|src|_scratch\/Cassian)\//.test(p)&&p!=='package-lock.json')||
    ids.some(v=>!id.safeParse(v).success)||d.targets.some(t=>!id.safeParse(t.packet.requestId).success)||new Set(d.targets.map(t=>t.slot)).size!==2||
    new Set(ids).size!==ids.length||new Set(d.targets.map(t=>t.packet.requestId)).size!==2||new Set(d.controls.map(c=>c.privateId)).size!==8)throw Error('Invalid probe identities');
  for(const t of d.targets){const input=JSON.parse(packetWriterInput(t.packet));if(!input.eligibleFacts.length)throw Error('Compatibility writer needs prepared facts');}
  if(knownProbeJobs(d).some(j=>probeBytes(j)>40000)||maximumProbe(d).reserveUsd>d.maxRunUsd+1e-9)throw Error('Probe exceeds frozen envelope');return d;
}
export function probeJobs(d:ProbeDesign,p:Progress):ProbeJob[]{
  const known=knownProbeJobs(d),writers=known.filter(j=>j.kind==='writer');
  const records=writers.flatMap(w=>{const t=d.targets.find(t=>t.packet.requestId===w.requestId)!,r=p.calls[w.key];
    const out=r?assessWriterV4(r.raw,r.stopReason,t.packet,t.blind[w.arm as 'soft'|'strict'],w.arm as 'soft'|'strict'):null;return out?.card?[{t,w,card:out.card}]:[];});
  const factual=records.map(({t,w,card})=>job({key:`factual-${card.id}-generated`,kind:'factual',arm:w.arm,requestId:w.requestId,attempt:0,system:RECONSTRUCTION_PROMPT_V4,
    body:reconstructionInputV4(card,t.packet.sources),bindings:[card.id],parents:[{key:w.key,rawSha:p.calls[w.key].rawSha}]}));
  if(!writers.every(w=>p.calls[w.key]||p.blocked[w.key]))return[...known,...factual];
  const items=[...d.controls.map(c=>({input:{id:c.card.id,question:c.card.question,answer:c.card.answer,domain:c.domain,tier:c.tier},parent:null as Job|null})),
    ...records.map(({t,w,card})=>({input:{id:card.id,question:card.question,answer:card.answer,domain:t.packet.domain,tier:t.packet.tier as 'accessible'|'moderate'|'specialist'},parent:w}))]
    .sort((a,b)=>hash(`${d.seed}:quality:${a.input.id}`).localeCompare(hash(`${d.seed}:quality:${b.input.id}`)));
  const quality=[] as ProbeJob[];for(let n=0;n<items.length;n+=6){const batch=items.slice(n,n+6);quality.push(job({key:`quality-probe-${n/6+1}`,kind:'quality',arm:'mixed',requestId:null,attempt:0,
    system:QUALITY_PROMPT_V4,body:qualityInputV4(batch.map(i=>i.input)),bindings:batch.map(i=>i.input.id),parents:batch.flatMap(i=>i.parent?[{key:i.parent.key,rawSha:p.calls[i.parent.key].rawSha}]:[])}));}
  return[...known,...factual,...quality];
}
export function validateProbeProgress(d:ProbeDesign,p:Progress,designSha:string){
  const jobs=probeJobs(d,p);if(new Set(jobs.map(j=>j.key)).size!==jobs.length)throw Error('Duplicate probe job');
  for(const [key,r]of Object.entries(p.calls)){const j=jobs.find(j=>j.key===key);if(!j)throw Error('Unknown probe receipt');validateReceipt(r,j,designSha);}
  for(const [key,b]of Object.entries(p.blocked)){const j=jobs.find(j=>j.key===key);if(!j||p.calls[key]||b.requestSha!==j.sha||!b.reason)throw Error('Invalid blocked probe job');}
  if(jobs.length>18||jobs.reduce((s,j)=>s+j.reserveUsd,0)>d.maxRunUsd+1e-9)throw Error('Materialized probe exceeds cap');return jobs;
}
export function scoreProbe(d:ProbeDesign,p:Progress,jobs:ProbeJob[]){
  const quality=(id:string)=>{const j=jobs.find(j=>j.kind==='quality'&&j.bindings.includes(id)),r=j&&p.calls[j.key];return j&&r?assessQualityV4(r.raw,r.stopReason,JSON.parse(j.body).items).find(q=>q.id===id):null;};
  const writers=d.targets.flatMap(t=>(['soft','strict'] as const).map(arm=>{
    const key=`writer-${t.packet.requestId}-${arm}`,r=p.calls[key],out=r?assessWriterV4(r.raw,r.stopReason,t.packet,t.blind[arm],arm):null;
    const j=jobs.find(j=>j.kind==='factual'&&j.arm!=='control'&&j.bindings.includes(t.blind[arm])),fr=j&&p.calls[j.key];
    return{requestId:t.packet.requestId,slot:t.slot,arm,writerStatus:out?.status??'pending',writerIssues:out?.issues??[],card:out?.card??null,
      source:out?.card&&fr?assessEvidenceV4(fr.raw,fr.stopReason,out.card,t.packet,arm):null,quality:quality(t.blind[arm]),notServingApproval:true};
  }));
  const controls=d.controls.map(c=>{const r=p.calls[`factual-${c.card.id}-control`];return{id:c.privateId,blindId:c.card.id,
    source:r?assessReviewV4(r.raw,r.stopReason,c.card,c.sources):null,quality:quality(c.card.id),notServingApproval:true};});
  return{writers,controls,notServingApproval:true,scope:d.scope};
}
