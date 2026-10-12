import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {readableSource,type CardV3} from './cassian-evidence-v3';
import {excerptSource,validateExcerpt,packetWriterInput,blindControls,scoreControls,type PreparedPacket,type ControlGold} from './cassian-source-packets';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const raw='Record A: Mira built the gauge in 1802. Record B: Council formed the guild in 1804.';
const parent=readableSource({id:'archive',url:'https://example.org/archive',title:'Workshop archive',section:'Records',edition:'First edition',
 captureSha:sha('HTML capture'),extractionSha:sha(raw),rawText:raw,locator:'archive:text:UTF16',removed:[]});
function packet():PreparedPacket{
 const quote='Mira built the gauge in 1802.',start=parent.readableText.indexOf(quote);
 return{requestId:'request-a',domain:'Workshop history',tier:'moderate',scope:'accepted',sources:[parent],preparer:{role:'prompt-author',independent:false},
  facts:[{id:'fact-a',assertion:quote,evidence:[{sourceId:parent.id,start,end:start+quote.length,quote}],support:'reviewed',novelty:'clear',rationale:'Supplied judgment, not independently verified.'}]};
}
function control(id:string,cohort:ControlGold['cohort']='sound'):ControlGold{
 const card:CardV3={schemaVersion:3,id,question:'Who built the gauge?',answer:'Mira',variants:[],explanation:'Mira built the gauge in 1802.',
  claims:[],scaffolding:[]};
 return{id,card,sources:[parent],domain:'Workshop history',tier:'moderate',cohort,expectedSource:cohort==='sound'?'pass':'hold',expectedQuality:'pass',
  categories:cohort==='sound'?[]:['factual_error'],rationale:'Hand-supplied control judgment.'};
}
describe('source preparation boundaries',()=>{
 it('keeps contiguous excerpts and parent offsets verifiable, including capture identity',()=>{
  const excerpt=excerptSource(parent,{start:0,end:'Record A: Mira built the gauge in 1802.'.length},'clip-a');
  expect(excerpt.source.readableText).toBe('Record A: Mira built the gauge in 1802.');
  expect(excerpt.source.captureSha).toBe(parent.captureSha);validateExcerpt(excerpt,parent);
  expect(()=>validateExcerpt({...excerpt,range:{start:1,end:38}},parent)).toThrow('provenance');
  expect(()=>validateExcerpt({...excerpt,parentReadableSha:sha('different edition')},parent)).toThrow('provenance');
 });
 it('refuses backwards/out-of-bounds excerpts and source drift',()=>{
  for(const range of [{start:10,end:5},{start:0,end:1000}])expect(()=>excerptSource(parent,range,'clip')).toThrow();
  expect(()=>excerptSource({...parent,readableText:'Altered'}, {start:0,end:2},'clip')).toThrow();
 });
 it('retains scoped shortages and blocks repeats, unresolved support and unreviewed novelty',()=>{
  const p=packet();expect(JSON.parse(packetWriterInput(p)).eligibleFacts).toHaveLength(1);
  for(const novelty of ['bank_duplicate','player_repeat','pending'] as const){p.facts[0].novelty=novelty;expect(JSON.parse(packetWriterInput(p)).eligibleFacts).toEqual([]);}
  p.facts[0].novelty='clear';p.facts[0].support='pending';expect(JSON.parse(packetWriterInput(p)).eligibleFacts).toEqual([]);
  p.facts[0].support='reviewed';p.scope='unresolved';const input=JSON.parse(packetWriterInput(p));
  expect(input.requestId).toBe('request-a');expect(input.eligibleFacts).toEqual([]);expect(input.scopeResolved).toBe(false);
 });
 it('rejects fabricated quotes, unknown sources and duplicate fact identities',()=>{
  const p=packet();p.facts[0].evidence[0].quote='Mira did not build it';expect(()=>packetWriterInput(p)).toThrow('quotation');
  const q=packet();q.facts[0].evidence[0].sourceId='not-in-packet';expect(()=>packetWriterInput(q)).toThrow('quotation');
  const r=packet();r.facts.push(r.facts[0]);expect(()=>packetWriterInput(r)).toThrow('identity');
 });
});
describe('blind controls and frozen denominators',()=>{
 it('blinds gold, arm, writer inventories and explanation in quality input, with order-independent mapping',()=>{
  const controls=[control('known-good'),control('known-bad','challenge')];
  expect(blindControls(controls,'frozen-seed')).toEqual(blindControls([...controls].reverse(),'frozen-seed'));
  const blind=blindControls(controls,'frozen-seed');
  for(const b of blind){const f=JSON.parse(b.factual),q=JSON.parse(b.quality);
   expect(Object.keys(f).sort()).toEqual(['answer','explanation','id','question','sources','variants']);
   expect(Object.keys(q).sort()).toEqual(['answer','domain','id','question','tier','variants']);
   expect(f.id).toMatch(/^case-\d\d$/);expect(JSON.stringify(f)).not.toContain(b.privateId);
  }
 });
 it('a reject-everything checker retains zero sound cards, and missing replies stay in the denominator',()=>{
  const gold=[control('sound-a'),control('sound-b'),control('bad-a','challenge')];
  const rejected=scoreControls(gold,gold.map(c=>({id:c.id,source:'hold',quality:'hold',categories:['factual_error']})));
  expect(rejected.soundDenominator).toBe(2);expect(rejected.soundRetained).toBe(0);
  const missing=scoreControls(gold,[{id:'sound-a',source:'pass',quality:'pass',categories:[]}]);
  expect(missing.soundDenominator).toBe(2);expect(missing.soundRetained).toBe(1);expect(missing.missingReplies).toBe(2);
 });
 it('tracks unsafe passes and right decisions for the wrong reason separately, including regressions',()=>{
  const gold=[control('bad','challenge'),control('regression','regression')];
  const scored=scoreControls(gold,[{id:'bad',source:'pass',quality:'pass',categories:[]},
   {id:'regression',source:'hold',quality:'pass',categories:['missing_evidence']}]);
  expect(scored.challengeUnsafePasses).toBe(1);expect(scored.rightDecisionWrongCategory).toBe(1);expect(scored.regressionUnresolved).toBe(1);
  expect(()=>scoreControls(gold,[{id:'unknown',source:'pass',quality:'pass',categories:[]}])).toThrow('identity');
 });
 it('requires all mandatory categories while allowing only predeclared secondary findings',()=>{
  const gold=control('regression','regression');gold.categories=['missing_evidence','incorrect_variant'];
  gold.allowedCategories=[...gold.categories,'factual_error'];
  const variantOnly=scoreControls([gold],[{id:gold.id,source:'hold',quality:'pass',categories:['incorrect_variant']}]);
  expect(variantOnly.regressionUnresolved).toBe(1);
  const complete=scoreControls([gold],[{id:gold.id,source:'hold',quality:'pass',categories:[...gold.categories,'factual_error']}]);
  expect(complete.regressionUnresolved).toBe(0);
 });
});
