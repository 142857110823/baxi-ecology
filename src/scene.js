import {World,clamp} from './world.js';
import {flowSection} from './water-path.js';
import {Reflector} from 'three/examples/jsm/objects/Reflector.js';
import {createVillage} from './village.js';
import {createWaterState} from './water-state.js';
import {createLandscape} from './landscape.js';
import soilImage from '../assets/loess-albedo.png';
import cliffImage from '../assets/loess-cliff.png';
const T=window.THREE;
T.ColorManagement.enabled=true;
const soilTexture=new T.TextureLoader().load(soilImage);
soilTexture.wrapS=soilTexture.wrapT=T.RepeatWrapping;soilTexture.anisotropy=8;
const cliffTexture=new T.TextureLoader().load(cliffImage);
cliffTexture.wrapS=cliffTexture.wrapT=T.RepeatWrapping;cliffTexture.anisotropy=8;
function seeded(seed=971){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function soilMaterial(color='#bd9a61',layerStrength=.035){
 const m=new T.MeshStandardMaterial({color,roughness:.94});
 m.customProgramCacheKey=()=>`baxi-soil-${layerStrength}`;
 m.onBeforeCompile=shader=>{
  shader.uniforms.uSoilImage={value:soilTexture};
  shader.uniforms.uCliffImage={value:cliffTexture};
  shader.vertexShader='varying vec3 soilP;varying vec3 soilN;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nsoilP=(modelMatrix*vec4(position,1.)).xyz;soilN=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader='uniform sampler2D uSoilImage;uniform sampler2D uCliffImage;varying vec3 soilP;varying vec3 soilN;\nfloat soilHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float grain=soilHash(floor(soilP*48.));
   float coarse=sin(soilP.x*2.4+sin(soilP.z*.8))*sin(soilP.z*3.1+soilP.y);
   float layer=smoothstep(.86,.96,fract(soilP.y*2.85+sin(soilP.x*.7)*.075));
   float steep=1.-smoothstep(.55,.9,abs(normalize(soilN).y));
   float streak=pow(max(0.,sin(soilP.x*1.75+soilP.z*2.13+sin(soilP.y*.19)*.55)),18.)*steep;
   float weather=sin(soilP.x*.19+sin(soilP.z*.13))*sin(soilP.z*.23+soilP.y*.12);
   vec3 weights=abs(normalize(soilN));weights/=weights.x+weights.z+.0001;
   vec3 cliff=mix(texture2D(uCliffImage,soilP.xy*.15).rgb,texture2D(uCliffImage,soilP.zy*.15+vec2(.37,0.)).rgb,weights.x);
   vec3 soilTex=mix(texture2D(uSoilImage,soilP.xz*.16).rgb,cliff,steep);
   diffuseColor.rgb*=mix(vec3(.80),soilTex*1.55,.48);
   diffuseColor.rgb*=.94+grain*.065+coarse*.028+weather*.065-layer*${layerStrength.toFixed(3)}-streak*.065;`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
   float soilBump=dot(soilTex,vec3(.333));
   vec3 bx=dFdx(-vViewPosition),by=dFdy(-vViewPosition),br1=cross(by,normal),br2=cross(normal,bx);
   float bd=dot(bx,br1);vec3 bg=sign(bd)*(dFdx(soilBump)*br1+dFdy(soilBump)*br2);
   normal=normalize(abs(bd)*normal-bg*.09);`);
 };
 return m;
}
// Dam faces need horizontal compaction lifts, not the terrain shader's vertical cliff streaks.
export function rammedMaterial(color='#917c5c'){
 const m=new T.MeshStandardMaterial({color,roughness:.98});
 m.customProgramCacheKey=()=>`baxi-rammed-${color}`;
 m.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec3 rammedP;varying vec3 rammedN;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrammedP=(modelMatrix*vec4(position,1.)).xyz;rammedN=normalize(mat3(modelMatrix)*normal);');
  shader.fragmentShader='varying vec3 rammedP;varying vec3 rammedN;\nfloat rammedHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float grain=rammedHash(floor(rammedP*54.));
   float lift=smoothstep(.10,.30,abs(fract(rammedP.y*3.05+sin(rammedP.x*.35)*.035)-.5));
   float pit=step(.935,rammedHash(floor(rammedP*76.)));
   float weather=sin(rammedP.x*.21+rammedP.z*.17)*.5+.5;
   diffuseColor.rgb*=.84+.14*lift+.055*grain+.035*weather-.055*pit;`);
 };
 return m;
}
function mesh(g,m,x=0,y=0,z=0){const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;return o;}
export function createScene(canvas){
 const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.83;
 const scene=new T.Scene();scene.background=new T.Color('#bacdd0');scene.fog=new T.Fog('#c7d1cd',175,650);
 const camera=new T.PerspectiveCamera(52,1,.08,1000);
 const hemi=new T.HemisphereLight('#d9e6ed','#74785d',.68);scene.add(hemi);
 const sun=new T.DirectionalLight('#fff0d5',1.55);sun.position.set(-85,110,55);sun.castShadow=true;
 sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-125,right:125,top:125,bottom:-125,near:1,far:320});
 sun.shadow.bias=-.0002;sun.shadow.normalBias=.025;sun.shadow.radius=2.5;scene.add(sun);
 const skyStorm={value:0};
 const sky=new T.Mesh(new T.SphereGeometry(750,24,12),new T.ShaderMaterial({
  uniforms:{uStorm:skyStorm},
  side:T.BackSide,depthWrite:false,
  vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`varying vec3 v;uniform float uStorm;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
   void main(){vec3 d=normalize(v);float h=d.y;
    vec3 a=mix(vec3(.78,.84,.83),vec3(.43,.50,.51),uStorm),b=mix(vec3(.40,.57,.65),vec3(.22,.32,.36),uStorm);
    vec3 sky=mix(a,b,smoothstep(-.02,.85,h));
    vec2 p=d.xz/max(.15,d.y+.2)*3.;
    float cloud=noise(p)*.55+noise(p*2.1)*.28+noise(p*4.2)*.17;
    float cover=smoothstep(.48,.73,cloud)*smoothstep(.01,.18,h);
    sky=mix(sky,mix(vec3(.92,.92,.86),vec3(.53,.59,.58),uStorm),cover*.75);
    gl_FragColor=vec4(sky,1.);
   }`
 }));scene.add(sky);
 const atmosphere=new T.Group();scene.add(atmosphere);
 const cloudMaterial=new T.MeshStandardMaterial({color:'#b9c9d0',roughness:1,flatShading:false});
 const cloudGeo=new T.IcosahedronGeometry(1,2);
 const grid=World.grid();
 const terrainG=new T.BufferGeometry();terrainG.setAttribute('position',new T.BufferAttribute(grid.vertices,3));terrainG.setIndex(new T.BufferAttribute(grid.indices,1));terrainG.computeVertexNormals();
 const colors=new Float32Array(grid.vertices.length),c=new T.Color(),normal=terrainG.attributes.normal;
 const soilBase=new T.Color('#a9997e'),soilHigh=new T.Color('#7e8865'),soilCut=new T.Color('#96856c');
 function terrainColor(x,z,y,ny){
  const shade=.5+.5*Math.sin(x*.035+z*.058);
  c.copy(soilBase).lerp(soilHigh,clamp((y-23)/12,0,1)).lerp(soilCut,clamp((.78-ny)/.45,0,1));
  const bank=World.channelAt(x,z),distance=bank.distance;
  const band=clamp((distance-2.4)/2.4,0,1)*clamp((18-distance)/9,0,1)*clamp((ny-.48)/.4,0,1);
  const patch=.5+.5*Math.sin(x*.081+Math.sin(z*.046)*2)*Math.cos(z*.093+x*.018);
  const cover=clamp((patch-.38)/.4,0,1)*clamp((ny-.58)/.32,0,1);
  c.lerp(bankGreen,Math.max(band*.72,cover*.68));
  c.lerp(dampSoil,clamp((6-distance)/4,0,1)*.37);
  return c.multiplyScalar(.95+shade*.12);
 }
 const bankGreen=new T.Color('#5e7148'),dampSoil=new T.Color('#686652');
 for(let i=0;i<grid.vertices.length/3;i++){
  const x=grid.vertices[i*3],z=grid.vertices[i*3+2],y=grid.vertices[i*3+1];
  terrainColor(x,z,y,normal.getY(i));colors.set([c.r,c.g,c.b],i*3);
 }
 terrainG.setAttribute('color',new T.BufferAttribute(colors,3));
 const groundMat=soilMaterial('#ffffff');groundMat.vertexColors=true;
 const terrain=mesh(terrainG,groundMat);terrain.castShadow=true;scene.add(terrain);
 const farG=new T.BufferGeometry();
 const context=window.LAND_DATA,dem=context?new Float32Array(Uint8Array.from(atob(context.heights),c=>c.charCodeAt(0)).buffer):null;
 function distantHeight(x,z){
  if(!dem)return 35;
  const ix=clamp(Math.round((x/1100+.5)*(context.n-1)),0,context.n-1),iz=clamp(Math.round((z/1000+.5)*(context.n-1)),0,context.n-1);
  return 27+Math.min(110,dem[iz*context.n+ix]-context.min)*.14;
 }
 // A stitched perimeter shares every boundary sample with the playable grid.
 const perimeter=[];
 for(let x=-120;x<120;x++)perimeter.push([x,-80]);
 for(let z=-80;z<80;z++)perimeter.push([120,z]);
 for(let x=120;x>-120;x--)perimeter.push([x,80]);
 for(let z=80;z>-80;z--)perimeter.push([-120,z]);
 const farVertices=[],farIndices=[],rings=[0,2,5,10,18,30,45,65,90,125,170,230,310,430],ringCount=perimeter.length;
 for(const offset of rings)for(const [bx,bz] of perimeter){
  const x=bx*(1+offset/120),z=bz*(1+offset/80),blend=clamp(offset/110,0,1),smooth=blend*blend*(3-2*blend);
  const extension=z>72||z<-72?World.scenicPointAt((z+72)/144):null;
  const riverMask=extension?1-clamp((Math.abs(x-extension.x)-6)/28,0,1):0;
  const blendFar=smooth*(1-riverMask);
  farVertices.push(x,World.heightAt(x,z)*(1-blendFar)+distantHeight(x,z)*blendFar,z);
 }
 for(let r=0;r<rings.length-1;r++)for(let i=0;i<ringCount;i++){
  const j=(i+1)%ringCount,a=r*ringCount+i,b=r*ringCount+j,c=a+ringCount,d=b+ringCount;
  farIndices.push(a,b,c,b,d,c);
 }
 farG.setAttribute('position',new T.Float32BufferAttribute(farVertices,3));farG.setIndex(farIndices);farG.computeVertexNormals();
 const farColors=new Float32Array(farVertices.length);
 for(let i=0;i<farVertices.length/3;i++){terrainColor(farVertices[i*3],farVertices[i*3+2],farVertices[i*3+1],farG.attributes.normal.getY(i));farColors.set([c.r,c.g,c.b],i*3);}
 farG.setAttribute('color',new T.BufferAttribute(farColors,3));
 const farMesh=mesh(farG,groundMat);farMesh.castShadow=false;scene.add(farMesh);
 const waterG=new T.BufferGeometry(),wv=[],wi=[],waterSamples=[],flowCoordinates=[],waterColumns=17;
 for(const id of ['main','west','east']){
  const count=id==='main'?640:288,offset=wv.length/3,start=id==='main'?-.4:0,end=id==='main'?2.3:1;
  for(let i=0;i<=count;i++){
   const t=start+(end-start)*i/count,section=flowSection(id,t,[],waterColumns-1);
   waterSamples.push({id,t});
   for(const p of section.vertices){wv.push(p.x,p.y,p.z);flowCoordinates.push(i/count,p.side);}
   if(i<count)for(let j=0;j<waterColumns-1;j++){
    const a=offset+i*waterColumns+j,b=a+waterColumns;wi.push(a,b,a+1,a+1,b,b+1);
   }
  }
 }
 waterG.setAttribute('position',new T.Float32BufferAttribute(wv,3));waterG.setIndex(wi);waterG.computeVertexNormals();
 waterG.setAttribute('aFlow',new T.Float32BufferAttribute(flowCoordinates,2));
 for(const name of ['aTurbidity','aSurge','aFoam'])waterG.setAttribute(name,new T.BufferAttribute(new Float32Array(wv.length/3),1));
 const reflector=new Reflector(new T.PlaneGeometry(260,200),{textureWidth:512,textureHeight:512,clipBias:.002,multisample:0});
 reflector.rotation.x=-Math.PI/2+Math.atan(14/144);reflector.position.y=10.1;reflector.visible=false;scene.add(reflector);
 const waterUniforms={uTime:{value:0},uTrial:{value:0},uMotion:{value:1},uReflection:{value:reflector.getRenderTarget().texture},uReflectionMatrix:{value:new T.Matrix4()},uReflectionStrength:{value:0}};
 const waterMat=new T.MeshStandardMaterial({color:'#ffffff',roughness:.29,metalness:.12,transparent:true,opacity:.97,side:T.DoubleSide});
 waterMat.customProgramCacheKey=()=> 'baxi-local-water-v3';
 waterMat.onBeforeCompile=s=>{
  s.uniforms.uTime=waterUniforms.uTime;s.uniforms.uTrial=waterUniforms.uTrial;s.uniforms.uMotion=waterUniforms.uMotion;
  s.uniforms.uReflection=waterUniforms.uReflection;s.uniforms.uReflectionMatrix=waterUniforms.uReflectionMatrix;s.uniforms.uReflectionStrength=waterUniforms.uReflectionStrength;
  s.vertexShader='attribute float aTurbidity;attribute float aSurge;attribute float aFoam;attribute vec2 aFlow;varying float turbidity;varying float surge;varying float foam;varying vec2 flow;varying vec3 wp;varying vec4 reflectionUV;uniform mat4 uReflectionMatrix;uniform float uTime;uniform float uMotion;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
  turbidity=aTurbidity;surge=aSurge;foam=aFoam;flow=aFlow;
  transformed.y+=aSurge*.055*sin(aFlow.x*140.-uTime*4.)*uMotion;
  wp=(modelMatrix*vec4(transformed,1.)).xyz;reflectionUV=uReflectionMatrix*vec4(wp,1.);`);
  s.fragmentShader='varying vec3 wp;varying vec4 reflectionUV;varying float turbidity;varying float surge;varying float foam;varying vec2 flow;uniform sampler2D uReflection;uniform float uReflectionStrength;uniform float uTime;uniform float uTrial;uniform float uMotion;\n'+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
  float clock=uTime*uMotion;
  float ripple=sin(flow.x*720.-clock*5.+sin(wp.x*2.7))*sin(flow.y*7.+clock*1.6);
  float stream=sin(flow.x*390.-clock*5.5+sin(flow.y*16.)*.8);
  float grain=fract(sin(dot(floor(wp.xz*11.),vec2(127.1,311.7)))*43758.5453);
  float edge=1.-smoothstep(.60,1.,abs(flow.y));
  float sedimentBand=smoothstep(.18,.92,sin(flow.x*170.-clock*2.4+sin(flow.y*9.)*1.7)*.5+.5);
  // Clear water is cold and dark; muddy water is a desaturated ochre, never a saturated red carpet.
  vec3 clearWater=mix(vec3(.020,.052,.050),vec3(.072,.132,.120),.50+.20*ripple);
  vec3 muddyWater=mix(vec3(.105,.056,.021),vec3(.292,.170,.072),.58+.12*ripple);
  vec3 waterColor=mix(clearWater,muddyWater,turbidity);
  waterColor=mix(waterColor,waterColor*1.16,turbidity*sedimentBand*.34);
  waterColor*= .94+grain*.08;
  diffuseColor.rgb=waterColor;
  vec2 uv=reflectionUV.xy/reflectionUV.w+vec2(ripple*.0015);
  vec3 reflected=texture2D(uReflection,clamp(uv,vec2(.001),vec2(.999))).rgb;
  diffuseColor.rgb=mix(diffuseColor.rgb,reflected,uReflectionStrength*(1.-turbidity*.70));
  float bankFoam=smoothstep(.70,.98,abs(flow.y))*smoothstep(.18,.90,stream);
  float streak=pow(max(0.,stream),30.)*(.012+foam*.10);
  vec3 foamColor=mix(vec3(.30,.37,.33),vec3(.42,.28,.13),turbidity);
  diffuseColor.rgb=mix(diffuseColor.rgb,foamColor,clamp(bankFoam*(.09+turbidity*.08)+streak,0.,.22));
  diffuseColor.rgb+=ripple*.006;
  float sparkle=pow(max(0.,sin(flow.x*520.-clock*7.+flow.y*13.)),24.)*smoothstep(.18,1.,surge);
  vec3 sparkleColor=mix(vec3(.54,.64,.61),vec3(.72,.61,.43),turbidity);
  diffuseColor.rgb=mix(diffuseColor.rgb,sparkleColor,sparkle*(.16+turbidity*.10));
  float churn=smoothstep(.35,1.,surge)*smoothstep(.02,.55,abs(flow.y));
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.23,.12),churn*.18);
  float fresnel=pow(1.-max(0.,dot(normalize(vNormal),normalize(vViewPosition))),2.4);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.45,.46),fresnel*(.20+.16*(1.-turbidity)));
  diffuseColor.rgb*=1.-(1.-edge)*.18;
  // Soft bank contact: the ribbon dissolves into the bed instead of ending on a hard edge.
  float alpha=mix(.66,.97,turbidity)*edge*(.90+grain*.10);
  diffuseColor.a*=alpha;`);
  s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
   normal=normalize(normal+vec3(sin(wp.z*4.2-uTime*1.7)*.13,0.,cos(wp.x*3.1+wp.z*.8-uTime)*.13)*uMotion);
   float glint=pow(max(0.,dot(normal,normalize(vec3(-.35,.84,.42)))),30.);
   diffuseColor.rgb+=vec3(.58,.64,.58)*glint*(.18+.08*(1.-turbidity));`);
 };
 const water=mesh(waterG,waterMat);water.castShadow=false;scene.add(water);
 const rainPositions=new Float32Array(800*6),rainGeometry=new T.BufferGeometry();
 rainGeometry.setAttribute('position',new T.BufferAttribute(rainPositions,3));
 const rain=new T.LineSegments(rainGeometry,new T.LineBasicMaterial({color:'#7cabb4',transparent:true,opacity:.35,depthWrite:false}));
 rain.frustumCulled=false;rain.visible=false;scene.add(rain);
 let trialResult=null,waterState=createWaterState(null),trialReduced=false;
 function setWaterLayout(items){
  const a=waterG.attributes.position;
  waterSamples.forEach(({id,t},i)=>{
   const section=flowSection(id,t,items,waterColumns-1);
   section.vertices.forEach((p,j)=>a.setXYZ(i*waterColumns+j,p.x,p.y,p.z));
  });
  a.needsUpdate=true;waterG.computeVertexNormals();waterG.computeBoundingBox();waterG.computeBoundingSphere();
 }
 function setTrialState(result,time,{reduced=false,phase}={}){
  if(result!==trialResult){trialResult=result;waterState=createWaterState(result);}
  trialReduced=reduced;waterUniforms.uMotion.value=reduced?0:1;
  waterUniforms.uTrial.value=result?1:0;
  for(let i=0;i<waterSamples.length;i++){
   const {id,t}=waterSamples[i],local=waterState.sample(id,t,time);
   for(let j=0;j<waterColumns;j++){
    const index=i*waterColumns+j;
    waterG.attributes.aTurbidity.setX(index,local.turbidity);
    waterG.attributes.aSurge.setX(index,local.surge);
    waterG.attributes.aFoam.setX(index,local.foam);
   }
  }
  for(const name of ['aTurbidity','aSurge','aFoam'])waterG.attributes[name].needsUpdate=true;
  village.setImpact(result?time/result.duration:0,result);
  const outletState=waterState.sample('main',.999,time);
  village.pool.material.color.set('#3b9b9c').lerp(poolDirty,outletState.turbidity*.8);
  atmosphere.userData.phase=phase??'prepare';
  cloudMaterial.color.set(result?'#95aab6':'#b9c9d0');
  const storm=phase==='wave'?Math.min(1,time/1.8)*Math.min(1,(35-time)/4):0;
  skyStorm.value=storm;sun.intensity=1.55-storm*.8;hemi.intensity=.68+storm*.10;
  rain.visible=storm>.02&&!reduced;
  if(rain.visible){
   rain.material.opacity=storm*.32;
   for(let i=0;i<800;i++){
    const x=(((i*73.137)%240)-120),z=((i*47.213)%160)-80,y=World.heightAt(x,z)+((i*.431-time*15)%32+32)%32;
    rainPositions.set([x,y,z,x+.45,y-2.2,z+.1],i*6);
   }
   rainGeometry.attributes.position.needsUpdate=true;
  }
 }
 // Parent syncWorld calls this for loaded, settled, retried and replacement worlds.
 function setWorldState(state){village.setWorldState(state);}
 const poolDirty=new T.Color('#98744b');
 const village=createVillage(scene,World);
 const landscape=createLandscape(scene);
 const markerGroup=new T.Group();scene.add(markerGroup);
 function label(text,color='#e9f3ef',size=3.2){
  const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');
  ctx.clearRect(0,0,512,128);ctx.font='600 52px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.shadowColor='#294036';ctx.shadowBlur=7;ctx.fillText(text,256,77);
  const texture=new T.CanvasTexture(c);texture.encoding=T.sRGBEncoding;
  const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthTest:true}));sprite.scale.set(size*4,size,1);return sprite;
 }
 const markers=[];
 for(const [id,t,text] of [['main',.96,'家园'],['west',.64,'左侧支流'],['east',.65,'右侧支流']]){
  const p=World.pointAt(id,t),x=p.x+Math.cos(p.angle)*6,z=p.z-Math.sin(p.angle)*6,y=World.heightAt(x,z);
  const post=mesh(new T.CylinderGeometry(.07,.09,2.6,6),new T.MeshStandardMaterial({color:'#70664d'}),x,y+1.3,z);
  markerGroup.add(post);const sign=label(text,'#edf6ec',.66);sign.position.set(x,y+2.8,z);markerGroup.add(sign);markers.push({x,z,text});
 }
 const gaugePoint=World.pointAt('main',.795),gaugeX=gaugePoint.x-Math.cos(gaugePoint.angle)*4.7,gaugeZ=gaugePoint.z+Math.sin(gaugePoint.angle)*4.7,gaugeY=World.heightAt(gaugeX,gaugeZ);
 const gauge=new T.Group();gauge.position.set(gaugeX,gaugeY,gaugeZ);gauge.rotation.y=gaugePoint.angle;
 const pale=new T.MeshStandardMaterial({color:'#e5dec4',roughness:.85}),dark=new T.MeshStandardMaterial({color:'#5c6b54',roughness:.9});
 gauge.add(mesh(new T.BoxGeometry(.16,2.05,.10),pale,0,1.025,0));
 for(let i=0;i<8;i++)gauge.add(mesh(new T.BoxGeometry(i%2?.08:.14,.055,.012),dark,0,.15+i*.25,.057));
 const flagGeo=new T.BufferGeometry();flagGeo.setAttribute('position',new T.Float32BufferAttribute([.08,1.95,.02,.65,1.77,.02,.08,1.58,.02],3));flagGeo.computeVertexNormals();
 gauge.add(mesh(flagGeo,new T.MeshStandardMaterial({color:'#bd6c43',side:T.DoubleSide,roughness:1})));markerGroup.add(gauge);
 let composer=null,composerError=null;
 const plugins=window.BaxiPlugins;
 if(plugins?.EffectComposer&&plugins.RenderPass&&plugins.EffectPass&&plugins.BloomEffect&&plugins.VignetteEffect){
  try{
   composer=new plugins.EffectComposer(renderer,{multisampling:renderer.capabilities.isWebGL2?4:0});
   composer.addPass(new plugins.RenderPass(scene,camera));
   const bloom=new plugins.BloomEffect({intensity:.22,luminanceThreshold:.76,luminanceSmoothing:.3,mipmapBlur:true});
   const vignette=new plugins.VignetteEffect({darkness:.19,offset:.30});
   const effects=[bloom,vignette];
   if(plugins.NoiseEffect){const noise=new plugins.NoiseEffect({premultiply:true});if(noise.blendMode?.opacity)noise.blendMode.opacity.value=.018;effects.push(noise);}
   composer.addPass(new plugins.EffectPass(camera,...effects));
  }catch(error){composerError=String(error);composer?.dispose();composer=null;console.warn('Scene finishing unavailable:',error);}
 }
 function resize(){renderer.setSize(innerWidth,innerHeight,false);composer?.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
 resize();window.addEventListener('resize',resize);
 let quality='medium',renderFrame=0;
 return{renderer,scene,camera,terrain,grid,sun,water,waterUniforms,label,markers,setWaterLayout,setTrialState,setWorldState,village,landscape,
  get composer(){return composer;},get composerError(){return composerError;},
  render(time,trial){
   landscape.tick(time,trialReduced);
   waterUniforms.uTime.value=trialReduced?0:time;waterUniforms.uTrial.value=trial?1:0;
   const reflect=quality!=='low'&&camera.position.y<90;
   waterUniforms.uReflectionStrength.value=reflect?.24:0;
   if(reflect&&renderFrame++%2===0){
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);water.visible=false;
    reflector.onBeforeRender(renderer,scene,camera);reflector.visible=false;water.visible=true;
    waterUniforms.uReflectionMatrix.value.copy(reflector.material.uniforms.textureMatrix.value).multiply(reflector.matrixWorld.clone().invert());
   }
   if(composer&&quality!=='low')composer.render();else renderer.render(scene,camera);
  },
  setQuality(q){quality=q;renderer.setPixelRatio(q==='low'?1:Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=q!=='low';resize();},
  get quality(){return quality;}
 };
}
export {mesh,seeded};
