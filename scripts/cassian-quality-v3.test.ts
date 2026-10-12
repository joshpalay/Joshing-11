import {describe,expect,it} from 'vitest';
import {assessQualityV3,qualityInputV3,type QualityInputV3} from './cassian-quality-v3';
const card:QualityInputV3={id:'case-a',question:'What are the breathing pores in tree bark called?',answer:'Lenticels',variants:[],domain:'Trees',tier:'moderate'};
const reply=(quote:string,start=0,end=quote.length)=>JSON.stringify({items:[{id:card.id,decision:'hold',category:'answer_disclosure',reason:'Claimed disclosure',spans:[{start,end,quote}]}]});
describe('quality evidence contract',()=>{
 it('omits explanations and labels even when richer internal records are supplied',()=>{
  const richer={...card,explanation:'The pores are lenticels.',arm:'strict',gold:'pass'};
  expect(JSON.parse(qualityInputV3([richer]))).toEqual({items:[card]});
 });
 it('does not honor a giveaway hold based on answer words absent from the question',()=>{
  expect(assessQualityV3(reply('Lenticels'),'end_turn',[card])[0].decision).toBe('review');
 });
 it('accepts mechanically valid question evidence without pretending it proves the judgment',()=>{
  const q={...card,question:'Tree pores are called lenticels. What are they called?'};
  const at=q.question.indexOf('called lenticels');
  expect(assessQualityV3(reply('called lenticels',at,at+'called lenticels'.length),'end_turn',[q])[0].decision).toBe('hold');
  // An actual question span can still be a mistaken semantic reason; independent adjudication must catch it.
  expect(assessQualityV3(reply('What'),'end_turn',[card])[0].decision).toBe('hold');
 });
 it('keeps malformed, truncated, missing and duplicate replies unresolved',()=>{
  for(const [raw,stop] of [[reply('What'),'max_tokens'],['{}','end_turn'],[JSON.stringify({items:[]}),'end_turn']] as const)
   expect(assessQualityV3(raw,stop,[card])[0].decision).toBe('review');
  const r=JSON.parse(reply('What'));r.items.push(r.items[0]);expect(assessQualityV3(JSON.stringify(r),'end_turn',[card])[0].decision).toBe('review');
 });
 it('refuses stale offsets and inconsistent pass/hold evidence',()=>{
  expect(assessQualityV3(reply('What',1,5),'end_turn',[card])[0].decision).toBe('review');
  const r=JSON.parse(reply('What'));r.items[0].decision='pass';expect(assessQualityV3(JSON.stringify(r),'end_turn',[card])[0].decision).toBe('review');
 });
});
