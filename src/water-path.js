import {World,clamp} from './world.js';
import {damSegments} from './layout.js';

function surfaceHeight(id,x,z,structures){
 let y=World.heightAt(x,z);
 for(const d of structures){
  if(d.type!=='dam'||d.channel!==id)continue;
  const p=World.pointAt(id,d.t),dx=x-p.x,dz=z-p.z;
  const across=dx*Math.cos(p.angle)-dz*Math.sin(p.angle),along=dx*Math.sin(p.angle)+dz*Math.cos(p.angle);
  for(const segment of damSegments(d)){
   if(Math.abs(across-segment.x)>segment.width/2||Math.abs(along)>segment.baseDepth)continue;
   const slope=clamp((Math.abs(along)-segment.crestDepth)/(segment.baseDepth-segment.crestDepth),0,1);
   y=Math.max(y,p.y+segment.height+(segment.baseY-segment.height)*slope);
  }
 }
 return y+.10;
}

export function flowPoint(id,t,structures){
 const p=id==='main'&&(t<0||t>1)?World.scenicPointAt(t):World.pointAt(id,t);
 let x=p.x,z=p.z,angle=p.angle,width=id==='main'?2.8:1.35;
 for(const d of structures){
  if(d.type!=='dam'||d.channel!==id)continue;
  const dam=World.pointAt(id,d.t),long=(p.x-dam.x)*Math.sin(dam.angle)+(p.z-dam.z)*Math.cos(dam.angle);
  if(Math.abs(long)>7)continue;
  const w=clamp((7-Math.abs(long))/4.5,0,1),ease=w*w*(3-2*w);
  const outlet=damSegments(d)[1],across=(p.x-dam.x)*Math.cos(dam.angle)-(p.z-dam.z)*Math.sin(dam.angle);
  const offset=(outlet.x-across)*ease;
  x=p.x+Math.cos(dam.angle)*offset;z=p.z-Math.sin(dam.angle)*offset;
  angle=p.angle+(dam.angle-p.angle)*ease;width=width*(1-ease)+.39*ease;
 }
 return{...p,x,z,angle,y:surfaceHeight(id,x,z,structures),halfWidth:width};
}

export function flowSection(id,t,structures,divisions=8){
 const p=flowPoint(id,t,structures);
 const taper=id==='main'?clamp((t+.4)/.035,0,1)*clamp((2.3-t)/.035,0,1):clamp(t/.035,0,1);
 const vertices=[];
 // Sample across the ribbon too: a flat pair of bank vertices bridges curved beds.
 for(let j=0;j<=divisions;j++){
  const side=j/divisions*2-1,x=p.x+Math.cos(p.angle)*p.halfWidth*side*taper,z=p.z-Math.sin(p.angle)*p.halfWidth*side*taper;
  vertices.push({x,y:surfaceHeight(id,x,z,structures),z,side});
 }
 return{...p,vertices};
}
