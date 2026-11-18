import {World} from './world.js';
import {runSimulation,DAM_CAPACITIES} from './simulation.js';
import {costOf,parseSave} from './layout.js';

export const SCENARIOS=Object.freeze([
 {id:'first',title:'左沟初雨',baseline:64,limit:48,seed:20261114,
  sourceWeights:{W1:.46,W2:.32,E1:.01,E2:.01,M1:.07,M2:.06,M3:.04,M4:.03},
  targetText:'护住村口的田与路',forecast:'雨先落在左侧支沟。把第一道墙放到来沙路上。',view:'west'},
 {id:'slope',title:'裸坡急雨',baseline:110,limit:74,seed:20261115,
  sourceWeights:{W1:.01,W2:.01,E1:.58,E2:.24,M1:.01,M2:.01,M3:.08,M4:.06},
  targetText:'别让右岸裸坡的泥土埋住田埂',forecast:'右岸裸坡集中来沙。先护住坡，再让沟里的墙接力。',view:'east'},
 {id:'successive',title:'连续来雨',baseline:96,limit:65,seed:20261116,
  sourceWeights:{W1:.18,W2:.16,E1:.20,E2:.16,M1:.05,M2:.05,M3:.10,M4:.10},
  targetText:'整治旧淤积，再守住下一场',forecast:'两侧支沟一起迎雨。旧墙已经装了泥土，留一点空位。',view:'middle'},
]);
const clone=v=>structuredClone(v);
const fresh=()=>({round:0,phase:'prepare',structures:[],materialLimit:30,maintenance:6,soil:0,
 field:{built:false,integrity:100},history:[],mode:'challenge'});
