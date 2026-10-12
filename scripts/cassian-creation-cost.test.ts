import {describe,expect,it} from 'vitest';
import {creationCostReport,type CreationEvent,type CreationOutcome} from './cassian-creation-cost';
const event=(id:string,arm:CreationEvent['arm'],usd:number):CreationEvent=>({id,requestId:arm==='control'?null:'request-a',arm,stage:'writing',providerUsd:usd,uncertainReserveUsd:0,laborMinutes:0,elapsedMs:10,status:'done'});
const outcome=(arm:CreationOutcome['arm']):CreationOutcome=>({requestId:'request-a',arm,status:'usable',factKey:'fact-a',qualityReviewed:true,sourceReviewed:true,variantsReviewed:true,noveltyReviewed:true,adjudication:'independent'});
describe('full creation economics',()=>{
 it('allocates shared retrieval once and includes failures/repairs while keeping control overhead visible',()=>{
  const e=[event('source','shared',.20),event('a','soft',.05),{...event('failed','soft',.03),status:'failed' as const,stage:'repair' as const},event('b','strict',.02),event('control','control',.10)];
  const r=creationCostReport(['request-a'],e,[outcome('soft'),outcome('strict')]);
  expect(r.groups[0].providerUsdPerIndependentlyUsable).toBeCloseTo(.18);expect(r.groups[1].providerUsdPerIndependentlyUsable).toBeCloseTo(.12);
  expect(r.actualProviderUsdKnown).toBeCloseTo(.40);expect(r.controlProviderUsdKnown).toBe(.10);expect(r.groups[0].failedEvents).toBe(1);
 });
 it('reports zero yield as undefined unit cost without dropping expense or unresolved requests',()=>{
  const rows=[{...outcome('soft'),status:'shortage' as const},{...outcome('strict'),status:'unresolved' as const}];
  const r=creationCostReport(['request-a'],[event('a','soft',.1)],rows);
  expect(r.groups[0].operationalProviderUsdKnown).toBe(.1);expect(r.groups.every(g=>g.providerUsdPerIndependentlyUsable===null)).toBe(true);
 });
 it('does not treat unmeasured labor or unknown/uncertain provider charges as free or exact',()=>{
  const e={...event('uncertain','shared',0),providerUsd:null,laborMinutes:null,uncertainReserveUsd:.2,status:'uncertain' as const};
  const r=creationCostReport(['request-a'],[e],[outcome('soft'),outcome('strict')]);
  expect(r.groups[0]).toMatchObject({unknownProviderEvents:1,uncertainCeilingUsd:.1,providerCostComplete:false,providerUsdPerIndependentlyUsable:null,unknownLaborEvents:1,laborComplete:false,laborMinutesPerIndependentlyUsable:null});
  expect(()=>creationCostReport(['request-a'],[{...e,providerUsd:0,uncertainReserveUsd:0}],[outcome('soft'),outcome('strict')])).toThrow();
 });
 it('keeps same-author development yield separate from independent usable yield',()=>{
  const r=creationCostReport(['request-a'],[event('a','soft',.1)],[{...outcome('soft'),status:'provisional',adjudication:'author'},outcome('strict')]);
  expect(r.groups[0]).toMatchObject({independentlyUsable:0,provisional:1,providerUsdPerIndependentlyUsable:null,providerUsdPerProvisional:.1});
 });
 it('keeps future preparation placeholders out of executed attempts and exact completed unit costs',()=>{
  const r=creationCostReport(['request-a'],[{...event('pending','shared',0),status:'pending',laborMinutes:null}],[outcome('soft'),outcome('strict')]);
  expect(r.groups[0]).toMatchObject({attemptEvents:0,pendingEvents:1,providerCostComplete:false,providerUsdPerIndependentlyUsable:null});
 });
 it('refuses missing outcomes, repeated attempts, duplicate facts and unsupported usable labels',()=>{
  expect(()=>creationCostReport(['request-a'],[],[outcome('soft')])).toThrow();
  expect(()=>creationCostReport(['request-a'],[event('a','soft',.1),event('a','soft',.1)],[outcome('soft'),outcome('strict')])).toThrow();
  expect(()=>creationCostReport(['request-a'],[],[{...outcome('soft'),variantsReviewed:false},outcome('strict')])).toThrow();
  expect(()=>creationCostReport(['request-a','request-b'],[],[outcome('soft'),outcome('strict'),{...outcome('soft'),requestId:'request-b'},{...outcome('strict'),requestId:'request-b'}])).toThrow();
 });
});
