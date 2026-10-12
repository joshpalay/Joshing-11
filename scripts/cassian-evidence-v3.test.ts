import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { assessEvidenceCardV3, assessReconstruction, inventoryOmissions, quoteKey, readableSource, reconstructionInput,
  validateCardV3, validateSourceV3, type CardV3, type ReviewV3, type SourceV3 } from './cassian-evidence-v3';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function source(rawText='Mira Vale built the blue gauge in 1802. The council formed the Guild in 1804. A shorter motto is “Work well”.') {
  return readableSource({id:'page-a',url:'https://example.org/archive',title:'Workshop archive',section:'Origins',edition:'First edition',
    captureSha:hash('raw capture'),extractionSha:hash(rawText),rawText,locator:'archive:text',removed:[]});
}
function citation(s:SourceV3, quote='Mira Vale built the blue gauge in 1802.') {
  const start=s.readableText.indexOf(quote);
  return {sourceId:s.id,start,end:start+quote.length,quote};
}
function fixture() {
  const s=source(), e=citation(s);
  const c:CardV3={schemaVersion:3,id:'card-a',question:'Who built the blue gauge?',answer:'Mira Vale',variants:['Mira'],
    explanation:'Mira Vale built the blue gauge in 1802.',claims:[],scaffolding:[{span:{start:0,end:4,text:'Who '},reason:'interrogative'}]};
  const qStart=c.question.indexOf('blue gauge');
  c.claims=[{id:'q1',target:{field:'question'},span:{start:qStart,end:qStart+10,text:'blue gauge'},assertion:'The blue gauge was built.',evidence:[e]},
    {id:'a1',target:{field:'answer'},span:{start:0,end:c.answer.length,text:c.answer},assertion:'Mira Vale built the gauge.',evidence:[e]},
    {id:'v1',target:{field:'variant',index:0},span:{start:0,end:4,text:'Mira'},assertion:'Mira refers to Mira Vale.',evidence:[e]},
    {id:'e1',target:{field:'explanation'},span:{start:0,end:c.explanation.length,text:c.explanation},assertion:c.explanation,evidence:[e]}];
  const r:ReviewV3={schemaVersion:3,id:c.id,claims:c.claims.map(a=>({...a,status:'supported',reason:'The record supplies the relationship.'})),
    coverage:[{field:'question'},{field:'answer'},{field:'explanation'},{field:'variant',index:0}].map(target=>({target:target as ReviewV3['coverage'][number]['target'],status:'complete',reason:'Material assertions reconstructed.'})),
    answers:[{target:{field:'answer'},status:'valid',basis:'source_relation',reason:'Builder matches the ask.',evidence:[e]},
      {target:{field:'variant',index:0},status:'valid',basis:'source_relation',reason:'Same named builder in this ask.',evidence:[e]}]};
  return {s,c,r};
}
const assess=(c:CardV3,s:SourceV3,r:ReviewV3)=>assessReconstruction(JSON.stringify(r),'end_turn',c,[s]);

describe('readable evidence with stable provenance',()=>{
  it('collapses whitespace and removes only explicitly located display numbers, preserving dates',()=>{
    const raw='Mira built it in 1802.\n104\nThe council formed the Guild.';
    const start=raw.indexOf('104');
    const s=readableSource({...source(),rawText:raw,extractionSha:hash(raw),removed:[{start,end:start+3,text:'104',reason:'presentation_line_number'}]});
    expect(s.readableText).toBe('Mira built it in 1802. The council formed the Guild.');
    const n=s.readableText.indexOf('The council');
    expect(raw.slice(s.rawOffsets[n],s.rawOffsets[n]+11)).toBe('The council');
    expect(validateSourceV3(s)).toEqual(s);
  });
  it('leaves unmarked numbers and omissions intact',()=>{
    expect(source('Act 4 scene 7\n104\n[intervening text omitted]').readableText).toBe('Act 4 scene 7 104 [intervening text omitted]');
  });
  it('refuses stale hashes, overlapping removals and removal of words',()=>{
    const s=source();
    expect(()=>readableSource({...s,extractionSha:hash('wrong')})).toThrow();
    expect(()=>readableSource({...s,removed:[{start:0,end:4,text:'Mira',reason:'presentation_line_number'}]})).toThrow();
    const raw='A\n104\nB', p={start:2,end:5,text:'104',reason:'presentation_line_number' as const};
    expect(()=>readableSource({...s,rawText:raw,extractionSha:hash(raw),removed:[p,p]})).toThrow();
  });
  it('detects text, locator-map and readable-hash drift',()=>{
    const s=source();
    for (const patch of [{readableText:s.readableText+'x'},{readableSha:hash('x')},{rawOffsets:[0]}]) expect(()=>validateSourceV3({...s,...patch})).toThrow();
  });
  it('permits typography/whitespace changes but preserves substantive numbers and words',()=>{
    expect(quoteKey('“Work\n well”')).toBe(quoteKey('"Work well"'));
    expect(quoteKey('1802 not 1804')).not.toBe(quoteKey('1804'));
  });
});

