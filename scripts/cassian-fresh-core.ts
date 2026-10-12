/** Deterministic fresh-study sampling. No database, credentials or provider imports. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const breadth=z.enum(['broad','niche','very narrow']);
export const freshFrameSchema=z.object({seed:z.literal('cassian-v3-followup-2026-10-12'),
  targets:z.array(z.object({id:z.string().regex(/^[a-z0-9-]+$/),domainKey:z.string().min(1),breadth,
    sourceCold:z.boolean(),depleted:z.boolean(),exclusion:z.enum(['previous-experiment','generation-capped','resting']).nullable()}).strict()),
}).strict();
export type FreshFrame=z.infer<typeof freshFrameSchema>;
export function selectFreshTargets(raw:unknown) {
  const frame=freshFrameSchema.parse(raw);
  if(new Set(frame.targets.map(t=>t.id)).size!==frame.targets.length)throw new Error('Duplicate target identity');
  const selected:Array<{id:string;domainKey:string;breadth:z.infer<typeof breadth>;role:'cold'|'depleted';tier:'accessible'|'moderate'|'specialist';rank:string}>=[];
  const deficits:Array<{breadth:z.infer<typeof breadth>;role:'cold'|'depleted';requested:number;selected:number;missing:number}>=[];
  const used=new Set<string>();
  const tiers=['accessible','moderate','moderate','specialist'] as const;
  for(const b of breadth.options)for(const role of ['depleted','cold'] as const){
    // Roles are disjoint; both underlying states are retained in the private frame.
    // Scarce depleted requests precede nondepleted reference-cache-cold requests.
    const candidates=frame.targets.filter(t=>!t.exclusion&&t.breadth===b&&(role==='depleted'?t.depleted:!t.depleted&&t.sourceCold))
      .map(t=>({...t,rank:hash(`${frame.seed}:${t.id}`)})).sort((a,b)=>a.rank.localeCompare(b.rank)||a.id.localeCompare(b.id));
    let count=0;
    for(const t of candidates){if(used.has(t.domainKey))continue;used.add(t.domainKey);
      selected.push({id:t.id,domainKey:t.domainKey,breadth:b,role,tier:tiers[count],rank:t.rank});count++;if(count===4)break;}
    deficits.push({breadth:b,role,requested:4,selected:count,missing:4-count});
  }
  const design={seed:frame.seed,plannedRequests:24,selected,deficits};
  return {...design,selectionSha:hash(JSON.stringify(design))};
}
