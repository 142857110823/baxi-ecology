import {World,clamp} from './world.js';
import {flowPoint} from './water-path.js';
import {DAM_CAPACITIES} from './simulation.js';
const T=window.THREE;
export function createEffects(scene,label,camera){
 const particleLimit=6000;
 const geometry=new T.BufferGeometry(),pos=new Float32Array(particleLimit*3),col=new Float32Array(particleLimit*3);
 geometry.setAttribute('position',new T.BufferAttribute(pos,3));geometry.setAttribute('color',new T.BufferAttribute(col,3));
 const mat=new T.ShaderMaterial({vertexColors:true,transparent:true,depthWrite:false,
  vertexShader:'varying vec3 c;void main(){c=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(78./max(.1,-p.z),2.,7.);}',
  fragmentShader:'varying vec3 c;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(c,.82*(1.-smoothstep(.26,.5,d)));}'
 });
 const particles=new T.Points(geometry,mat);particles.frustumCulled=false;scene.add(particles);geometry.setDrawRange(0,0);
 const zones=new T.Group();scene.add(zones);
 for(const s of World.sources){
  const points=[];
  for(let i=0;i<65;i++){const a=i/64*Math.PI*2,x=s.x+Math.cos(a)*s.radius,z=s.z+Math.sin(a)*s.radius;points.push(new T.Vector3(x,World.heightAt(x,z)+.07,z));}
  const ring=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#c9975f',transparent:true,opacity:.65}));
  zones.add(ring);const text=label(`${s.id} · ${Math.round(s.weight*100)}份`,'#f0ebc9',4);
  text.material.depthTest=false;text.renderOrder=100;
  text.position.set(s.x,World.heightAt(s.x,s.z)+3.2,s.z);zones.add(text);
 }
 zones.visible=false;
 let result=null,tracks=[],dust=[],audioCtx=null,enabled=true,reduced=false,layout=[],emissions=[],lastTime=-1,showLabels=true;
 const labels=new Map();
 const contacts=new Map(),contactGroup=new T.Group();scene.add(contactGroup);
 const runoff=new T.Group();scene.add(runoff);runoff.visible=false;
 const sourceLabels=new Map();
 for(const s of World.sources){
  const p=World.pointAt(s.channel,s.t),points=[];
  for(let i=0;i<=24;i++){const u=i/24,x=s.x*(1-u)+p.x*u,z=s.z*(1-u)+p.z*u;points.push(new T.Vector3(x,World.heightAt(x,z)+.07,z));}
  const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#906d42',transparent:true,opacity:.5}));line.userData.source=s.id;runoff.add(line);
 }
 const dustGeo=new T.BufferGeometry(),dustPos=new Float32Array(768);dustGeo.setAttribute('position',new T.BufferAttribute(dustPos,3));
 const dustPoints=new T.Points(dustGeo,new T.PointsMaterial({color:'#dcebe2',size:.21,transparent:true,opacity:.88,depthWrite:false}));dustPoints.frustumCulled=false;scene.add(dustPoints);dustGeo.setDrawRange(0,0);
 function setResult(r){
  result=r;tracks=[];lastTime=-1;dust=[];
  for(const o of contactGroup.children){o.geometry.dispose();o.material.dispose();}contactGroup.clear();contacts.clear();
  emissions=[];runoff.visible=!!r;
  for(const l of sourceLabels.values()){scene.remove(l.sprite);l.texture.dispose();l.sprite.material.dispose();}sourceLabels.clear();
  if(!r)return;
  const emits=new Map(r.events.filter(e=>e.type==='emit').map(e=>[e.packetId,e]));
  emissions=[...emits.values()];
  const sources=new Map(r.sources.map(s=>[s.id,s]));
  for(const s of r.sources.filter(s=>s.prevented>.01)){
   const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');
   ctx.fillStyle='#3e643ef0';ctx.beginPath();ctx.roundRect(4,8,504,78,10);ctx.fill();ctx.fillStyle='#eff3dc';ctx.font='500 32px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillText(`少冲走 ${s.prevented.toFixed(1)}份泥土`,256,59);
   const texture=new T.CanvasTexture(c);texture.encoding=T.sRGBEncoding;
   const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthTest:true}));sprite.position.set(s.x,World.heightAt(s.x,s.z)+2.3,s.z);sprite.visible=false;scene.add(sprite);
   sourceLabels.set(s.id,{sprite,texture,source:s});
  }
  for(const line of runoff.children){const s=sources.get(line.userData.source);line.material.color.set(s?.coverage>0?'#718952':'#906d42');line.material.opacity=s?.coverage>0?.28:.5;}
  for(const e of r.events){
   if(e.type==='emit')continue;
   const emit=emits.get(e.packetId),s=sources.get(e.source);
   if(!emit||e.amount<=0)continue;
   tracks.push({start:emit.time,end:e.time,event:e,source:s,index:tracks.length,jitter:(tracks.length%7-3)*.17});
   if(e.type==='trap'&&!contacts.has(e.structureId)){
    const p=World.pointAt(e.channel,e.t),ring=new T.Mesh(new T.RingGeometry(.72,1,40),new T.MeshBasicMaterial({color:'#d7eee0',transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.set(p.x-Math.sin(p.angle)*2.6,p.y+.24,p.z-Math.cos(p.angle)*2.6);ring.visible=false;contactGroup.add(ring);
    contacts.set(e.structureId,{event:e,ring});
   }
  }
 }
 function pointOnRoute(source,progress){
  for(const seg of source.route){const length=seg.to-seg.from;if(progress<=length)return World.pointAt(seg.channel,seg.from+progress);progress-=length;}
  return World.pointAt('main',1);
 }
 function tick(time,dt){
  let n=0;
  if(result){
   const fill=new Map(result.dams.map(d=>[d.id,{capacity:d.capacity,level:d.level??layout.find(s=>s.id===d.id)?.level??0,amount:d.initialFill??0}]));
   for(const e of result.events)if(e.type==='trap'&&e.time<=time&&fill.has(e.structureId))fill.get(e.structureId).amount+=e.amount;
   for(const track of tracks){
    if(time<track.start||n>=particleLimit-10)continue;
    const done=time>=track.end;if(done&&track.event.type==='export')continue;
    if(done&&track.event.type==='trap'&&reduced&&n%2)continue;
    let p;
    if(done){
     p=World.pointAt(track.event.channel,track.event.t);
     const along=2.45+(track.index*.61803398875%1)*4.5,side=(track.index*.754877666%1-.5)*(p.width-2)*.8;
     const x=p.x-Math.sin(p.angle)*along+Math.cos(p.angle)*side,z=p.z-Math.cos(p.angle)*along-Math.sin(p.angle)*side,d=fill.get(track.event.structureId);
     const taper=clamp(1-(along-2)/6.4,0,1)*Math.max(0,1-(Math.abs(side)/4.8)**3);
     p={...p,x,z,y:World.heightAt(x,z)+.08+Math.min(1,d.amount/d.capacity)*[1.25,1.9,2.6][d.level]*.22*taper};
    }
    else{
     p=pointOnRoute(track.source,Math.max(0,(time-track.start)/10));
     if(track.event.type==='trap'&&track.end-time<.26){
      p=World.pointAt(track.event.channel,track.event.t);
      p={...p,x:p.x-Math.sin(p.angle)*2.9,z:p.z-Math.cos(p.angle)*2.9,y:p.y+.12};
     }else p=flowPoint(p.id,p.t,layout);
    }
    const copies=reduced?2:5;
    for(let j=0;j<copies&&n<particleLimit;j++){
     const side=(j*.61803398875+track.index*.381966)%1-.5;
     const jitter=done?side*.6:side*(p.halfWidth??1.4)*1.6;
     const along=((j*.754877+track.index*.317)%1-.5)*(done?1.2:1.8);
     const x=p.x+Math.cos(p.angle)*jitter+Math.sin(p.angle)*along,z=p.z-Math.sin(p.angle)*jitter+Math.cos(p.angle)*along;
     pos[n*3]=x;pos[n*3+1]=p.y+.18+(done||reduced?0:.06*Math.sin(time*3+n));pos[n*3+2]=z;
     const color=done?[.40,.30,.18]:j%3?[.22,.14,.075]:[.38,.27,.15];col.set(color,n*3);n++;
    }
   }
   for(const event of emissions){
    const elapsed=time-event.time+.7;if(elapsed<0||elapsed>.7||n>=particleLimit-1)continue;
    const s=result.sources.find(s=>s.id===event.source),ratio=s.weight>0?s.produced/(s.weight*result.baseline):0,number=+event.packetId.split(':').at(-1);
    if((number*.61803398875)%1>ratio)continue;
    const p=World.pointAt(s.channel,s.t),u=clamp(elapsed/.7,0,1),x=s.x*(1-u)+p.x*u,z=s.z*(1-u)+p.z*u;
    pos.set([x,World.heightAt(x,z)+.14,z],n*3);col.set([.35,.25,.14],n*3);n++;
   }
   for(const {event,ring} of contacts.values()){
    const elapsed=time-event.time;
    ring.visible=elapsed>=0&&elapsed<1.1;
    if(ring.visible){
     const size=reduced?2.4:1.2+elapsed*3;
     ring.scale.set(size,size,1);ring.material.opacity=(reduced?.28:.65)*Math.max(0,1-elapsed/1.1);
     ring.material.color.set(elapsed<.18?'#f3dfb3':'#b8e7de');
    }
    if(lastTime<event.time&&time>=event.time&&time-event.time<.5){
     hitSound(true);
     if(!reduced)splash(ring.position,22);
    }
   }
  }
  lastTime=time;
  geometry.setDrawRange(0,n);geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;
  for(const [id,l] of labels){
   const distance=camera.position.distanceTo(l.sprite.position),width=clamp(distance*.25,.6,7);
   l.sprite.scale.set(width,width*96/512,1);
   const d=result?.dams.find(x=>x.id===id),stored=layout.find(s=>s.id===id);
   const amount=d?(d.initialFill??0)+result.events.filter(e=>e.type==='trap'&&e.structureId===id&&e.time<=time).reduce((v,e)=>v+e.amount,0):(stored?.fill??0);
   const capacity=d?.capacity??DAM_CAPACITIES[stored?.level],remaining=Math.max(0,capacity-amount);
   l.sprite.visible=showLabels&&amount>0;
   const text=remaining<=.001?'装满了 · 余沙继续走':`已存 ${amount.toFixed(1)} · 余量 ${remaining.toFixed(1)}`;
   if(text!==l.text){l.text=text;const ctx=l.canvas.getContext('2d');ctx.clearRect(0,0,512,96);ctx.fillStyle=remaining<=.001?'#965d39':'#294d39';ctx.beginPath();ctx.roundRect(4,8,504,78,10);ctx.fill();ctx.fillStyle='#f2efda';ctx.font='500 32px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillText(text,256,59);l.texture.needsUpdate=true;}
  }
  for(const l of sourceLabels.values()){
   const distance=camera.position.distanceTo(l.sprite.position),width=clamp(distance*.25,.6,7);
   l.sprite.scale.set(width,width*96/512,1);l.sprite.visible=showLabels&&time>1.2;
  }
  let dn=0;dust=dust.filter(d=>d.life>0);
  for(const d of dust){if(dn>=256)break;d.life-=dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;d.vy-=dt*2.5;dustPos.set([d.x,d.y,d.z],dn*3);dn++;}
  dustGeo.setDrawRange(0,dn);dustGeo.attributes.position.needsUpdate=true;
 }
 function splash(p,count){
  dust=dust.slice(-180);
  for(let i=0;i<count;i++){
   const a=i*2.399,r=.45+(i%4)*.17;
   dust.push({x:p.x+Math.cos(a)*r,y:p.y+.05,z:p.z+Math.sin(a)*r,vx:Math.cos(a)*1.7,vz:Math.sin(a)*1.7,vy:1.3+(i%5)*.24,life:.65+(i%3)*.1});
  }
 }
 function hitSound(contact=false,type='dam'){
  if(!enabled)return;
  try{
   audioCtx??=new(window.AudioContext||window.webkitAudioContext)();audioCtx.resume();
   const now=audioCtx.currentTime;
   for(let i=0;i<(contact?2:1);i++){
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=i?'triangle':'sine';
    const start=contact?(i?510:155):(type==='dam'?130:460),end=contact?(i?220:65):(type==='dam'?55:280);
    o.frequency.setValueAtTime(start,now);o.frequency.exponentialRampToValueAtTime(end,now+.14);
    g.gain.setValueAtTime(.001,now);g.gain.linearRampToValueAtTime(i?.025:.085,now+.008);g.gain.exponentialRampToValueAtTime(.001,now+.23);
    o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(now+.25);o.onended=()=>{o.disconnect();g.disconnect();};
   }
  }catch{}
 }
 function feedback(s){
  if(!reduced){dust=dust.slice(-6);for(let i=0;i<24;i++){const a=i*2.399,x=s.x+Math.cos(a)*1.4,z=s.z+Math.sin(a)*1.4;dust.push({x,y:World.heightAt(x,z)+.1,z,vx:Math.cos(a)*.4,vz:Math.sin(a)*.4,vy:.8+(i%3)*.2,life:.7});}}
  hitSound(false,s.type);
 }
 function setLayout(items){
  layout=structuredClone(items);
  for(const l of labels.values()){scene.remove(l.sprite);l.texture.dispose();l.sprite.material.dispose();}labels.clear();
  for(const s of layout.filter(s=>s.type==='dam')){
   const c=document.createElement('canvas');c.width=512;c.height=96;
   const texture=new T.CanvasTexture(c);texture.encoding=T.sRGBEncoding;
   const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthTest:true}));
   const p=World.pointAt(s.channel,s.t);sprite.position.set(p.x,p.y+[1.25,1.9,2.6][s.level]+1.05,p.z);sprite.scale.set(5.4,1.02,1);sprite.visible=false;scene.add(sprite);
   labels.set(s.id,{canvas:c,texture,sprite,text:''});
  }
 }
 return{setResult,setLayout,tick,feedback,zones,particles,setAudio:v=>enabled=v,setReduced:v=>{reduced=v;if(v)dust=[];},setLabelsVisible:v=>{showLabels=!!v;if(!v){for(const l of labels.values())l.sprite.visible=false;for(const l of sourceLabels.values())l.sprite.visible=false;}}};
}