describe('material claims and independent reconstruction',()=>{
  it('permits nonfactual question scaffolding without demanding whole-character writer coverage',()=>{
    const {s,c,r}=fixture();
    expect(validateCardV3(c,[s]).issues).toEqual([]);
    expect(assess(c,s,r).decision).toBe('pass');
    expect(inventoryOmissions(c,r)).toEqual([]);
  });
  it('does not send writer inventories, scaffolding or verdicts to the reconstructing reviewer',()=>{
    const {s,c}=fixture(), input=JSON.parse(reconstructionInput(c,[s]));
    expect(input.variants).toEqual(['Mira']);
    expect(input).not.toHaveProperty('claims'); expect(input).not.toHaveProperty('scaffolding');
    expect(input.sources[0]).toMatchObject({title:'Workshop archive',section:'Origins',edition:'First edition',locator:'archive:text'});
  });
  it('distinguishes missing writer records from missing source evidence',()=>{
    const {s,c,r}=fixture(); c.claims=c.claims.filter(a=>a.target.field!=='explanation');
    expect(validateCardV3(c,[s]).issues).toEqual([]);
    expect(inventoryOmissions(c,r)).toEqual(['e1']);
    r.claims[3].status='unknown';r.claims[3].evidence=[];
    const out=assess(c,s,r);
    expect(out.decision).toBe('review'); expect(out.findings).toContainEqual({category:'missing_evidence',target:'explanation',claimId:'e1'});
  });
  it('requires missing strict records without treating them as a factual error or imposing them on soft writing',()=>{
    const {s,c,r}=fixture();c.claims=c.claims.filter(a=>a.target.field!=='explanation');
    expect(assessEvidenceCardV3(c,[s],JSON.stringify(r),'end_turn','strict')).toMatchObject({decision:'review',sourceDecision:'pass',findings:[{category:'incomplete_claim_record',claimId:'e1'}]});
    expect(assessEvidenceCardV3(c,[s],JSON.stringify(r),'end_turn','soft').decision).toBe('pass');
  });
  it('retains a source contradiction even when strict metadata is incomplete',()=>{
    const {s,c,r}=fixture();c.claims=[];r.claims[3].status='contradicted';
    expect(assessEvidenceCardV3(c,[s],JSON.stringify(r),'end_turn','strict').decision).toBe('hold');
    expect(assessEvidenceCardV3({},[s],JSON.stringify(r),'end_turn','strict').findings).toEqual([{category:'malformed_output'}]);
  });
  it('holds a documented contradiction separately from a genuinely absent fact',()=>{
    const {s,c,r}=fixture();r.claims[3].status='contradicted';
    expect(assess(c,s,r).decision).toBe('hold');
    r.claims[3].status='unknown';r.claims[3].evidence=[];
    expect(assess(c,s,r).decision).toBe('review');
    expect(assess(c,s,r).findings.some(f=>f.category==='factual_error')).toBe(false);
  });
  it('checks every answer variant and holds incorrect acceptance',()=>{
    const {s,c,r}=fixture();r.answers[1].status='incorrect';r.answers[1].evidence=[];
    expect(assess(c,s,r)).toMatchObject({decision:'hold',findings:[{category:'incorrect_variant',target:'variant:0'}]});
    r.answers.pop(); expect(assess(c,s,r).findings).toEqual([{category:'malformed_output'}]);
  });
  it('keeps unresolved acceptance policy separate from absent factual evidence',()=>{
    const {s,c,r}=fixture();r.answers[1].status='unknown';r.answers[1].basis='acceptance_policy';r.answers[1].evidence=[];
    expect(assess(c,s,r)).toMatchObject({decision:'review',findings:[{category:'policy_disagreement',target:'variant:0'}]});
  });
  it('requires claims for each variant even when an answer verdict was supplied',()=>{
    const {s,c,r}=fixture();r.claims=r.claims.filter(a=>a.target.field!=='variant');
    expect(assess(c,s,r).decision).toBe('review');
  });
  it('records a bad quotation without treating it as a demonstrated factual error',()=>{
    const {s,c,r}=fixture();r.claims[3].status='contradicted';r.claims[3].evidence[0]={...r.claims[3].evidence[0],quote:'Invented passage'};
    const out=assess(c,s,r);expect(out.decision).toBe('review');
    expect(out.findings.some(f=>f.category==='bad_quotation')).toBe(true);
    expect(out.findings.some(f=>f.category==='factual_error')).toBe(false);
  });
  it('accepts harmless quote formatting at an unchanged source span',()=>{
    const {s,c,r}=fixture();r.claims[3].evidence[0].quote='Mira Vale built\n the blue gauge in 1802.';
    expect(assess(c,s,r).decision).toBe('pass');
  });
  it('refuses mutated spans, duplicate or missing targets, prose and truncation',()=>{
    const {s,c,r}=fixture();
    const variations=[{...r,id:'other'}, {...r,coverage:r.coverage.slice(1)}, {...r,coverage:[...r.coverage,r.coverage[0]]},
      {...r,claims:[...r.claims,r.claims[0]]}, {...r,claims:r.claims.map((a,i)=>i? a:{...a,span:{...a.span,start:0}})}];
    for(const v of variations)expect(assessReconstruction(JSON.stringify(v),'end_turn',c,[s]).findings).toEqual([{category:'malformed_output'}]);
    expect(assessReconstruction('Here is JSON '+JSON.stringify(r),'end_turn',c,[s]).decision).toBe('review');
    expect(assessReconstruction(JSON.stringify(r),'max_tokens',c,[s]).decision).toBe('review');
  });
  it('requires evidence for supported fields but permits an explicit unknown',()=>{
    const {s,c,r}=fixture(); r.claims[0].evidence=[];
    expect(assess(c,s,r).findings.some(f=>f.category==='bad_quotation')).toBe(true);
    r.claims[0].status='unknown'; expect(assess(c,s,r).findings.some(f=>f.category==='missing_evidence')).toBe(true);
  });
  it('fails closed on uncertain reconstruction without certifying completeness by code',()=>{
    const {s,c,r}=fixture();r.coverage[0].status='uncertain';
    expect(assess(c,s,r)).toMatchObject({decision:'review',findings:[{category:'incomplete_reconstruction',target:'question'}]});
  });
  it('demonstrates that a false semantic support assertion can still pass these mechanics',()=>{
    const {s,c,r}=fixture();r.claims[3].assertion='Nora built it in 1900.';
    expect(assess(c,s,r).decision).toBe('pass'); // Requires independent entailment adjudication, not substring checks.
  });
});

describe('mandatory relational regressions (synthetic counterparts, not provider tests)',()=>{
  it.each([
    ['chronology','unknown','A concise motto does not establish a later event.','review'],
    ['attribution','contradicted','The actor differs from the named builder.','hold'],
    ['formation','contradicted','Forming an organization differs from merging into an existing one.','hold'],
  ] as const)('%s retains the independently assigned relation assessment',(_name,status,reason,decision)=>{
    const {s,c,r}=fixture();r.claims[3].status=status;r.claims[3].reason=reason;
    if(status==='unknown')r.claims[3].evidence=[];
    expect(assess(c,s,r).decision).toBe(decision);
  });
});
