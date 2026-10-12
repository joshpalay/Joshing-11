/** Sequential frozen offline calls. Free plan/summary precede env, database and client use. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { validateEvidenceManifest, validateEvidenceCheckpoint, sha256, type EvidenceReply } from './cassian-evidence-core';
import { assertReviewBudgetClear } from './cassian-targeted-core';
import { estimateCostUsd } from '../src/server/llm/pricing';
import { acquireRunnerLock, getBudgetStatus, getUnrelatedUncertainReserveUsd, reserveCall, settleCall, closeBudgetPool } from '../src/server/cassian/budget';

async function main() {
  if (!process.env.CASSIAN_MANIFEST_FILE) throw new Error('Set the frozen private CASSIAN_MANIFEST_FILE.');
  const bytes=readFileSync(resolve(process.env.CASSIAN_MANIFEST_FILE)), manifestSha=sha256(bytes);
  const m=validateEvidenceManifest(JSON.parse(bytes.toString('utf8')));
  for (const file of m.files) if (sha256(readFileSync(resolve(file.path))) !== file.sha) throw new Error('Frozen evidence/runtime file changed.');
  const dir=resolve('_scratch/Cassian',m.id), path=resolve(dir,'checkpoint.json');
  const cp: { manifestSha: string; calls: Record<string,EvidenceReply> }=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{manifestSha,calls:{}};
  if (cp.manifestSha!==manifestSha) throw new Error('Frozen manifest differs from checkpoint.');
  validateEvidenceCheckpoint(m,cp.calls);
  const paid=process.argv.includes('--run')||process.argv.includes('--resume'), scoreOnly=process.argv.includes('--score-only');
  if (scoreOnly&&paid) throw new Error('Free summary cannot use paid flags.');
  const limitIndex=process.argv.indexOf('--limit');
  const limit=limitIndex<0?m.requests.length:Number(process.argv[limitIndex+1]);
  if(!Number.isInteger(limit)||limit<0||limit>m.requests.length)throw new Error('Invalid limit.');
  let paidCalls=0;
  const summary=()=>console.log(JSON.stringify({runId:m.id,manifestSha,plannedCalls:m.requests.length,completedCalls:Object.keys(cp.calls).length,
    spentUsd:Object.values(cp.calls).reduce((n,c)=>n+c.usd,0),runCapUsd:m.maxRunUsd,paidCalls}));
  if(scoreOnly){summary();return;}
  if(!paid){
    const estimatedUsd=m.requests.reduce((sum,r)=>sum+(estimateCostUsd(r.model,{inputTokens:Math.ceil((r.system.length+r.body.length)/3),outputTokens:r.kind==='writer'?800:1800,cacheReadTokens:0,cacheCreateTokens:0}).usd??Infinity),0);
    console.log(JSON.stringify({runId:m.id,manifestSha,plannedCalls:m.requests.length,estimatedUsd,runCapUsd:m.maxRunUsd,paidCalls:0}));return;
  }
  dotenv.config({path:process.env.CASSIAN_ENV_FILE||'.env.local',quiet:true});
  if(!process.env.DATABASE_URL||!process.env.ANTHROPIC_API_KEY)throw new Error('Missing evidence-run credentials.');
  const unlock=await acquireRunnerLock();
  try{
    const before=await getBudgetStatus(m.id);
    assertReviewBudgetClear(before.lifetimeReservedUsd,await getUnrelatedUncertainReserveUsd(m.id),before.reservedUsd);
    for(const[key,c]of Object.entries(cp.calls))if(before.calls[key]?.status!=='done'||Math.abs((before.calls[key].actualUsd??Infinity)-c.usd)>1e-6)throw new Error('Checkpoint lacks matching settled ledger call; do not repeat.');
    const llm=await import('../src/lib/llm'),client=llm.getAnthropicClient();if(!client)throw new Error('No Anthropic client.');
    const save=()=>{mkdirSync(dir,{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(cp,null,2),{mode:0o600});renameSync(path+'.tmp',path);};
    for(const r of m.requests.slice(0,limit)){
      const ceiling=r.model==='claude-haiku-5-5'?.05:.15;
      const reservation=await reserveCall({runId:m.id,manifestSha,key:r.key,reserveUsd:ceiling,runCap:m.maxRunUsd});
      if(reservation==='already_done'){if(!cp.calls[r.key])throw new Error('Settled call missing checkpoint; do not repeat.');continue;}
      const started=Date.now();let usd:number;
      try{
        paidCalls++;
        const response=await client.messages.create(llm.sanitizeParamsForModel({model:r.model,max_tokens:r.maxTokens,temperature:r.temperature,
          system:r.system,messages:[{role:'user',content:llm.wrapUserInput('items',r.body)}],
          ...(r.thinking==='adaptive-low'?{thinking:{type:'adaptive' as const},output_config:{effort:'low' as const}}:{})}),
          {maxRetries:r.maxRetries,signal:AbortSignal.timeout(r.timeoutMs)});
        const usage={inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,
          cacheReadTokens:response.usage.cache_read_input_tokens??0,cacheCreateTokens:response.usage.cache_creation_input_tokens??0};
        const cost=estimateCostUsd(response.model,usage);if(cost.usd===null)throw new Error('Unpriced response; retain reserve.');usd=cost.usd;
        const raw=llm.extractTextContent(response.content);
        cp.calls[r.key]={raw,rawSha:sha256(raw),model:response.model,requestId:response._request_id??null,stopReason:response.stop_reason,usd,elapsedMs:Date.now()-started,usage};save();
      }catch(error){
        const reason=error instanceof Error?error.message.slice(0,200):'Unknown call failure';
        const requestId=error&&typeof error==='object'&&'request_id' in error&&typeof error.request_id==='string'?error.request_id:null;
        try { mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'failure.json'),JSON.stringify({key:r.key,manifestSha,startedAt:new Date(started).toISOString(),failedAt:new Date().toISOString(),requestId,reason,charge:'unknown',retried:false}),{mode:0o600}); }
        finally { await settleCall({runId:m.id,key:r.key,actualUsd:null,reason}); }
        throw error;
      }
      await settleCall({runId:m.id,key:r.key,actualUsd:usd});
      console.log(JSON.stringify({key:r.key,usd,elapsedMs:cp.calls[r.key].elapsedMs}));
      const after=await getBudgetStatus(m.id);assertReviewBudgetClear(after.lifetimeReservedUsd,await getUnrelatedUncertainReserveUsd(m.id),after.reservedUsd);
      if(usd>ceiling)throw new Error('Response exceeded reservation; stop.');
    }
    summary();
  }finally{await unlock();await closeBudgetPool();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
