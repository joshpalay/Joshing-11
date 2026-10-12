/** Opt-in compatibility probe; frozen receipts/ledger rules prevent replay after uncertain calls. */
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import dotenv from 'dotenv';
import {validateProbe,maximumProbe,knownProbeJobs,validateProbeProgress,probeParams,probeBytes,scoreProbe,hash,receiptAction,validateReceipt,type ProbeJob,type Progress,type Receipt} from './cassian-compat-core';
import {assertReviewBudgetClear} from './cassian-targeted-core';
import {estimateCostUsd} from '../src/server/llm/pricing';
import {acquireRunnerLock,getBudgetStatus,getUnrelatedUncertainReserveUsd,reserveCall,settleCall,closeBudgetPool} from '../src/server/cassian/budget';

async function main(){
 const file=process.env.CASSIAN_COMPAT_DESIGN;if(!file)throw Error('Set CASSIAN_COMPAT_DESIGN to the frozen private v4 probe.');
 const bytes=readFileSync(resolve(file)),designSha=hash(bytes),d=validateProbe(JSON.parse(bytes.toString('utf8')));
 for(const pin of d.files)if(hash(readFileSync(resolve(pin.path)))!==pin.sha)throw Error(`Frozen runtime/input changed: ${pin.path}`);
 const dir=resolve('_scratch/Cassian',d.id),checkpoint=resolve(dir,'checkpoint.json'),requests=resolve(dir,'requests'),receipts=resolve(dir,'receipts');
 const saved=existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):{designSha,progress:{calls:{},blocked:{}},preflights:{}};
 if(saved.designSha!==designSha)throw Error('Checkpoint design changed; never repeat calls');
 const p=saved.progress as Progress;
 if(existsSync(receipts))for(const name of readdirSync(receipts)){if(!name.endsWith('.json'))continue;const r=JSON.parse(readFileSync(resolve(receipts,name),'utf8')) as Receipt;
  if(p.calls[r.key]&&JSON.stringify(p.calls[r.key])!==JSON.stringify(r))throw Error('Journal/checkpoint conflict');p.calls[r.key]=r;}
 let jobs=validateProbeProgress(d,p,designSha),paidCalls=0,tokenCalls=0;
 const flags=process.argv.slice(2),allowed=['--run','--resume','--preflight','--budget','--score-only','--limit'];
 for(let n=0;n<flags.length;n++){if(flags[n]==='--limit'){n++;continue;}if(!allowed.includes(flags[n]))throw Error('Unknown probe flag');}
 const run=flags.includes('--run')||flags.includes('--resume'),preflight=flags.includes('--preflight'),budget=flags.includes('--budget'),scoreOnly=flags.includes('--score-only');
 if((scoreOnly&&(run||preflight||budget))||(budget&&(run||preflight)))throw Error('Incompatible probe flags');
 const at=flags.indexOf('--limit'),limit=at<0?18:Number(flags[at+1]);if(!Number.isInteger(limit)||limit<0||limit>18)throw Error('Invalid paid-call limit');
 const summary=()=>({runId:d.id,designSha,maximum:maximumProbe(d),materialized:jobs.length,completed:Object.keys(p.calls).length,blocked:Object.keys(p.blocked).length,
  remaining:jobs.filter(j=>!p.calls[j.key]&&!p.blocked[j.key]).length,responseUsd:Object.values(p.calls).reduce((s,r)=>s+r.usd,0),paidCalls,tokenCalls,notServingApproval:true});
 if((!run&&!preflight&&!budget)||(run&&limit===0)){console.log(JSON.stringify({...summary(),scores:scoreProbe(d,p,jobs)}));return;}
 dotenv.config({path:process.env.CASSIAN_ENV_FILE||'.env.local',quiet:true});
 if(budget){try{const status=await getBudgetStatus(d.id),carried=await getUnrelatedUncertainReserveUsd(d.id);assertReviewBudgetClear(status.lifetimeReservedUsd,carried,status.reservedUsd);
  console.log(JSON.stringify({...summary(),budget:status,carriedUncertaintyUsd:carried,availableUsd:10-status.lifetimeSpentUsd-status.lifetimeReservedUsd}));}finally{await closeBudgetPool();}return;}
 if(!process.env.ANTHROPIC_API_KEY||(run&&!process.env.DATABASE_URL))throw Error('Missing probe credentials');
 const saveJson=(path:string,value:unknown)=>{mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);};
 const save=()=>saveJson(checkpoint,saved);
 const bind=(j:ProbeJob)=>{const path=resolve(requests,j.key+'.json');if(existsSync(path)){if(JSON.stringify(JSON.parse(readFileSync(path,'utf8')))!==JSON.stringify(j))throw Error('Materialized request changed');}else saveJson(path,j);};
 const unlock=run?await acquireRunnerLock():async()=>{};
 try{
  if(run){const status=await getBudgetStatus(d.id);
   for(const[key,ledger]of Object.entries(status.calls)){const j=jobs.find(j=>j.key===key);if(!j)throw Error('Unknown ledger job');if(p.calls[key])validateReceipt(p.calls[key],j,designSha);
    const action=receiptAction(ledger,p.calls[key]);if(action==='block')throw Error(`Unresolved/missing receipt for ${key}; never repeat`);if(action==='settle')await settleCall({runId:d.id,key,actualUsd:p.calls[key].usd});}
   for(const key of Object.keys(p.calls))if(!status.calls[key])throw Error('Local receipt lacks ledger reservation');
   const before=await getBudgetStatus(d.id);assertReviewBudgetClear(before.lifetimeReservedUsd,await getUnrelatedUncertainReserveUsd(d.id),before.reservedUsd);
   const remaining=maximumProbe(d).reserveUsd-Object.values(p.calls).reduce((s,r)=>s+jobs.find(j=>j.key===r.key)!.reserveUsd,0);
   if(before.spentUsd+remaining>d.maxRunUsd+1e-9||10-before.lifetimeSpentUsd-before.lifetimeReservedUsd<remaining-1e-9)throw Error('Remaining maximum does not fit budget');
   if(jobs.every(j=>p.calls[j.key]||p.blocked[j.key])){save();console.log(JSON.stringify(summary()));return;}
  }
  const llm=await import('../src/lib/llm'),client=llm.getAnthropicClient();if(!client)throw Error('Anthropic client unavailable');
  const count=async(j:ProbeJob)=>{bind(j);const old=saved.preflights[j.key];if(old){if(old.requestSha!==j.sha||!Number.isInteger(old.inputTokens)||old.inputTokens<0)throw Error('Invalid frozen token count');return old.inputTokens;}
   const params=probeParams(j),started=Date.now();tokenCalls++;
   try{const response=await client.messages.countTokens({model:params.model,system:params.system,messages:params.messages,thinking:params.thinking,output_config:params.output_config},
    {maxRetries:0,signal:AbortSignal.timeout(d.timeoutMs)});
    if(!Number.isInteger(response.input_tokens)||response.input_tokens<0)throw Error('Invalid token count');saved.preflights[j.key]={requestSha:j.sha,inputTokens:response.input_tokens,elapsedMs:Date.now()-started,at:new Date().toISOString()};save();return response.input_tokens;
   }catch(error){saveJson(resolve(dir,'count-failure-'+j.key+'.json'),{key:j.key,at:new Date().toISOString(),requestSha:j.sha,paidCallStarted:false,providerCharge:0,reason:error instanceof Error?error.message.slice(0,200):'Token count failure'});throw error;}};
  for(const j of knownProbeJobs(d)){if(p.calls[j.key]||p.blocked[j.key])continue;if(await count(j)>j.maxInputTokens-1000)throw Error(`Static ${j.key} exceeds frozen token envelope; no paid dispatch`);}
  if(!run){console.log(JSON.stringify({...summary(),knownPreflights:Object.keys(saved.preflights).length}));return;}
  while(paidCalls<limit){jobs=validateProbeProgress(d,p,designSha);const j=jobs.find(j=>!p.calls[j.key]&&!p.blocked[j.key]);if(!j)break;bind(j);
   if(probeBytes(j)>40000||await count(j)>j.maxInputTokens-1000){p.blocked[j.key]={requestSha:j.sha,reason:'output-dependent envelope exceeded; no paid call'};save();continue;}
   const status=await getBudgetStatus(d.id);assertReviewBudgetClear(status.lifetimeReservedUsd,await getUnrelatedUncertainReserveUsd(d.id),status.reservedUsd);
   if(await reserveCall({runId:d.id,manifestSha:designSha,key:j.key,reserveUsd:j.reserveUsd,runCap:d.maxRunUsd})==='already_done')throw Error('Settled call without receipt; never repeat');
   const started=Date.now();let receipt:Receipt|undefined,knownUsd:number|null=null;
   try{paidCalls++;const response=await client.messages.create(probeParams(j),{maxRetries:0,signal:AbortSignal.timeout(d.timeoutMs)});
    const usage={inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,cacheReadTokens:response.usage.cache_read_input_tokens??0,cacheCreateTokens:response.usage.cache_creation_input_tokens??0};
    knownUsd=estimateCostUsd(response.model,usage).usd;if(knownUsd===null)throw Error('Unpriced response');const raw=llm.extractTextContent(response.content);
    receipt=validateReceipt({designSha,key:j.key,requestSha:j.sha,raw,rawSha:hash(raw),model:response.model,requestId:response._request_id??null,stopReason:response.stop_reason,usd:knownUsd,elapsedMs:Date.now()-started,usage},j,designSha);
    saveJson(resolve(receipts,j.key+'.json'),receipt);p.calls[j.key]=receipt;save();
   }catch(error){const reason=error instanceof Error?error.message.slice(0,200):'Paid-call failure';try{saveJson(resolve(dir,'failure-'+j.key+'.json'),{designSha,key:j.key,requestSha:j.sha,at:new Date().toISOString(),reserveUsd:j.reserveUsd,actualUsd:knownUsd,charge:knownUsd===null?'unknown':'known',retried:false,reason});}
    finally{await settleCall({runId:d.id,key:j.key,actualUsd:knownUsd,reason});}throw error;}
   await settleCall({runId:d.id,key:j.key,actualUsd:receipt.usd});console.log(JSON.stringify({key:j.key,usd:receipt.usd,elapsedMs:receipt.elapsedMs,stopReason:receipt.stopReason}));
   if(receipt.usd>j.reserveUsd+1e-9||receipt.usage.inputTokens+receipt.usage.cacheReadTokens+receipt.usage.cacheCreateTokens>j.maxInputTokens||receipt.usage.outputTokens>j.maxOutputTokens)throw Error('Provider usage exceeded frozen envelope; actual charge recorded');
  }
  jobs=validateProbeProgress(d,p,designSha);save();console.log(JSON.stringify(summary()));
 }finally{await unlock();await closeBudgetPool();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
