import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readableSource } from './cassian-evidence-v3';
import { assessEvidenceV4, assessReviewV4, assessWriterV4, cardV4Schema, outputFormatV4, reconstructionInputV4, reviewV4Schema, writerV4Schema, type CardV4, type ReviewV4 } from './cassian-evidence-v4';
import type { PreparedPacket } from './cassian-source-packets';
const rawText='Mira Vale designed the lamp in 1842. Nora Reed built the lens in 1870.';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const source=readableSource({id:'source-a',url:'https://example.com/history',title:'Inventors',section:'History',edition:'fixture',captureSha:sha(rawText),extractionSha:sha(rawText),rawText,removed:[],locator:'fixture-paragraph'});
const packet:PreparedPacket={requestId:'request-a',domain:'Inventors',tier:'moderate',scope:'accepted',sources:[source],facts:[{id:'fact-a',assertion:'Mira Vale designed the lamp in 1842.',evidence:[{sourceId:source.id,start:0,end:35,quote:rawText.slice(0,35)}],support:'reviewed',novelty:'clear',rationale:'Synthetic fixture'}],preparer:{role:'prompt-author',independent:false}};
const card=():CardV4=>({schemaVersion:4,id:'case-a',question:'Who designed the lamp in 1842?',answer:'Mira Vale',explanation:'Mira Vale designed the lamp in 1842.',variants:['Vale'],claims:[],scaffolding:[]});
const citation={sourceId:source.id,quote:'Mira Vale designed the lamp in 1842.'};
const review=(c:CardV4):ReviewV4=>({schemaVersion:4,id:c.id,fields:(['question','answer','explanation',...c.variants.map((_,n)=>`variant:${n}`)] as ReviewV4['fields'][number]['field'][]).map(field=>({
 field,complete:true,reason:'All material claims reconstructed.',claims:[{cardQuote:field.startsWith('variant:')?c.variants[Number(field.slice(8))]:c[field as 'question'|'answer'|'explanation'],assertion:'Mira Vale designed the lamp in 1842.',status:'supported',evidence:[citation],reason:'The identified source states the relation.'}],
 acceptance:field==='answer'||field.startsWith('variant:')?{entity:'match',answerType:'match',language:'match',specificity:'match',reason:'The name or unambiguous surname answers the ask under supplied policy.'}:null,
}))});
const strict=(c:CardV4)=>({...c,claims:review(c).fields.map(f=>({field:f.field,cardQuote:f.claims[0].cardQuote,assertion:f.claims[0].assertion,factIds:['fact-a']}))});
const score=(r:ReviewV4,c=card())=>assessReviewV4(JSON.stringify(r),'end_turn',c,[source]);

