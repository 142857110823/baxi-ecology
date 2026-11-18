import {TRAVEL_SECONDS_PER_UNIT} from './simulation.js';
const clamp = value => Math.max(0, Math.min(1, value));
const calm = () => ({turbidity:0, surge:0, foam:0});

// Each sample is a cross-section of the SAME packets used by the mass ledger.
// The short tail represents a visible packet, never a second water simulation.
export function createWaterState(result) {
 if (!result) return {sample:calm};
 const sources=new Map(result.sources.map(s=>[s.id,s]));
 const packets=new Map();
 for(const event of result.events){
  if(event.type==='emit') packets.set(event.packetId,{emit:event,traps:[]});
  else if(event.type==='trap') packets.get(event.packetId)?.traps.push(event);
 }
 function distance(route,channel,t){
  let offset=0;
  for(const segment of route){
   if(segment.channel===channel&&t>=segment.from&&t<=segment.to)
    return offset+t-segment.from;
   offset+=segment.to-segment.from;
  }
  return null;
 }
 const sections=new Map();
 function section(channel,t){
  const key=`${channel}:${t}`;
  if(sections.has(key)) return sections.get(key);
  const crossings=[];
  for(const {emit,traps} of packets.values()){
   const s=sources.get(emit.source);
   if(!s)continue;
   const travel=distance(s.route,channel,t);
   if(travel===null)continue;
   let residual=emit.amount;
   for(const trap of traps){
    const at=distance(s.route,trap.channel,trap.t);
    if(at!==null&&at<travel-1e-8)residual-=trap.amount;
   }
   crossings.push({time:emit.time+travel*TRAVEL_SECONDS_PER_UNIT,original:emit.amount,residual:Math.max(0,residual)});
  }
  sections.set(key,crossings);
  return crossings;
 }
 return {
  sample(channel,t,time){
   if(!Number.isFinite(time)||!Number.isFinite(t))return calm();
   let original=0,residual=0,front=0;
   for(const crossing of section(channel,t)){
    const age=time-crossing.time;
    if(age<0||age>1.6)continue;
    const weight=Math.min(1,age/.13)*Math.min(1,(1.6-age)/.35);
    original+=crossing.original*weight;
    residual+=crossing.residual*weight;
    front=Math.max(front,(1-age/1.6)*weight);
   }
   if(original<1e-9)return calm();
   const turbidity=clamp(residual/original);
   return {turbidity,surge:clamp(original/.65),foam:clamp(front*.65+turbidity*.2)};
  }
 };
}