const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const totalCost=structures=>structures.reduce((sum,s)=>sum+costOf(s),0);
function validateWorld(raw){
 if(!raw||!Number.isInteger(raw.round)||raw.round<0||raw.round>2||
  !['prepare','aftermath','complete'].includes(raw.phase)||!['challenge','free'].includes(raw.mode)||
  !number(raw.materialLimit,30,100)||!number(raw.maintenance,0,40)||!Number.isInteger(raw.maintenance)||
  !number(raw.soil,0,1000)||!raw.field||typeof raw.field.built!=='boolean'||
  !number(raw.field.integrity,0,100)||!Array.isArray(raw.history)||raw.history.length>3)throw Error('世界存档字段无效');
 const data=parseSave(JSON.stringify({version:1,mode:'free',structures:raw.structures}));
 const structures=data.structures.map((s,i)=>{
  const fill=raw.structures[i].fill??0,highFill=raw.structures[i].highFill??fill;
  if(!number(fill,0,s.type==='dam'?DAM_CAPACITIES[s.level]:0)||!number(highFill,fill,18))throw Error('沉积容量无效');
  return{...s,...(s.type==='dam'?{fill,highFill}:{})};
 });
 if(raw.mode==='challenge'&&totalCost(structures)>raw.materialLimit)throw Error('存档材料不守恒');
 const history=raw.history.map((h,i)=>{
  if(!h||h.id!==SCENARIOS[i].id||typeof h.won!=='boolean'||
   !['baseline','exported','trapped','prevented'].every(k=>number(h[k],0,200))||
   h.baseline!==SCENARIOS[i].baseline||Math.abs(h.exported+h.trapped+h.prevented-h.baseline)>1e-6)throw Error('历史账本无效');
  return{id:h.id,baseline:h.baseline,exported:h.exported,trapped:h.trapped,prevented:h.prevented,won:h.won};
 });
 const expected=raw.phase==='prepare'?raw.round:raw.round+1;
 if(history.length!==expected||raw.phase==='complete'&&raw.round!==2)throw Error('雨序与历史不一致');
 return{round:raw.round,phase:raw.phase,structures,materialLimit:raw.materialLimit,maintenance:raw.maintenance,
  soil:raw.soil,field:{built:raw.field.built,integrity:raw.field.integrity},history,mode:raw.mode};
}
export function parseWorldSave(text){
 if(typeof text!=='string'||text.length>250000)throw Error('世界文件过大');
 const d=JSON.parse(text);
 if(d?.version!==2||d.kind!=='baxi-world')throw Error('请选择本版完整世界存档；旧布局可从单独入口迁移');
 const world=validateWorld(d.world);
 const checkpoint=d.checkpoint?validateWorld(d.checkpoint):null;
 if(checkpoint&&(checkpoint.phase!=='prepare'||checkpoint.round!==world.round))throw Error('检查点雨序无效');
 return{world,checkpoint};
}
export class Campaign{
 constructor(saved=null){this.state=saved?clone(saved.world):fresh();this.checkpoint=saved?.checkpoint?clone(saved.checkpoint):null;this.run=null;this.undoStack=[];}
 get scenario(){return SCENARIOS[this.state.round];}
 get cost(){return totalCost(this.state.structures);}
 get remaining(){return this.state.materialLimit-this.cost;}
 setLayout(next,mode=this.state.mode){
  if(this.state.phase==='wave')throw Error('这场雨中先观察，雨后再整治');
  if(!['challenge','free'].includes(mode))throw Error('玩法无效');
  const old=new Map(this.state.structures.map(s=>[s.id,s]));
  for(const prior of old.values()){
   const s=next.find(s=>s.id===prior.id);
   if(prior.type==='dam'&&prior.fill>1e-6&&(!s||s.type!=='dam'||s.channel!==prior.channel||Math.abs(s.t-prior.t)>1e-8))
    throw Error('先清理墙前的土，再移动或拆除');
   if(prior.type==='dam'&&s?.type==='dam'&&prior.fill>DAM_CAPACITIES[s.level]+1e-6)throw Error('已有泥土高于新墙容量，先清理');
  }
  parseSave(JSON.stringify({version:1,mode:'free',structures:next}));
  const structures=next.map(s=>s.type==='dam'?{id:s.id,type:s.type,channel:s.channel,t:s.t,level:s.level,x:s.x,z:s.z,fill:old.get(s.id)?.fill??0,highFill:old.get(s.id)?.highFill??0}:
   {id:s.id,type:s.type,x:s.x,z:s.z,radius:5,rotation:s.rotation??0,...(s.halfLength!==undefined?{halfLength:s.halfLength,halfWidth:s.halfWidth??2.5}:{})});
  if(mode==='challenge'&&totalCost(structures)>this.state.materialLimit)throw Error('材料不足，拆一些或换低墙');
  this.undoStack.push(clone(this.state));if(this.undoStack.length>30)this.undoStack.shift();
  this.state.structures=structures;this.state.mode=mode;
 }
 undo(){if(this.state.phase==='wave'||!this.undoStack.length)return false;this.state=this.undoStack.pop();return true;}
 begin(){
  if(!['prepare','aftermath','complete'].includes(this.state.phase)||this.state.phase!=='prepare')throw Error('先进入下一场或回到雨前');
  const s=this.scenario,sources=World.sources.map(p=>({...p,weight:s.sourceWeights[p.id]}));
  this.checkpoint=clone(this.state);this.undoStack=[];
  const result=runSimulation({structures:this.state.structures},sources,s.seed,
   {baseline:s.baseline,initialFill:Object.fromEntries(this.state.structures.filter(p=>p.type==='dam').map(p=>[p.id,p.fill??0]))});
  this.run=result;this.state.phase='wave';return result;
 }
 settle(){
  if(this.state.phase!=='wave'||!this.run)return false;
  const r=this.run,s=this.scenario,won=r.exported<=s.limit+1e-6;
  for(const d of r.dams){const item=this.state.structures.find(p=>p.id===d.id);item.fill=(d.initialFill??0)+d.trapped;item.highFill=Math.max(item.highFill??0,item.fill);}
  this.state.history.push({id:s.id,baseline:r.baseline,exported:r.exported,trapped:r.trapped,prevented:r.prevented,won});
  this.state.field.integrity=Math.max(0,this.state.field.integrity-Math.max(0,r.exported-s.limit)*1.3);
  this.state.phase=this.state.round===2?'complete':'aftermath';this.undoStack=[];return true;
 }
 clean(id){
  if(!['aftermath','complete','prepare'].includes(this.state.phase))throw Error('等雨过后再清理');
  const item=this.state.structures.find(s=>s.id===id);
  if(!item||item.type!=='dam'||!(item.fill>1e-6))throw Error('这里没有需要清理的土');
  const amount=item.fill,cost=Math.ceil(amount/6-1e-9);
  if(cost>this.state.maintenance)throw Error(`需要${cost}份整治额度，当前${this.state.maintenance}份`);
  this.undoStack=[];item.fill=0;this.state.maintenance-=cost;this.state.soil+=amount;
  return{amount,cost};
 }
 restoreField(){
  if(this.state.phase==='wave')throw Error('雨后再修田埂');
  if(this.state.field.built)throw Error('这处田埂已经修好，留土不会重复消耗');
  if(this.state.soil<6)throw Error('需要6份留土；先清理有沉积的墙');
  this.undoStack=[];this.state.soil-=6;this.state.field={built:true,integrity:100};
 }
 advance(){
  if(this.state.phase!=='aftermath')throw Error('当前还不能进入下一场');
  this.state.round++;this.state.phase='prepare';this.state.materialLimit+=4;this.state.maintenance+=2;
  this.undoStack=[];this.run=null;this.checkpoint=null;
 }
 retry(){
  if(!this.checkpoint||this.state.phase==='wave')throw Error('雨后可回到这场雨前');
  this.state=clone(this.checkpoint);this.checkpoint=null;this.run=null;this.undoStack=[];
 }
 export(){
  // A running rain resumes at its complete pre-rain transaction, never a partial reward.
  const world=this.state.phase==='wave'?this.checkpoint:this.state;
  return JSON.stringify({version:2,kind:'baxi-world',world,checkpoint:this.state.phase==='wave'?null:this.checkpoint},null,2);
 }
}
