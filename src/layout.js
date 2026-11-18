import {World} from './world.js';
export const costOf=s=>s.type==='dam'?[3,5,7][s.level]:2*Math.max(1,Math.ceil((s.halfLength??5)/5));
export const PLAYER_CAPSULE=Object.freeze({halfHeight:.53,radius:.3,skin:.025});
export const DAM_SHAPE=Object.freeze({baseY:-.45,baseDepth:2,crestDepth:.65,outletWidth:1.15,outletHeightRatio:.45,heights:Object.freeze([1.25,1.9,2.6])});
// Local-to-dam vertices include each segment's lateral offset; all consumers use the same hull.
export function damSegments(s){
 const width=World.pointAt(s.channel,s.t).width+2;
 const {baseY,baseDepth,crestDepth,outletWidth:gap,outletHeightRatio,heights}=DAM_SHAPE;
 return[{x:-gap/2,width:width-gap,height:heights[s.level]},
  {x:width/2-gap/2,width:gap,height:heights[s.level]*outletHeightRatio}].map(segment=>{
  const {x,width:w,height}=segment,left=x-w/2,right=x+w/2;
  return{...segment,baseY,baseDepth,crestDepth,vertices:new Float32Array([
   left,baseY,-baseDepth,right,baseY,-baseDepth,left,baseY,baseDepth,right,baseY,baseDepth,
   left,height,-crestDepth,right,height,-crestDepth,left,height,crestDepth,right,height,crestDepth])};
 });
}
function segmentDistanceSquared(x,y,ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
 return(x-ax-t*dx)**2+(y-ay-t*dy)**2;
}
export function damOverlapsPlayer(s,player){
 if(s.type!=='dam'||!player)return false;
 const p=World.pointAt(s.channel,s.t),dx=player.x-p.x,dz=player.z-p.z;
 const x=Math.cos(p.angle)*dx-Math.sin(p.angle)*dz,z=Math.sin(p.angle)*dx+Math.cos(p.angle)*dz;
 const y=(player.y??World.heightAt(player.x,player.z)+.86)-p.y;
 const low=y-PLAYER_CAPSULE.halfHeight,high=y+PLAYER_CAPSULE.halfHeight;
 const margin=PLAYER_CAPSULE.radius+PLAYER_CAPSULE.skin;
 return damSegments(s).some(segment=>{
  const {baseY,baseDepth,crestDepth,height,width,x:offset}=segment;
  const lateral=Math.max(0,Math.abs(x-offset)-width/2);
  if(lateral>margin)return false;
  // Distance from the vertical capsule segment to this segment's trapezoid cross-section.
  const depth=baseDepth-(baseDepth-crestDepth)*(Math.max(low,baseY)-baseY)/(height-baseY);
  let distance=0;
  if(high<baseY||low>height||Math.abs(z)>depth){
   const vertices=[[-baseDepth,baseY],[baseDepth,baseY],[crestDepth,height],[-crestDepth,height]];
   distance=Infinity;
   for(let i=0;i<vertices.length;i++){
    const [az,ay]=vertices[i],[bz,by]=vertices[(i+1)%vertices.length];
    distance=Math.min(distance,segmentDistanceSquared(z,low,az,ay,bz,by),
     segmentDistanceSquared(z,high,az,ay,bz,by),
     (az-z)**2+(ay-Math.max(low,Math.min(high,ay)))**2);
   }
  }
  return lateral*lateral+distance<=margin*margin;
 });
}
export function validatePlacement(s,list,player=null,mode='challenge',budget=30){
 const no=reason=>({ok:false,reason});
 if(!s||!World.inBounds(s.x,s.z))return no('请在沟谷范围内建设');
 if(!['dam','vegetation'].includes(s.type))return no('未知措施');
 const channel=World.channelAt(s.x,s.z);
 if(s.type==='dam'){
  if(!['main','west','east'].includes(s.channel)||!Number.isInteger(s.level)||s.level<0||s.level>2)return no('坝体参数无效');
  if(s.channel==='main'&&s.t>.84)return no('村口通道请留空，在上游布置坝体');
  if(channel.distance>3.8||s.t<.06||s.t>.94)return no('准星对准沟底，避开沟口');
  if((s.channel==='main'&&[.48,.64].some(t=>Math.abs(s.t-t)<.035))||(s.channel!=='main'&&s.t>.91))return no('交汇口留出过流空间');
  if(list.filter(a=>a.type==='dam').length>=6)return no('最多建设6座坝');
  if(list.some(a=>a.type==='dam'&&Math.hypot(a.x-s.x,a.z-s.z)<8))return no('与相邻坝保持8米间距');
  if(damOverlapsPlayer(s,player))return no('向后退一步，给坝体留出空间');
 }else{
  if(s.halfLength!==undefined&&(!Number.isFinite(s.halfLength)||s.halfLength<2.5||s.halfLength>15)||
    s.halfWidth!==undefined&&(!Number.isFinite(s.halfWidth)||s.halfWidth<1.5||s.halfWidth>4))return no('草带尺寸无效');
  if(channel.distance<6)return no('植被应种在两侧坡面');
  if(channel.distance>32)return no('请靠近沟谷坡面布置');
  if(World.slopeAt(s.x,s.z)>55*Math.PI/180)return no('这里坡面过陡');
  if(list.filter(a=>a.type==='vegetation').length>=12)return no('最多布置12片植被');
  if(list.some(a=>a.type==='vegetation'&&Math.hypot(a.x-s.x,a.z-s.z)<2))return no('此处已有植被带');
 }
 if(mode==='challenge'&&list.reduce((v,a)=>v+costOf(a),0)+costOf(s)>budget)return no('资源不足；可拆除或进入自由实验');
 return{ok:true,reason:s.type==='dam'?'沿沟横断，拦存上游来沙':'覆盖坡面，减少当地来沙'};
}
export class LayoutStore{
 constructor(){this.items=[];this.mode='challenge';this.undoStack=[];this.revision=0;}
 get cost(){return this.items.reduce((v,s)=>v+costOf(s),0);}
 snapshot(){return structuredClone(this.items);}
 commit(next,mode=this.mode){
  this.undoStack.push({structures:this.snapshot(),mode:this.mode});if(this.undoStack.length>20)this.undoStack.shift();
  this.items=next.map(s=>s.type==='dam'?{id:s.id,type:s.type,x:s.x,z:s.z,channel:s.channel,t:s.t,level:s.level,fill:s.fill??0}:{id:s.id,type:s.type,x:s.x,z:s.z,radius:5,rotation:s.rotation,...(s.halfLength!==undefined?{halfLength:s.halfLength,halfWidth:s.halfWidth??2.5}:{})});
  this.mode=mode;
  this.revision++;
 }
 undo(){if(!this.undoStack.length)return false;const previous=this.undoStack.pop();this.items=previous.structures;this.mode=previous.mode;this.revision++;return true;}
 export(){return JSON.stringify({version:1,mode:this.mode,structures:this.snapshot()},null,2);}
 import(json){const data=parseSave(json);this.commit(data.structures,data.mode);return data;}
}
export function parseSave(json){
 if(typeof json!=='string'||json.length>100000)throw Error('方案文件过大或格式无效');
 const d=JSON.parse(json);
 if(!d||d.version!==1||!['challenge','free'].includes(d.mode)||!Array.isArray(d.structures)||d.structures.length>18)throw Error('方案版本或结构无效');
 const out=[],ids=new Set();
 for(const raw of d.structures){
  if(!raw||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(raw.id)||ids.has(raw.id))throw Error('设施编号无效或重复');
  if(typeof raw.x!=='number'||typeof raw.z!=='number'||!Number.isFinite(raw.x)||!Number.isFinite(raw.z))throw Error('设施坐标无效');
  let s;
  if(raw.type==='dam'){
   if(!['main','west','east'].includes(raw.channel)||typeof raw.t!=='number'||!Number.isFinite(raw.t))throw Error('沟道无效');
   const p=World.pointAt(raw.channel,raw.t);
   if(Math.hypot(p.x-raw.x,p.z-raw.z)>.25)throw Error('坝体未贴合沟道');
   if(raw.fill!==undefined&&(!Number.isFinite(raw.fill)||raw.fill<0||raw.fill>[6,12,18][raw.level]))throw Error('沉积容量无效');
   s={id:raw.id,type:'dam',channel:raw.channel,t:raw.t,level:raw.level,x:p.x,z:p.z,...(raw.fill!==undefined?{fill:raw.fill}:{})};
  }else if(raw.type==='vegetation'){
   if(!Number.isFinite(raw.rotation)||raw.radius!==5)throw Error('植被范围无效');
   s={id:raw.id,type:'vegetation',x:raw.x,z:raw.z,rotation:raw.rotation,radius:5,...(raw.halfLength!==undefined?{halfLength:raw.halfLength,halfWidth:raw.halfWidth??2.5}:{})};
  }else throw Error('未知设施类型');
  const v=validatePlacement(s,out,null,d.mode);if(!v.ok)throw Error(v.reason);
  out.push(s);ids.add(s.id);
 }
 return{version:1,mode:d.mode,structures:out};
}