describe('v4 evidence and acceptance mechanics',()=>{
 it('binds compact writer references to supplied evidence without model offsets or copied quotations',()=>{
  const c=strict(card()),r=assessWriterV4(JSON.stringify({status:'candidate',reason:'',card:c}),'end_turn',packet,c.id,'strict');
  expect(r.issues).toEqual([]);expect(r.records).toHaveLength(4);expect(r.records[1].evidence).toEqual(packet.facts[0].evidence);
  expect(r.records[1].start).toBe(0);expect(r.records[1].end).toBe(9);
 });
 it('refuses unknown/excluded references, soft inventories, and absent strict variant records',()=>{
  const c=strict(card());c.claims[0].factIds=['ghost'];c.claims=c.claims.filter(f=>f.field!=='variant:0');
  const r=assessWriterV4(JSON.stringify({status:'candidate',reason:'',card:c}),'end_turn',packet,c.id,'strict');
  expect(r.issues).toContain('unknown_or_excluded_fact_reference');expect(r.issues).toContain('missing_writer_claim_target');
  expect(assessWriterV4(JSON.stringify({status:'candidate',reason:'',card:strict(card())}),'end_turn',packet,c.id,'soft').issues).toContain('soft_inventory_not_empty');
 });
 it('retains nonfinal, malformed, inconsistent and scope-shortage writer outcomes',()=>{
  expect(assessWriterV4('{}','max_tokens',packet,'case-a','strict').status).toBe('invalid');
  expect(assessWriterV4('```json\n{}\n```','end_turn',packet,'case-a','soft').status).toBe('invalid');
  expect(assessWriterV4(JSON.stringify({status:'insufficient_supported_facts',reason:'No supported relationship',card:null}),'end_turn',packet,'case-a','soft').status).toBe('shortage');
  expect(assessWriterV4(JSON.stringify({status:'candidate',reason:'',card:card()}),'end_turn',{...packet,scope:'unresolved'},'case-a','soft').status).toBe('invalid');
 });
 it('blinds reconstruction to inventories/arms/gold while actually supplying acceptance policy',()=>{
  const c={...strict(card()),arm:'strict',gold:'pass'},input=JSON.parse(reconstructionInputV4(c,[source]));
  expect(input).not.toHaveProperty('claims');expect(input).not.toHaveProperty('arm');expect(input).not.toHaveProperty('gold');
  expect(input.acceptancePolicy.shortForms).toContain('unambiguous surnames');expect(input.requiredFields).toContain('variant:0');
 });
 it('accepts source-supported card and harmless short-form policy with actual located evidence',()=>{
  const c=card(),r=score(review(c),c);expect(r.decision).toBe('pass');expect(r.protocolValid).toBe(true);
  expect(r.records[1].citations[0]).toEqual({sourceId:source.id,start:0,end:36,quote:rawText.slice(0,36)});
  expect(r.notServingApproval).toBe(true);
 });
 it('keeps absent support distinct from contradiction and completeness attestation',()=>{
  const r=review(card());r.fields[2].claims[0].status='unknown';r.fields[2].claims[0].evidence=[];
  const a=score(r);expect(a.decision).toBe('review');expect(a.findings.map(f=>f.category)).toContain('missing_evidence');expect(a.findings.map(f=>f.category)).not.toContain('factual_error');
  r.fields[0].complete=false;expect(score(r).findings.map(f=>f.category)).toContain('incomplete_reconstruction');
 });
 it('requires valid source quotations before accepting a contradiction',()=>{
  const r=review(card());r.fields[2].claims[0].status='contradicted';expect(score(r).decision).toBe('hold');
  r.fields[2].claims[0].evidence[0]={...citation,quote:'Mira Vale designed the lamp in 1843.'};
  const a=score(r);expect(a.decision).toBe('review');expect(a.protocolValid).toBe(false);expect(a.findings.map(f=>f.category)).not.toContain('factual_error');
 });
 it('rejects incorrect language, requested answer type and explicit full-name variants without policy waivers',()=>{
  for(const dim of ['language','answerType','specificity'] as const){const r=review(card());r.fields[3].acceptance![dim]='mismatch';
   const a=score(r);expect(a.decision).toBe('hold');expect(a.findings).toContainEqual(expect.objectContaining({category:'incorrect_variant',field:'variant:0'}));}
 });
 it('does not treat an unsupported entity mismatch as proved incorrect',()=>{
  const r=review(card());r.fields[3].acceptance!.entity='mismatch';r.fields[3].claims[0].status='unknown';r.fields[3].claims[0].evidence=[];
  const a=score(r);expect(a.decision).toBe('review');expect(a.protocolValid).toBe(false);
 });
 it('blocks missing/duplicate fields, missing variant claims and nonfinal replies',()=>{
  const r=review(card());r.fields[3].claims=[];expect(score(r).decision).toBe('review');
  r.fields.pop();expect(score(r).protocolValid).toBe(false);
  r.fields.push(r.fields[0]);expect(score(r).protocolValid).toBe(false);
  expect(assessReviewV4(JSON.stringify(review(card())),'max_tokens',card(),[source]).decision).toBe('review');
 });
 it('requires unique locations, including repeated card substrings and speaker headings',()=>{
  const c=card();c.question='Who designed the lamp? Who designed the lamp?';const r=review(c);r.fields[0].claims[0].cardQuote='Who designed the lamp?';
  expect(score(r,c).protocolValid).toBe(false);
  const duplicate=readableSource({...source,rawText:rawText+' '+rawText,extractionSha:sha(rawText+' '+rawText)});
  expect(assessReviewV4(JSON.stringify(review(card())),'end_turn',card(),[duplicate]).findings.map(f=>f.category)).toContain('ambiguous_quotation');
 });
 it('keeps strict inventory omissions and semantic checks separate from source review',()=>{
  const c=strict(card());c.claims=c.claims.filter(f=>f.field!=='question');
  const a=assessEvidenceV4(JSON.stringify(review(c)),'end_turn',c,packet,'strict');expect(a.sourceDecision).toBe('pass');expect(a.decision).toBe('review');
  expect(a.findings.map(f=>f.category)).toContain('inventory_omission');expect(a.semanticInventoryReview).toBe('unassessed');
  const wrong=strict(card());wrong.claims[0].assertion='Nora designed a different device.';
  expect(assessEvidenceV4(JSON.stringify(review(wrong)),'end_turn',wrong,packet,'strict').semanticInventoryReview).toBe('unassessed');
 });
 it('only folds transport enum casing, never source/card actor text or unknown field bindings',()=>{
  const r=review(card());const raw=JSON.stringify(r).replace('"field":"question"','"field":"Question"').replaceAll('"supported"','"Supported"');
  expect(assessReviewV4(raw,'end_turn',card(),[source]).decision).toBe('pass');
  r.fields[1].claims[0].cardQuote='mira vale';expect(score(r).decision).toBe('review');
 });
 it('produces native strict JSON schemas without a transmitted parser callback',()=>{
  for(const schema of [writerV4Schema,reviewV4Schema,cardV4Schema]){const format=outputFormatV4(schema);expect(format.type).toBe('json_schema');expect(format).not.toHaveProperty('parse');
   expect(format.schema.additionalProperties).toBe(false);expect(()=>JSON.stringify(format)).not.toThrow();}
 });
});
