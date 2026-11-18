const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mainX=z=>18*Math.sin(z*.05)+3*Math.sin(z*.079);
const branchControls={
 west:[[-101,-56],[-72,-44],[-41,-27],[mainX(-2.88),-2.88]],
 east:[[98,-34],[69,-18],[39,6],[mainX(20.16),20.16]]
};
function rawPoint(id,t){
 t=clamp(t,0,1);
 if(id==='main'){const z=-72+144*t;return{x:mainX(z),z,y:17-14*t};}
 const p=branchControls[id],a=1-t;
 const x=a*a*a*p[0][0]+3*a*a*t*p[1][0]+3*a*t*t*p[2][0]+t*t*t*p[3][0];
 const z=a*a*a*p[0][1]+3*a*a*t*p[1][1]+3*a*t*t*p[2][1]+t*t*t*p[3][1];
 const join=id==='west'?.48:.64;
 return{x,z,y:17-14*join+(1-t)*9};
}
const paths=Object.fromEntries(['main','west','east'].map(id=>[id,Array.from({length:145},(_,i)=>rawPoint(id,i/144))]));
const lengths=Object.fromEntries(Object.entries(paths).map(([id,list])=>{
 const cumulative=[0];
 for(let i=1;i<list.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(list[i].x-list[i-1].x,list[i].z-list[i-1].z));
 return[id,cumulative];
}));
function remainingLength(id,t){
 const a=lengths[id],u=clamp(t,0,1)*144,i=Math.min(143,Math.floor(u)),distance=a[i]+(a[i+1]-a[i])*(u-i);
 return a.at(-1)-distance;
}
function distanceToOutlet(id,t){return remainingLength(id,t)+(id==='main'?0:remainingLength('main',id==='west'?.48:.64));}
function pointAt(id,t){
 const p=rawPoint(id,t),a=rawPoint(id,Math.max(0,t-.001)),b=rawPoint(id,Math.min(1,t+.001));
 return{...p,id,t,width:id==='main'?9:7,angle:Math.atan2(b.x-a.x,b.z-a.z)};
}
function nearest(id,x,z){
 const list=paths[id];let d=Infinity,best;
 for(let i=0;i<list.length-1;i++){
  const a=list[i],b=list[i+1],dx=b.x-a.x,dz=b.z-a.z;
  const u=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
  const px=a.x+dx*u,pz=a.z+dz*u,q=(px-x)**2+(pz-z)**2;
  if(q<d){d=q;best=(i+u)/144;}
 }
 return{...pointAt(id,best),distance:Math.sqrt(d)};
}
function channelAt(x,z){
 let result;
 for(const id of ['main','west','east']){
  const p=nearest(id,x,z);
  if(!result||p.distance<result.distance-.02)result=p;
 }
 return result;
}
function scenicPointAt(t){
 if(t>=0&&t<=1)return pointAt('main',t);
 const end=t<0?0:1,p=pointAt('main',end),dz=(t-end)*144;
 return{...p,t,x:p.x+Math.tan(p.angle)*dz,z:p.z+dz,y:Math.max(.1,p.y-dz*.028)};
}
function rawHeightAt(x,z){
 let valley=Infinity,dist=Infinity;
 for(const id of ['main','west','east']){
  const p=nearest(id,x,z),extended=id==='main'&&(z<-72||z>72)?scenicPointAt((z+72)/144):null;
  const d=extended?Math.abs(x-extended.x)*Math.cos(extended.angle):p.distance,w=p.width*.5;
  const relative=Math.max(0,d-w+1);
  const erosion=(Math.sin(p.t*113+Math.sin(p.t*37)*1.5)+.40*Math.sin(p.t*241))*.85;
  const shelf=clamp((relative-15-erosion)/11,0,1);
  const rise=4*(1-Math.exp(-Math.pow(relative/16,1.6)))+18*shelf*shelf*(3-2*shelf);
  const flank=clamp((d-5)/8,0,1)*clamp((40-d)/13,0,1);
  const ribs=(.75*Math.sin(p.t*83+Math.sin(p.t*21)*2.5+id.length)+.35*Math.sin(p.t*171+Math.sin(p.t*67)))*flank;
  const base=extended?extended.y:id==='main'?17-14*clamp((z+72)/144,0,1):p.y;
  valley=Math.min(valley,base+rise+ribs);dist=Math.min(dist,d);
 }
 const noise=(Math.sin(x*.17+z*.07)*Math.sin(z*.21)+.4*Math.sin(x*.46-z*.14))*.55;
 const rim=1.8*Math.sin(x*.039+z*.018)+1.2*Math.cos(z*.049);
 const natural=valley+noise*clamp((dist-3)/10,0,1)+rim*clamp((dist-6)/25,0,1);
 const village=pointAt('main',.86),dx=x-village.x,dz=z-village.z;
 const vx=dx*Math.cos(village.angle)-dz*Math.sin(village.angle);
 const vz=dx*Math.sin(village.angle)+dz*Math.cos(village.angle);
 const edge=Math.hypot(Math.max(0,Math.abs(vx-26)-16),Math.max(0,Math.abs(vz+2)-15));
 const blend=1-clamp(edge/5,0,1),soft=blend*blend*(3-2*blend);
 return natural*(1-soft)+(village.y+5.7-vz*.018)*soft;
}
const heightSamples=new Map();
function sampleHeight(x,z){
 const key=`${x},${z}`;if(!heightSamples.has(key))heightSamples.set(key,Math.fround(rawHeightAt(x,z)));
 return heightSamples.get(key);
}
// Query the same float32 triangles used by rendering and the static collider.
function heightAt(x,z){
 const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz,a=sampleHeight(ix,iz);
 if(u===0&&v===0)return a;
 const b=sampleHeight(ix+1,iz),c=sampleHeight(ix,iz+1);
 if(u+v<=1)return a+(b-a)*u+(c-a)*v;
 const d=sampleHeight(ix+1,iz+1);return d+(c-d)*(1-u)+(b-d)*(1-v);
}
function slopeAt(x,z){
 const dx=(heightAt(x+.3,z)-heightAt(x-.3,z))/.6,dz=(heightAt(x,z+.3)-heightAt(x,z-.3))/.6;
 return Math.atan(Math.hypot(dx,dz));
}
function grid(nx=240,nz=160,sx=240,sz=160){
 const vertices=new Float32Array((nx+1)*(nz+1)*3),indices=new Uint32Array(nx*nz*6);
 let k=0;
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
  const px=(x/nx-.5)*sx,pz=(z/nz-.5)*sz;
  vertices[k++]=px;vertices[k++]=heightAt(px,pz);vertices[k++]=pz;
 }
 k=0;
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const a=z*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;
  indices.set([a,c,b,b,c,d],k);k+=6;
 }
 return{vertices,indices,nx,nz,sx,sz};
}
const sourceSpecs=[
 ['W1',.14,'west',.12,-7],['W2',.12,'west',.48,8],
 ['E1',.16,'east',.14,8],['E2',.12,'east',.48,-8],
 ['M1',.12,'main',.10,-10],['M2',.12,'main',.30,10],
 ['M3',.12,'main',.57,-9],['M4',.10,'main',.76,10]
];
const sources=sourceSpecs.map(([id,weight,channel,t,offset])=>{
 const p=pointAt(channel,t);
 return{id,weight,channel,t,radius:6,x:p.x+Math.cos(p.angle)*offset,z:p.z-Math.sin(p.angle)*offset};
});
export const World={paths,pointAt,scenicPointAt,channelAt,heightAt,slopeAt,grid,sources,distanceToOutlet,inBounds:(x,z)=>Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x)<117&&Math.abs(z)<77};
export {clamp};
