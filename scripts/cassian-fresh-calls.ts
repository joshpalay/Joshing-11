/** Opt-in, sequential evidence experiment. Free planning never loads credentials or clients. */
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import dotenv from 'dotenv';
import {validateDesign,maximumPlan,knownJobs,validateProgress,validateReceipt,receiptAction,paramsForJob,hash,emptyProgress,
 payloadBytes,MAX_PAYLOAD_BYTES,type Job,type Progress,type Receipt} from './cassian-fresh-dispatch-core';
import {assertReviewBudgetClear} from './cassian-targeted-core';
import {estimateCostUsd} from '../src/server/llm/pricing';
import {acquireRunnerLock,getBudgetStatus,getUnrelatedUncertainReserveUsd,reserveCall,settleCall,closeBudgetPool} from '../src/server/cassian/budget';

async function main(){
 const file=process.env.CASSIAN_FRESH_DESIGN;if(!file)throw Error('Set CASSIAN_FRESH_DESIGN to the frozen private v3 design.');
 const bytes=readFileSync(resolve(file)),designSha=hash(bytes),d=validateDesign(JSON.parse(bytes.toString('utf8')));
 for(const pin of d.files)if(hash(readFileSync(resolve(pin.path)))!==pin.sha)throw Error(`Frozen runtime/input changed: ${pin.path}`);
 const dir=resolve('_scratch/Cassian',d.id),checkpoint=resolve(dir,'checkpoint.json'),requestDir=resolve(dir,'requests'),receiptDir=resolve(dir,'receipts');
 const saved=existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):{designSha,progress:emptyProgress(),preflights:{}};
 if(saved.designSha!==designSha)throw Error('Checkpoint design changed; never repeat calls.');
 const p=saved.progress as Progress;
 // Per-call journals recover an interrupted aggregate save, without another provider call.
 if(existsSync(receiptDir))for(const name of readdirSync(receiptDir)){
  if(!name.endsWith('.json'))continue;const r=JSON.parse(readFileSync(resolve(receiptDir,name),'utf8')) as Receipt;
  if(p.calls[r.key]&&JSON.stringify(p.calls[r.key])!==JSON.stringify(r))throw Error('Journal/checkpoint conflict');p.calls[r.key]=r;
 }
 let jobs=validateProgress(d,p,designSha),paidCalls=0,tokenCalls=0;
 const flags=process.argv.slice(2),allowed=['--run','--resume','--preflight','--budget','--score-only','--limit'];
 for(let n=0;n<flags.length;n++){if(flags[n]==='--limit'){n++;continue;}if(!allowed.includes(flags[n]))throw Error('Unknown fresh-run flag');}
 const run=flags.includes('--run')||flags.includes('--resume'),preflight=flags.includes('--preflight'),budgetOnly=flags.includes('--budget'),scoreOnly=flags.includes('--score-only');
 if((scoreOnly&&(run||preflight||budgetOnly))||(budgetOnly&&(run||preflight)))throw Error('Incompatible fresh-run flags');
 const at=flags.indexOf('--limit'),limit=at<0?maximumPlan(d).maximumCalls:Number(flags[at+1]);
 if(!Number.isInteger(limit)||limit<0||limit>maximumPlan(d).maximumCalls)throw Error('Invalid paid-call limit');
 const summary=()=>({runId:d.id,designSha,maximum:maximumPlan(d),materialized:jobs.length,completed:Object.keys(p.calls).length,
  blocked:Object.keys(p.blocked).length,remaining:jobs.filter(j=>!p.calls[j.key]&&!p.blocked[j.key]).length,
  responseUsd:Object.values(p.calls).reduce((s,r)=>s+r.usd,0),paidCalls,tokenCalls,notServingApproval:true});
 if((!run&&!preflight&&!budgetOnly)||(run&&limit===0)){console.log(JSON.stringify(summary()));return;}
 dotenv.config({path:process.env.CASSIAN_ENV_FILE||'.env.local',quiet:true});
 if(budgetOnly){try{const status=await getBudgetStatus(d.id),carried=await getUnrelatedUncertainReserveUsd(d.id);
  assertReviewBudgetClear(status.lifetimeReservedUsd,carried,status.reservedUsd);
  console.log(JSON.stringify({...summary(),budget:status,carriedUncertaintyUsd:carried,availableUsd:10-status.lifetimeSpentUsd-status.lifetimeReservedUsd}));
 }finally{await closeBudgetPool();}return;}
 if(!process.env.ANTHROPIC_API_KEY||(run&&!process.env.DATABASE_URL))throw Error('Missing fresh-run credentials');
 const saveJson=(path:string,value:unknown)=>{mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);};
 const save=()=>saveJson(checkpoint,saved);
 const bind=(j:Job)=>{const path=resolve(requestDir,`${j.key}.json`);if(existsSync(path)){
  if(JSON.stringify(JSON.parse(readFileSync(path,'utf8')))!==JSON.stringify(j))throw Error('Frozen materialized request changed');
 }else saveJson(path,j);};
 const unlock=run?await acquireRunnerLock():async()=>{};
 try{
  if(run){
   const status=await getBudgetStatus(d.id);
   // Recover only exact, repriced local receipts for this manifest's reserved calls.
   for(const[key,ledger]of Object.entries(status.calls)){
    const j=jobs.find(j=>j.key===key);if(!j)throw Error('Unknown ledger job; stop before provider access');
    if(p.calls[key])validateReceipt(p.calls[key],j,designSha);
    const action=receiptAction(ledger,p.calls[key]);
    if(action==='block')throw Error(`Unresolved/missing receipt for ${key}; never repeat`);
    if(action==='settle')await settleCall({runId:d.id,key,actualUsd:p.calls[key].usd});
   }
   for(const key of Object.keys(p.calls))if(!status.calls[key])throw Error('Local receipt lacks ledger reservation');
   const before=await getBudgetStatus(d.id);
   assertReviewBudgetClear(before.lifetimeReservedUsd,await getUnrelatedUncertainReserveUsd(d.id),before.reservedUsd);
   if(before.spentUsd+maximumPlan(d).reserveUsd-Object.values(p.calls).reduce((s,r)=>s+jobs.find(j=>j.key===r.key)!.reserveUsd,0)>d.maxRunUsd+1e-9)
    throw Error('Remaining maximum does not fit run cap');
   if(10-before.lifetimeSpentUsd-before.lifetimeReservedUsd<maximumPlan(d).reserveUsd-Object.values(p.calls).reduce((s,r)=>s+jobs.find(j=>j.key===r.key)!.reserveUsd,0)-1e-9)
    throw Error('Remaining maximum does not fit lifetime budget');
   // A completed resume returns before loading the provider client or counting tokens.
   if(jobs.every(j=>p.calls[j.key]||p.blocked[j.key])){save();console.log(JSON.stringify(summary()));return;}
  }
  const llm=await import('../src/lib/llm'),client=llm.getAnthropicClient();if(!client)throw Error('Anthropic client unavailable');
  const count=async(j:Job)=>{
   bind(j);const old=saved.preflights[j.key];if(old){if(old.requestSha!==j.sha||!Number.isInteger(old.inputTokens)||old.inputTokens<0)throw Error('Invalid frozen token count');return old.inputTokens;}
   const params=paramsForJob(j);tokenCalls++;
   const started=Date.now();try{
    const response=await client.messages.countTokens({model:params.model,system:params.system,messages:params.messages,thinking:params.thinking},
     {maxRetries:0,signal:AbortSignal.timeout(30000)});
    if(!Number.isInteger(response.input_tokens)||response.input_tokens<0)throw Error('Invalid provider token count');
    saved.preflights[j.key]={requestSha:j.sha,inputTokens:response.input_tokens,elapsedMs:Date.now()-started,at:new Date().toISOString()};save();return response.input_tokens;
   }catch(error){saveJson(resolve(dir,`count-failure-${j.key}.json`),{key:j.key,requestSha:j.sha,at:new Date().toISOString(),elapsedMs:Date.now()-started,
    paidCallStarted:false,providerCharge:0,reason:error instanceof Error?error.message.slice(0,200):'Token-count failure'});throw error;}
  };
  // Freeze/count all known initial/control requests before the first paid call, with a 1000-token headroom.
  for(const j of knownJobs(d)){if(p.calls[j.key]||p.blocked[j.key])continue;
   if(await count(j)>j.maxInputTokens-1000)throw Error(`Static request ${j.key} exceeds frozen token envelope; no paid dispatch`);
  }
  if(!run){console.log(JSON.stringify({...summary(),knownPreflights:Object.keys(saved.preflights).length}));return;}
  while(paidCalls<limit){
   jobs=validateProgress(d,p,designSha);
   const j=jobs.find(j=>!p.calls[j.key]&&!p.blocked[j.key]);if(!j)break;
   bind(j);
   if(payloadBytes(j)>MAX_PAYLOAD_BYTES){p.blocked[j.key]={requestSha:j.sha,reason:'output-dependent byte envelope exceeded; no paid call'};save();continue;}
   if(await count(j)>j.maxInputTokens-1000){p.blocked[j.key]={requestSha:j.sha,reason:'output-dependent token envelope exceeded; no paid call'};save();continue;}
   const state=await getBudgetStatus(d.id);assertReviewBudgetClear(state.lifetimeReservedUsd,await getUnrelatedUncertainReserveUsd(d.id),state.reservedUsd);
   const reservation=await reserveCall({runId:d.id,manifestSha:designSha,key:j.key,reserveUsd:j.reserveUsd,runCap:d.maxRunUsd});
   if(reservation==='already_done')throw Error('Settled call without receipt; never repeat');
   const started=Date.now();let receipt:Receipt|undefined;
   try{
    paidCalls++;
    const response=await client.messages.create(paramsForJob(j),{maxRetries:0,signal:AbortSignal.timeout(30000)});
    const usage={inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,cacheReadTokens:response.usage.cache_read_input_tokens??0,cacheCreateTokens:response.usage.cache_creation_input_tokens??0};
    const usd=estimateCostUsd(response.model,usage).usd;if(usd===null)throw Error('Unpriced response');
    const raw=llm.extractTextContent(response.content);
    receipt=validateReceipt({designSha,key:j.key,requestSha:j.sha,raw,rawSha:hash(raw),model:response.model,requestId:response._request_id??null,
     stopReason:response.stop_reason,usd,elapsedMs:Date.now()-started,usage},j,designSha);
    // Journal precedes aggregate checkpoint and settlement; a crash never licenses replay.
    saveJson(resolve(receiptDir,`${j.key}.json`),receipt);p.calls[j.key]=receipt;save();
   }catch(error){const reason=error instanceof Error?error.message.slice(0,200):'Unknown paid-call failure';
    try{saveJson(resolve(dir,`failure-${j.key}.json`),{designSha,key:j.key,requestSha:j.sha,at:new Date().toISOString(),started:new Date(started).toISOString(),
     reserveUsd:j.reserveUsd,charge:receipt?'known':'unknown',actualUsd:receipt?.usd??null,requestId:receipt?.requestId??null,retried:false,reason});}
    finally{await settleCall({runId:d.id,key:j.key,actualUsd:receipt?.usd??null,reason});}throw error;}
   await settleCall({runId:d.id,key:j.key,actualUsd:receipt.usd});
   console.log(JSON.stringify({key:j.key,usd:receipt.usd,elapsedMs:receipt.elapsedMs}));
   if(receipt.usd>j.reserveUsd+1e-9||receipt.usage.inputTokens+receipt.usage.cacheReadTokens+receipt.usage.cacheCreateTokens>j.maxInputTokens||receipt.usage.outputTokens>j.maxOutputTokens)
    throw Error('Provider usage exceeded frozen envelope; stop after recording actual charge');
  }
  jobs=validateProgress(d,p,designSha);save();console.log(JSON.stringify(summary()));
 }finally{await unlock();await closeBudgetPool();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
