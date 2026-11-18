import {World} from './world.js';
const T=window.THREE;
function seeded(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function foliageCluster(seed=3){
 const r=seeded(seed),p=[],n=[],colors=[],col=new T.Color();
 for(let i=0;i<240;i++){
  const a=r()*Math.PI*2,h=r()*2-1,rad=Math.sqrt(1-h*h)*Math.cbrt(r());
  const center=new T.Vector3(Math.cos(a)*rad,h*.95,Math.sin(a)*rad);
  const normal=new T.Vector3(r()-.5,r()*.85+.1,r()-.5).normalize();
  const tangent=new T.Vector3().crossVectors(normal,new T.Vector3(0,0,1)).normalize();
  const bitangent=new T.Vector3().crossVectors(normal,tangent).normalize();
  const size=.09+r()*.09;
  col.setHSL(.20+r()*.045,.22+r()*.14,.30+r()*.12);
  const verts=[[0,-1],[-.45,-.32],[-.38,.45],[0,1],[.38,.45],[.45,-.32]]
   .map(([u,v])=>center.clone().addScaledVector(tangent,u*size).addScaledVector(bitangent,v*size));
  for(const idx of [0,1,2,0,2,3,0,3,4,0,4,5]){
   p.push(...verts[idx].toArray());n.push(...normal.toArray());colors.push(col.r,col.g,col.b);
  }
 }
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(p,3));
 g.setAttribute('normal',new T.Float32BufferAttribute(n,3));
 g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 return g;
}
export function createLandscape(scene){
 const group=new T.Group();group.name='河岸林与地表细节';scene.add(group);
 const r=seeded(81293),dummy=new T.Object3D(),trees=[];
 const village=World.pointAt('main',.86);
 function villageLocal(x,z){
  const dx=x-village.x,dz=z-village.z;
  return{x:dx*Math.cos(village.angle)-dz*Math.sin(village.angle),z:dx*Math.sin(village.angle)+dz*Math.cos(village.angle)};
 }
 for(let i=0;i<175;i++){
  const id=i<115?'main':i%2?'west':'east',t=.06+r()*.94,p=World.pointAt(id,t);
  const side=r()>.51?1:-1,offset=side*(6.5+r()*23);
  const x=p.x+Math.cos(p.angle)*offset,z=p.z-Math.sin(p.angle)*offset,local=villageLocal(x,z);
  if(Math.abs(x)>111||Math.abs(z)>74||World.slopeAt(x,z)>.52)continue;
  if(local.x>12&&local.x<40&&local.z>-14&&local.z<10)continue;
  const species=i%3,scale=.65+r()*.65;
  trees.push({x,z,y:World.heightAt(x,z),species,scale,rotation:r()*Math.PI*2});
 }
 const leafG=foliageCluster(),leafM=new T.MeshStandardMaterial({vertexColors:true,roughness:.94,side:T.DoubleSide});
 const wind={value:0};
 function movingMaterial(material,strength){
  material.onBeforeCompile=s=>{
   s.uniforms.uWind=wind;
   s.vertexShader='uniform float uWind;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    vec3 grove=(instanceMatrix*vec4(position,1.)).xyz;
    transformed.x+=sin(uWind*1.4+grove.x*.17+grove.z*.11)*${strength.toFixed(3)};
    transformed.z+=cos(uWind*.9+grove.z*.21)*${(strength*.4).toFixed(3)};`);
  };
 }
 movingMaterial(leafM,.045);
 const barkM=new T.MeshStandardMaterial({color:'#655d49',roughness:.96});
 const trunkG=new T.CylinderGeometry(.12,.21,1,7,3),branchesG=new T.CylinderGeometry(.035,.095,1,5);
 const trunks=new T.InstancedMesh(trunkG,barkM,trees.length),branches=new T.InstancedMesh(branchesG,barkM,trees.length*5);
 const leaves=new T.InstancedMesh(leafG,leafM,trees.length*10);
 let b=0,l=0;
 const color=new T.Color();
 trees.forEach((tree,i)=>{
  const {x,y,z,species,scale}=tree,height=species===0?8.2:species===1?5.9:4.7;
  dummy.position.set(x,y+height*.24*scale,z);dummy.rotation.set(0,tree.rotation,0);dummy.scale.set(scale,height*.48*scale,scale);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
  for(let j=0;j<5;j++){
   const a=tree.rotation+j*2.399,h=(height*.30+j*.38)*scale;
   dummy.position.set(x+Math.cos(a)*.45*scale,y+h,z+Math.sin(a)*.45*scale);
   dummy.rotation.set(Math.cos(a)*.65,a,Math.sin(a)*.65);dummy.scale.set(scale,2.2*scale,scale);dummy.updateMatrix();branches.setMatrixAt(b++,dummy.matrix);
  }
  for(let j=0;j<10;j++){
   const a=j*2.399+tree.rotation,rad=species===0?.45+(j%3)*.2:1+(j%3)*.4;
   const crownY=species===0?height*.4+j*.4:height*.58+(j%3)*.65;
   dummy.position.set(x+Math.cos(a)*rad*scale,y+crownY*scale,z+Math.sin(a)*rad*scale);
   dummy.rotation.set(r()*.5,r()*6.28,r()*.3);
   dummy.scale.set((species===0?1.1:1.55)*scale,(species===0?1.65:1.05)*scale,(species===0?1.15:1.55)*scale);
   dummy.updateMatrix();leaves.setMatrixAt(l,dummy.matrix);
   color.setRGB(.84+r()*.16,.89+r()*.11,.73+r()*.20);leaves.setColorAt(l++,color);
  }
 });
 for(const m of [trunks,branches,leaves]){m.castShadow=true;m.receiveShadow=true;group.add(m);}
 const rockG=new T.IcosahedronGeometry(1,1),rockM=new T.MeshStandardMaterial({color:'#b5b3a2',roughness:.9,flatShading:true});
 const rocks=new T.InstancedMesh(rockG,rockM,1050);
 for(let i=0;i<1050;i++){
  const p=World.pointAt(i%5?'main':i%2?'west':'east',r()),offset=(r()>.5?1:-1)*(2.3+r()*4);
  const x=p.x+Math.cos(p.angle)*offset,z=p.z-Math.sin(p.angle)*offset,s=.12+r()*.46;
  dummy.position.set(x,World.heightAt(x,z)+s*.12,z);dummy.rotation.set(r(),r()*6.28,r());dummy.scale.set(s*1.4,s*.62,s);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
  color.setHSL(.12,.06+r()*.12,.40+r()*.23);rocks.setColorAt(i,color);
 }
 rocks.castShadow=true;rocks.receiveShadow=true;group.add(rocks);
 const bladeGeo=new T.BufferGeometry(),v=[],idx=[];
 for(let j=0;j<9;j++){
  const a=j*2.399,h=.3+(j%4)*.14,x=Math.cos(a)*.16,z=Math.sin(a)*.16,k=v.length/3;
  v.push(x-.018,0,z,x+.018,0,z,x+.10,h*.6,z+.05,x+.13,h,z+.06);idx.push(k,k+1,k+2,k+1,k+3,k+2);
 }
 bladeGeo.setAttribute('position',new T.Float32BufferAttribute(v,3));bladeGeo.setIndex(idx);bladeGeo.computeVertexNormals();
 const grassM=new T.MeshStandardMaterial({color:'#ffffff',roughness:.95,side:T.DoubleSide});
 movingMaterial(grassM,.018);
 const grass=new T.InstancedMesh(bladeGeo,grassM,8500);
 for(let i=0;i<8500;i++){
  const p=World.pointAt(i%7?'main':i%2?'east':'west',r()),side=r()>.5?1:-1;
  const offset=side*(3.7+Math.pow(r(),1.6)*22),x=p.x+Math.cos(p.angle)*offset,z=p.z-Math.sin(p.angle)*offset;
  const cluster=.5+.5*Math.sin(x*.29+Math.sin(z*.24)*2)*Math.sin(z*.31);
  const s=.4+r()*.9;
  dummy.position.set(x,World.heightAt(x,z)-.025,z);dummy.rotation.set(0,r()*6.28,0);dummy.scale.set(s,cluster<.25?.05:s,s);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);
  color.setHSL(.16+r()*.065,.18+r()*.2,.21+r()*.12);grass.setColorAt(i,color);
 }
 grass.receiveShadow=true;group.add(grass);
 return{group,trees,tick:(time,reduced)=>{wind.value=reduced?0:time;},setTreesVisible:value=>{trunks.visible=branches.visible=leaves.visible=!!value;},statistics:{trees:trees.length,leafClusters:l,riverStones:1050,grassClumps:8500}};
}
