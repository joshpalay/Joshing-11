import { describe, expect, it } from 'vitest';
import { assessQualityV4, qualityInputV4, type QualityInputV4 } from './cassian-quality-v4';
const q:QualityInputV4={id:'case-a',question:'Who designed the lamp?',answer:'Mira Vale',domain:'Inventors',tier:'moderate'};
const reply=(evidence:string[],category='answer_disclosure',decision='hold')=>JSON.stringify({schemaVersion:4,items:[{id:q.id,decision,category,reason:'Synthetic judgment',evidence}]});
describe('v4 quality separation',()=>{
 it('excludes variants, explanation, source inventory and arm/gold metadata',()=>{
  const rich={...q,variants:['Wrong person'],explanation:'Private explanation',claims:[],arm:'strict',gold:'hold'};
  expect(JSON.parse(qualityInputV4([rich])).items).toEqual([q]);
 });
 it('blocks absent or repeated evidence but locates a real question substring',()=>{
  expect(assessQualityV4(reply(['Mira Vale']),'end_turn',[q])[0].decision).toBe('review');
  const repeated={...q,question:'A name? A name?'};expect(assessQualityV4(reply(['A name?']),'end_turn',[repeated])[0].decision).toBe('review');
  expect(assessQualityV4(reply(['Who designed the lamp?']),'end_turn',[q])[0].spans).toEqual([{start:0,end:22,quote:q.question}]);
 });
 it('retains schema/identity/nonfinal failures and pass/hold contradictions',()=>{
  for(const raw of ['{}',reply([]),reply(['Who'],'clear','pass')])expect(assessQualityV4(raw,'end_turn',[q])[0].decision).toBe('review');
  expect(assessQualityV4(reply([],'clear','pass'),'max_tokens',[q])[0].decision).toBe('review');
  const r=JSON.parse(reply([],'clear','pass'));r.items.push(r.items[0]);expect(assessQualityV4(JSON.stringify(r),'end_turn',[q])[0].decision).toBe('review');
 });
 it('accepts normal pass and literal giveaway while not treating located text as a sound reason',()=>{
  expect(assessQualityV4(reply([],'clear','pass'),'end_turn',[q])[0].decision).toBe('pass');
  const giveaway={...q,question:'Mira Vale designed the lamp. Who designed it?'};expect(assessQualityV4(reply(['Mira Vale designed the lamp.']),'end_turn',[giveaway])[0].decision).toBe('hold');
  expect(assessQualityV4(reply(['Who']),'end_turn',[q])[0].decision).toBe('hold');
 });
});
