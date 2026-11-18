import {World} from './world.js';
import {soilMaterial,rammedMaterial,mesh,seeded} from './scene.js';
import {mergeBufferGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {VEGETATION_HALF_LENGTH,VEGETATION_HALF_WIDTH} from './vegetation-shape.js';
import {DAM_CAPACITIES} from './simulation.js';
import {damSegments} from './layout.js';
const T=window.THREE;
const damMaterials=[rammedMaterial('#917c5c'),rammedMaterial('#8a6f4b'),rammedMaterial('#7d6442')];
const damGrassMat=new T.MeshStandardMaterial({color:'#66764a',roughness:1});
const damStoneMat=new T.MeshStandardMaterial({color:'#767b6b',roughness:.97,flatShading:true});
const vegetationMat=new T.MeshStandardMaterial({color:'#ffffff',roughness:1});
const crowns=[[-.22,.22,.06,.31,.38,.32],[.18,.29,.10,.35,.43,.30],[.02,.18,-.23,.30,.29,.34]].map(([x,y,z,sx,sy,sz],i)=>{
 const g=new T.IcosahedronGeometry(1,i===0?1:0),a=g.attributes.position;
 for(let j=0;j<a.count;j++){
  const wobble=1+.10*Math.sin(a.getX(j)*11+a.getZ(j)*8+i);
  a.setXYZ(j,a.getX(j)*sx*wobble+x,a.getY(j)*sy*wobble+y,a.getZ(j)*sz*wobble+z);
 }
 g.computeVertexNormals();return g;
});
const bushGeo=mergeBufferGeometries(crowns);crowns.forEach(g=>g.dispose());
const stemGeo=new T.CylinderGeometry(.035,.06,1,5),stemMat=new T.MeshStandardMaterial({color:'#736e48',roughness:1});
function trapezoid(segment){
 const idx=[0,4,5,0,5,1,2,3,7,2,7,6,4,6,7,4,7,5,0,2,6,0,6,4,1,5,7,1,7,3,0,1,3,0,3,2];
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(segment.vertices,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
export function createStructureMesh(s,preview=false){
 const group=new T.Group();group.userData.structureId=s.id;group.userData.type=s.type;
 if(s.type==='dam'){
  group.userData.fill=s.fill??0;group.userData.capacity=DAM_CAPACITIES[s.level];
  const p=World.pointAt(s.channel,s.t),segments=damSegments(s),width=p.width+2,height=segments[0].height,gap=segments[1].width;
  group.position.set(p.x,p.y,p.z);group.rotation.y=p.angle;
  segments.forEach((segment,i)=>group.add(mesh(trapezoid(segment),damMaterials[0])));
  // A low earthen crest, not a plank: thin cap, grass along the edge, no painted plank lines.
  group.add(mesh(new T.BoxGeometry(width-gap+.16,.08,1.5),damMaterials[0],-gap/2,height+.04,0));
  const tufts=new T.InstancedMesh(new T.BoxGeometry(1,1,1),damGrassMat,28),tuft=new T.Object3D();
  for(let i=0;i<28;i++){
   const x=-gap/2+(i/27-.5)*(width-gap-.4),z=(i%4-1.5)*.36;
   tuft.position.set(x,height+.10,z);tuft.rotation.set(0,i*2.399,0);
   tuft.scale.set(.24+(i%4)*.05,.06+(i%3)*.02,.16+(i%2)*.04);tuft.updateMatrix();tufts.setMatrixAt(i,tuft.matrix);
  }
  group.add(tufts);
  const stoneG=new T.IcosahedronGeometry(1,0),stoneM=damStoneMat;
  const shoulder=new T.InstancedMesh(stoneG,stoneM,64),dummy=new T.Object3D();
  for(let i=0;i<64;i++){
   const side=i<32?-1:1,row=Math.floor((i%32)/8),column=i%8,y=.16+row*height/5.2;
   const z=-1.72+column*.52,x=side*(width/2-.46)-gap/4;
   dummy.position.set(x,y,z);dummy.rotation.set(i*.61,i*2.399,i*.14);dummy.scale.set(.66,.42,.54);dummy.updateMatrix();shoulder.setMatrixAt(i,dummy.matrix);
  }
  shoulder.castShadow=true;shoulder.receiveShadow=true;group.add(shoulder);
  // Course stones at both abutments, partly buried in the bank.
  for(const side of [-1,1])for(let k=0;k<3;k++){
   const abut=mesh(new T.IcosahedronGeometry(1,0),stoneM,side*(width/2-.1),.24+k*.36,-.55+k*.5);
   abut.scale.set(.62,.44,.58);abut.rotation.set(k*.7,side*1.3,k*.2);
  }
  // Stones at the downstream toe tie the wall to the channel; no plank-like apron slab.
  for(let i=0;i<14;i++){
   const apronStone=mesh(new T.IcosahedronGeometry(1,0),stoneM,(i/13-.5)*(width-2.2),.05,2.1+(i%3)*.42);
   apronStone.scale.set(.28+(i%4)*.06,.12,.22);
  }
  const depositG=new T.PlaneGeometry(width-2,6.4,12,12);depositG.rotateX(-Math.PI/2);
  const depositBase=[];
  for(let i=0;i<depositG.attributes.position.count;i++){
   const x=depositG.attributes.position.getX(i),z=depositG.attributes.position.getZ(i)-5.2;
   const wx=p.x+Math.cos(p.angle)*x+Math.sin(p.angle)*z,wz=p.z-Math.sin(p.angle)*x+Math.cos(p.angle)*z;
   const base=World.heightAt(wx,wz)-p.y+.026;
   depositG.attributes.position.setXYZ(i,x,base,z);depositBase.push(base);
  }
  depositG.computeVertexNormals();
  const depositMat=soilMaterial('#ad9166');depositMat.transparent=true;depositMat.depthWrite=false;
  const soilCompile=depositMat.onBeforeCompile;
  depositMat.onBeforeCompile=shader=>{
   soilCompile(shader);
   shader.vertexShader='varying vec2 depositUV;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ndepositUV=uv;');
   shader.fragmentShader='varying vec2 depositUV;\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat edge=min(min(depositUV.x,1.-depositUV.x),min(depositUV.y,1.-depositUV.y));diffuseColor.a*=smoothstep(0.,.16,edge)*.82;');
  };
  depositMat.customProgramCacheKey=()=> 'baxi-deposit-feathered';
  const deposit=mesh(depositG,depositMat);deposit.userData.base=depositBase;deposit.userData.height=height;deposit.name='deposit';deposit.visible=false;group.add(deposit);
 }else{
  const halfLength=s.halfLength??VEGETATION_HALF_LENGTH,halfWidth=s.halfWidth??VEGETATION_HALF_WIDTH,rotation=s.rotation??0;
  group.position.set(s.x,0,s.z);group.rotation.y=rotation;
  const coverageG=new T.BufferGeometry(),positions=[0,0,0],indices=[],segments=48,rings=10;
  for(let ring=1;ring<=rings;ring++)for(let i=0;i<segments;i++){
   const a=i/segments*Math.PI*2,r=ring/rings;positions.push(Math.cos(a)*r*halfLength,0,Math.sin(a)*r*halfWidth);
  }
  for(let i=0;i<segments;i++)indices.push(0,1+(i+1)%segments,1+i);
  for(let ring=1;ring<rings;ring++)for(let i=0;i<segments;i++){
   const a=1+(ring-1)*segments+i,b=1+(ring-1)*segments+(i+1)%segments,c=a+segments,d=b+segments;
   indices.push(a,b,c,b,d,c);
  }
  coverageG.setAttribute('position',new T.Float32BufferAttribute(positions,3));coverageG.setIndex(indices);
  for(let i=0;i<coverageG.attributes.position.count;i++){
   const x=coverageG.attributes.position.getX(i),z=coverageG.attributes.position.getZ(i);
   const wx=s.x+Math.cos(rotation)*x+Math.sin(rotation)*z,wz=s.z-Math.sin(rotation)*x+Math.cos(rotation)*z;
   coverageG.attributes.position.setY(i,World.heightAt(wx,wz)+.035);
  }
  coverageG.computeVertexNormals();
  const cover=mesh(coverageG,new T.MeshStandardMaterial({color:'#647447',transparent:true,opacity:.25,roughness:1,side:T.DoubleSide}));cover.castShadow=false;group.add(cover);
  const shrubs=new T.InstancedMesh(bushGeo,vegetationMat,60),stems=new T.InstancedMesh(stemGeo,stemMat,60),random=seeded(Math.floor((s.x+120)*831+(s.z+80)*97));
  const dummy=new T.Object3D();
  const leafColor=new T.Color();
  for(let i=0;i<60;i++){
   const angle=random()*Math.PI*2,r=Math.sqrt(random())*.95,x=Math.cos(angle)*r*halfLength,z=Math.sin(angle)*r*halfWidth;
   const wx=s.x+Math.cos(rotation)*x+Math.sin(rotation)*z,wz=s.z-Math.sin(rotation)*x+Math.cos(rotation)*z;
   const h=World.heightAt(wx,wz),size=.5+random()*.65;
   dummy.position.set(x,h+.02,z);dummy.rotation.set(0,random()*6,0);dummy.scale.set(size,size*.85,size);dummy.updateMatrix();shrubs.setMatrixAt(i,dummy.matrix);
   leafColor.setHSL(.22+random()*.035,.22+random()*.15,.35+random()*.11);shrubs.setColorAt(i,leafColor);
   dummy.position.set(x,h+.10,z);dummy.scale.set(.65,.20,.65);dummy.updateMatrix();stems.setMatrixAt(i,dummy.matrix);
  }
  shrubs.castShadow=true;shrubs.receiveShadow=true;stems.castShadow=true;group.add(shrubs,stems);
 }
 if(preview)group.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=.45;o.material.depthWrite=false;o.castShadow=false;}});
 return group;
}
export function createPreview(s,valid){
 const group=new T.Group(),color=valid?'#9fdb87':'#d69a7f';
 const m=new T.MeshBasicMaterial({color,transparent:true,opacity:.28,depthWrite:false,side:T.DoubleSide});
 if(s.type==='dam'){
  const p=World.pointAt(s.channel,s.t);
  group.position.set(p.x,p.y,p.z);group.rotation.y=p.angle;
  for(const segment of damSegments(s)){
   const g=trapezoid(segment);group.add(new T.Mesh(g,m));
   group.add(new T.LineSegments(new T.EdgesGeometry(g),new T.LineBasicMaterial({color,transparent:true,opacity:.85})));
  }
 }else{
  const halfLength=s.halfLength??VEGETATION_HALF_LENGTH,halfWidth=s.halfWidth??VEGETATION_HALF_WIDTH,rotation=s.rotation??0;
  const g=new T.RingGeometry(.96,1,48);g.rotateX(-Math.PI/2);
  const a=g.attributes.position;
  for(let i=0;i<a.count;i++){
   const lx=a.getX(i)*halfLength,lz=a.getZ(i)*halfWidth,c=Math.cos(rotation),sn=Math.sin(rotation);
   const x=s.x+c*lx+sn*lz,z=s.z-sn*lx+c*lz;a.setXYZ(i,x,World.heightAt(x,z)+.07,z);
  }
  group.add(new T.Mesh(g,m));m.opacity=.8;
 }
 return group;
}
export function disposePreview(group){group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
export function structureRenderer(scene,player){
 const root=new T.Group();scene.add(root);const map=new Map();let selected;
 const selection=new T.BoxHelper(new T.Object3D(),'#e2f4ce');selection.visible=false;selection.material.depthTest=false;scene.add(selection);
 function sync(items){
  const previous=new Map([...map].map(([id,o])=>[id,o.userData.signature]));
  for(const [id,old] of map){root.remove(old);player.removeDam(id);disposeUnique(old);map.delete(id);}
  for(const s of items){
   const object=createStructureMesh(s),signature=JSON.stringify(s);object.userData.signature=signature;
   object.userData.birth=previous.get(s.id)===signature?0:performance.now();object.userData.baseY=object.position.y;
   root.add(object);map.set(s.id,object);if(s.type==='dam')player.addDam(s);
  }
  select(selected);
 }
 function select(id){selected=id;const o=map.get(id);selection.visible=!!o;if(o)selection.setFromObject(o.userData.type==='dam'?o.children[0]:o);}
 function animate(result,time){
  for(const [id,o] of map){
   const elapsed=(performance.now()-o.userData.birth)/150;
   o.position.y=o.userData.baseY+(o.userData.birth&&elapsed<1&&!document.body.classList.contains('reduced')?.12*(1-elapsed)**2:0);
   if(o.userData.type!=='dam')continue;
   const deposit=o.getObjectByName('deposit');
   const d=result?.dams?.find(d=>d.id===id);
   const events=result?.events?.filter(e=>e.type==='trap'&&e.structureId===id&&e.time<=time)||[];
   // A result owns its initial snapshot even if sync has already stored the settled total.
   const amount=d?(d.initialFill??0)+events.reduce((v,e)=>v+e.amount,0):o.userData.fill;
   const fill=Math.max(0,Math.min(1,amount/(d?.capacity??o.userData.capacity)));
   deposit.visible=fill>0;
   if(deposit.visible&&deposit.userData.lastFill!==fill){
    const a=deposit.geometry.attributes.position;
    for(let i=0;i<a.count;i++){
     const taper=Math.max(0,Math.min(1,(-a.getZ(i)-2)/-6.4+1)),side=Math.max(0,1-Math.pow(Math.abs(a.getX(i))/4.8,3));
     a.setY(i,deposit.userData.base[i]+fill*deposit.userData.height*.22*taper*side);
    }
    a.needsUpdate=true;deposit.geometry.computeVertexNormals();deposit.userData.lastFill=fill;
   }
  }
  if(selection.visible){const o=map.get(selected);if(o)selection.setFromObject(o.userData.type==='dam'?o.children[0]:o);}
 }
 return{root,map,sync,select,animate,selection};
}
function disposeUnique(root){
 const sharedMaterials=new Set([...damMaterials,vegetationMat,stemMat]),disposed=new Set();
 root.traverse(o=>{
  if(o.isInstancedMesh)o.dispose();
  if(o.geometry&&o.geometry!==bushGeo&&o.geometry!==stemGeo)o.geometry.dispose();
  if(o.material&&!sharedMaterials.has(o.material)&&!disposed.has(o.material)){o.material.dispose();disposed.add(o.material);}
 });
}
