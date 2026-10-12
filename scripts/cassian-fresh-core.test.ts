import {describe,expect,it} from 'vitest';
import {selectFreshTargets,type FreshFrame} from './cassian-fresh-core';
function frame():FreshFrame{return{seed:'cassian-v3-followup-2026-10-12',targets:['broad','niche','very narrow'].flatMap((breadth,b)=>Array.from({length:8},(_,n)=>({id:`t-${b}-${n}`,domainKey:`domain-${b}-${n}`,breadth:breadth as FreshFrame['targets'][number]['breadth'],sourceCold:true,depleted:n<4,exclusion:null}))) };}
describe('frozen fresh-study selection',()=>{
 it('selects unique topics in all six cells with controlled balanced tiers',()=>{
  const r=selectFreshTargets(frame());expect(r.selected).toHaveLength(24);expect(new Set(r.selected.map(t=>t.domainKey)).size).toBe(24);
  expect(r.deficits.every(d=>d.missing===0)).toBe(true);
  for(const b of ['broad','niche','very narrow'])for(const role of ['cold','depleted'])expect(r.selected.filter(t=>t.breadth===b&&t.role===role).map(t=>t.tier)).toEqual(['accessible','moderate','moderate','specialist']);
 });
 it('is invariant to input ordering and deterministic before outputs',()=>{
  const a=frame(),b=structuredClone(a);b.targets.reverse();expect(selectFreshTargets(a)).toEqual(selectFreshTargets(b));
 });
 it('retains cell shortages instead of broadening or replacing them with warm topics',()=>{
  const f=frame();f.targets=f.targets.filter(t=>t.id!=='t-0-0');f.targets.push({id:'warm',domainKey:'new-warm',breadth:'broad',sourceCold:false,depleted:false,exclusion:null});
  const r=selectFreshTargets(f);expect(r.selected).toHaveLength(23);expect(r.deficits[0]).toMatchObject({breadth:'broad',role:'depleted',missing:1});expect(r.selected.some(t=>t.id==='warm')).toBe(false);
 });
 it('does not select the same topic through two player profiles',()=>{
  const f=frame();f.targets.push({...f.targets[0],id:'other-profile'});expect(new Set(selectFreshTargets(f).selected.map(t=>t.domainKey)).size).toBe(24);
 });
 it('excludes previous experiments, capped generation and resting requests',()=>{
  const f=frame();f.targets[0].exclusion='previous-experiment';f.targets[1].exclusion='generation-capped';f.targets[2].exclusion='resting';
  expect(selectFreshTargets(f).deficits[0].missing).toBe(3);
 });
 it('refuses duplicate IDs and labels outside the fixed taxonomy',()=>{
  const f=frame();f.targets.push(f.targets[0]);expect(()=>selectFreshTargets(f)).toThrow();
  expect(()=>selectFreshTargets({...frame(),seed:'after-output-seed'})).toThrow();
 });
});
