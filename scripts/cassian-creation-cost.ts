/** Offline request/attempt accounting. Judgments are supplied, not proved by arithmetic. */
import {z} from 'zod';
const id=z.string().min(1);
const arm=z.enum(['soft','strict']);
const eventSchema=z.object({id,requestId:id.nullable(),arm:z.enum(['shared','soft','strict','control']),
  stage:z.enum(['retrieval','evidence-preparation','writing','quality','source-review','repair','replacement','adjudication']),
  providerUsd:z.number().finite().nonnegative().nullable(),uncertainReserveUsd:z.number().finite().nonnegative(),
  laborMinutes:z.number().finite().nonnegative().nullable(),elapsedMs:z.number().finite().nonnegative(),
  status:z.enum(['done','failed','uncertain','pending'])}).strict();
const outcomeSchema=z.object({requestId:id,arm,status:z.enum(['usable','provisional','hold','shortage','unresolved']),
  factKey:id.nullable(),qualityReviewed:z.boolean(),sourceReviewed:z.boolean(),variantsReviewed:z.boolean(),noveltyReviewed:z.boolean(),
  adjudication:z.enum(['independent','author','pending'])}).strict();
export type CreationEvent=z.infer<typeof eventSchema>;
export type CreationOutcome=z.infer<typeof outcomeSchema>;
export function creationCostReport(requestIds:string[],rawEvents:unknown,rawOutcomes:unknown){
  if(!requestIds.length||new Set(requestIds).size!==requestIds.length)throw new Error('Distinct frozen requests required');
  const events=z.array(eventSchema).parse(rawEvents),outcomes=z.array(outcomeSchema).parse(rawOutcomes);
  if(events.some(e=>e.status==='uncertain'&&(e.providerUsd!==null||e.uncertainReserveUsd<=0)))throw new Error('Uncertain calls retain an unknown charge and positive reservation');
  if(new Set(events.map(e=>e.id)).size!==events.length||events.some(e=>e.arm!=='control'&&(!e.requestId||!requestIds.includes(e.requestId))))throw new Error('Invalid attempt identity/request');
  if(outcomes.length!==requestIds.length*2||new Set(outcomes.map(o=>`${o.arm}:${o.requestId}`)).size!==outcomes.length||outcomes.some(o=>!requestIds.includes(o.requestId)))throw new Error('Every request must retain both arm outcomes');
  const checked=(o:CreationOutcome)=>o.factKey&&o.qualityReviewed&&o.sourceReviewed&&o.variantsReviewed&&o.noveltyReviewed;
  if(outcomes.some(o=>(o.status==='usable'&&(!checked(o)||o.adjudication!=='independent'))||(o.status==='provisional'&&(!checked(o)||o.adjudication!=='author'))))throw new Error('Usable labels require all reviews and explicit adjudicator provenance');
  const groups=arm.options.map(a=>{
    const attempts=events.filter(e=>e.arm===a||e.arm==='shared');
    const weight=(e:CreationEvent)=>e.arm==='shared'?0.5:1;
    const knownUsd=attempts.reduce((s,e)=>s+(e.providerUsd??0)*weight(e),0);
    const unknownProviderEvents=attempts.filter(e=>e.providerUsd===null).length;
    const uncertainCeilingUsd=attempts.reduce((s,e)=>s+e.uncertainReserveUsd*weight(e),0);
    const knownLaborMinutes=attempts.reduce((s,e)=>s+(e.laborMinutes??0)*weight(e),0);
    const unknownLaborEvents=attempts.filter(e=>e.laborMinutes===null).length;
    const rows=outcomes.filter(o=>o.arm===a);
    const usable=rows.filter(o=>o.status==='usable'),provisional=rows.filter(o=>o.status==='provisional');
    if(new Set(usable.map(o=>o.factKey)).size!==usable.length||new Set([...usable,...provisional].map(o=>o.factKey)).size!==usable.length+provisional.length)throw new Error('Duplicate facts cannot inflate per-arm usable yield');
    const pendingEvents=attempts.filter(e=>e.status==='pending').length;
    const complete=unknownProviderEvents===0&&uncertainCeilingUsd===0&&pendingEvents===0;
    return{arm:a,requests:requestIds.length,independentlyUsable:usable.length,provisional:provisional.length,
      hold:rows.filter(o=>o.status==='hold').length,shortage:rows.filter(o=>o.status==='shortage').length,unresolved:rows.filter(o=>o.status==='unresolved').length,
      operationalProviderUsdKnown:knownUsd,unknownProviderEvents,uncertainCeilingUsd,providerCostComplete:complete,
      providerUsdPerIndependentlyUsable:complete&&usable.length?knownUsd/usable.length:null,
      providerUsdPerProvisional:complete&&provisional.length?knownUsd/provisional.length:null,
      knownLaborMinutes,unknownLaborEvents,laborComplete:unknownLaborEvents===0,
      laborMinutesPerIndependentlyUsable:unknownLaborEvents===0&&usable.length?knownLaborMinutes/usable.length:null,
      attemptEvents:attempts.filter(e=>e.status!=='pending').length,pendingEvents,failedEvents:attempts.filter(e=>e.status==='failed').length};
  });
  const controls=events.filter(e=>e.arm==='control');
  return{groups,actualProviderUsdKnown:events.reduce((s,e)=>s+(e.providerUsd??0),0),
    actualUncertainCeilingUsd:events.reduce((s,e)=>s+e.uncertainReserveUsd,0),
    actualLaborMinutesKnown:events.reduce((s,e)=>s+(e.laborMinutes??0),0),
    controlProviderUsdKnown:controls.reduce((s,e)=>s+(e.providerUsd??0),0),controlEvents:controls.length,
    sharedAllocation:'Half to each arm for the paired comparison; actual experiment totals count shared events once.',
    notServingApproval:true};
}
