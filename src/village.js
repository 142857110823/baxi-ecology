import {mergeBufferGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const T=window.THREE;
function roofTexture(){
 const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
 ctx.fillStyle='#687170';ctx.fillRect(0,0,512,512);
 for(let y=0;y<16;y++)for(let x=0;x<12;x++){
  const l=70+(x*17+y*29)%30;
  ctx.fillStyle=`rgb(${l},${l+5},${l+5})`;ctx.fillRect(x*43+1,y*32+1,40,30);
  ctx.fillStyle='rgba(210,215,204,.20)';ctx.fillRect(x*43+2,y*32+2,3,27);
  ctx.fillStyle='rgba(15,24,22,.30)';ctx.fillRect(x*43+35,y*32+2,4,30);
 }
 const t=new T.CanvasTexture(c);t.encoding=T.sRGBEncoding;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;return t;
}
export function createVillage(scene,World){
 const root=new T.Group(),outlet=World.pointAt('main',.86);
 root.name='雨来之前·村庄';root.position.set(outlet.x,0,outlet.z);root.rotation.y=outlet.angle;scene.add(root);
 const tile=roofTexture();
 const materials={
  wall:new T.MeshStandardMaterial({color:'#c5bdab',roughness:.92}),
  roof:new T.MeshStandardMaterial({color:'#b8bfba',map:tile,bumpMap:tile,bumpScale:.07,roughness:.83}),
  wood:new T.MeshStandardMaterial({color:'#605242',roughness:.92}),
  stone:new T.MeshStandardMaterial({color:'#939386',roughness:.98}),
  trim:new T.MeshStandardMaterial({color:'#b9beb0',roughness:.91}),
  glass:new T.MeshStandardMaterial({color:'#31433c',emissive:'#d5a35a',emissiveIntensity:.08,roughness:.35}),
  field:new T.MeshStandardMaterial({color:'#5d6946',roughness:1,side:T.DoubleSide}),
  crop:new T.MeshStandardMaterial({color:'#6f7b50',roughness:1}),
  path:new T.MeshStandardMaterial({color:'#8f876f',roughness:.96,side:T.DoubleSide})
 };
 function ground(x,z){
  return World.heightAt(outlet.x+Math.cos(outlet.angle)*x+Math.sin(outlet.angle)*z,
   outlet.z-Math.sin(outlet.angle)*x+Math.cos(outlet.angle)*z);
 }
 function add(g,m,x=0,y=0,z=0,parent=root){
  const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
 }
 function box(w,h,d,m,x,y,z,parent){return add(new T.BoxGeometry(w,h,d),m,x,y,z,parent);}
 function patch(x,z,w,d,material,lift=.055){
  const pos=[],idx=[],nx=12,nz=16;
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
   const px=x+(i/nx-.5)*w,pz=z+(j/nz-.5)*d;pos.push(px,ground(px,pz)+lift,pz);
  }
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;idx.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  const o=add(g,material);o.castShadow=false;return o;
 }
 function roof(width,depth){
  const pos=[],uv=[],idx=[],nx=16,nz=10;
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
   const u=x/nx,v=z/nz,d=Math.abs(u-.5)*2;
   pos.push((u-.5)*width,1.25*(1-d)+Math.pow(d,7)*.17,(v-.5)*depth);uv.push(u*1.15,v*1.6);
  }
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*(nx+1)+x;idx.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
 }
 function mergeHouse(group){
  const batches=new Map();
  for(const child of [...group.children]){
   if(!child.isMesh)continue;child.updateMatrix();
   const g=child.geometry.clone().applyMatrix4(child.matrix);
   // Merged batches share attributes even when only the roof uses UVs.
   if(!g.attributes.uv)g.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
   const plain=g.index?g.toNonIndexed():g;
   if(!batches.has(child.material))batches.set(child.material,[]);
   batches.get(child.material).push(plain);group.remove(child);child.geometry.dispose();
   if(plain!==g)g.dispose();
  }
  for(const [mat,geos] of batches){
   const merged=mergeBufferGeometries(geos,false);for(const g of geos)g.dispose();add(merged,mat,0,0,0,group);
  }
 }
 const houses=[];
 for(const [i,x,z] of [[0,17,-8],[1,26,-8],[2,35,-8],[3,17,3],[4,26,3],[5,35,3]]){
  const group=new T.Group();root.add(group);group.position.set(x,ground(x,z)+.10,z);group.rotation.y=(i%2?-.045:.04);
  const w=i===1?5.2:4.5,d=4.0,h=i===1?3.7:2.9;
  box(w+.3,.36,d+.3,materials.stone,0,.05,0,group);
  box(w,h,d,materials.wall,0,h/2,0,group);
  const end=new T.Shape();end.moveTo(-w/2,0);end.lineTo(0,1.25);end.lineTo(w/2,0);end.closePath();
  const gable=new T.ExtrudeGeometry(end,{depth:d,bevelEnabled:false});gable.translate(0,0,-d/2);
  add(gable,materials.wall,0,h-.04,0,group);
  add(roof(w+.9,d+.9),materials.roof,0,h-.02,0,group);
  box(.19,.15,d+1.1,materials.trim,0,h+1.2,0,group);
  for(const xx of [-w/2-.3,w/2+.3])box(.13,.15,d+.8,materials.wood,xx,h+.08,0,group);
  box(.90,1.9,.09,materials.wood,0,.97,d/2+.06,group);
  for(let p=0;p<5;p++)box(.014,1.8,.02,materials.trim,-.36+p*.18,.99,d/2+.12,group);
  box(1.18,.11,.34,materials.stone,0,.05,d/2+.28,group);
  box(1.5,.14,.65,materials.wood,0,2.15,d/2+.2,group);
  for(const xx of [-1.45,1.45]){
   box(.93,.91,.06,materials.wood,xx,1.65,d/2+.04,group);
   box(.77,.75,.07,materials.glass,xx,1.65,d/2+.08,group);
   for(const off of [-.25,0,.25])box(.025,.78,.035,materials.wood,xx+off,1.65,d/2+.13,group);
   box(.82,.04,.035,materials.wood,xx,1.65,d/2+.14,group);
  }
  box(.48,.90,.50,materials.stone,w/2-.8,h+.9,-.65,group);
  mergeHouse(group);houses.push(group);
  patch(x,z+d/2+.9,2,2.6,materials.path,.08);
 }
 patch(26,-1.9,25,1.7,materials.path,.07);
 patch(12.1,1,1.5,21,materials.path,.07);
 for(let i=0;i<3;i++){
  const x=16+i*8,z=12;
  patch(x,z,6.2,4.8,materials.field,.07);
  for(let j=0;j<7;j++)patch(x-2.6+j*.85,z,.25,4.2,materials.crop,.12);
 }
 const fence=new T.Group();root.add(fence);
 for(let i=0;i<20;i++){
  const x=12+i*1.4,z=16.1,y=ground(x,z);
  box(.075,1.05,.075,materials.wood,x,y+.50,z,fence);
  if(i<19)for(const h of [.42,.83]){
   const nextY=ground(x+1.4,z),rail=box(1.44,.055,.055,materials.wood,x+.7,(y+nextY)/2+h,z,fence);
   rail.rotation.z=Math.atan2(nextY-y,1.4);
  }
 }
 mergeHouse(fence);
 const stoneG=new T.IcosahedronGeometry(1,0),stoneM=materials.stone,stones=new T.InstancedMesh(stoneG,stoneM,192),dummy=new T.Object3D();
 for(let i=0;i<192;i++){
  const row=Math.floor(i/64),x=10.1,z=-15+(i%64)*.48,y=ground(x,z);
  dummy.position.set(x,y-row*.43,z);dummy.rotation.set(0,i*2.399,.1*Math.sin(i));
  dummy.scale.set(.42,.28,.30);dummy.updateMatrix();stones.setMatrixAt(i,dummy.matrix);
 }
 stones.castShadow=true;stones.receiveShadow=true;root.add(stones);
 const bridge=new T.Group();root.add(bridge);const bridgeZ=21.5;
 const bridgeY=Math.max(ground(-5.8,bridgeZ),ground(5.8,bridgeZ),outlet.y+1.6)+.12;
 for(let i=0;i<24;i++)box(.48,.15,2.05,materials.wood,-5.75+i*.5,bridgeY,bridgeZ,bridge);
 for(const side of [-1,1]){
  box(12,.10,.10,materials.wood,0,bridgeY+1.04,bridgeZ+side*.94,bridge);
  for(const x of [-5.7,-2.9,0,2.9,5.7])box(.11,1.1,.11,materials.wood,x,bridgeY+.52,bridgeZ+side*.94,bridge);
 }
 mergeHouse(bridge);
 const pool=add(new T.PlaneGeometry(.1,.1),new T.MeshStandardMaterial({color:'#3b9b9c'}));pool.visible=false;
 const green=new T.Color('#5d6946'),silt=new T.Color('#a29262');let impact=0;
 const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
 const unit=value=>Math.max(0,Math.min(1,value));
 let persistent={exported:0,baseline:100,integrity:100};
 /**
  * Snapshot the authoritative world on load, retry, settlement or replacement.
  * Idle impact is max(latest exported/baseline, integrity damage); no live result
  * is retained. Applying a new world clears an old live tint synchronously.
  */
 function setWorldState(state){
  const latest=Array.isArray(state?.history)?state.history.at(-1):null;
  persistent={
   exported:Math.max(0,finite(latest?.exported)),
   baseline:Math.max(1,finite(latest?.baseline,100)),
   integrity:Math.max(0,Math.min(100,finite(state?.field?.integrity,100)))
  };
  setImpact(null);
 }
 function setImpact(progress,result){
  // Null live results restore saved impact; they only clear transient rain/water.
  let exported=persistent.exported,baseline=persistent.baseline;
  if(result){
   const time=unit(finite(progress))*Math.max(0,finite(result.duration,35));
   exported=result.events?.filter(e=>e.type==='export'&&e.time<=time).reduce((n,e)=>n+Math.max(0,finite(e.amount)),0)??0;
   baseline=Math.max(1,finite(result.baseline,100));
  }
  impact=unit(result?exported/baseline:Math.max(exported/baseline,1-persistent.integrity/100));
  materials.field.color.copy(green).lerp(silt,impact*.72);
  materials.glass.emissiveIntensity=result?.duration ? .20 : .035;
  root.userData.impact=impact;root.userData.arrivedSediment=exported;root.userData.fieldIntegrity=persistent.integrity;
 }
 return{root,houses,bridge,pool,fields:materials.field,outlet,setWorldState,setImpact,get impact(){return impact;}};
}
