import RAPIER from '@dimforge/rapier3d-compat';
import {World,clamp} from './world.js';
import {damOverlapsPlayer,PLAYER_CAPSULE,damSegments} from './layout.js';
const T=window.THREE;
export async function createPlayer(camera,canvas,grid,onState){
 await RAPIER.init();
 const physics=new RAPIER.World({x:0,y:-9.81,z:0});
 physics.createCollider(RAPIER.ColliderDesc.trimesh(grid.vertices,grid.indices));
 const spawn=World.pointAt('main',.83);
 const body=physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x,World.heightAt(spawn.x,spawn.z)+.86,spawn.z));
 const collider=physics.createCollider(RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE.halfHeight,PLAYER_CAPSULE.radius),body);
 const controller=physics.createCharacterController(PLAYER_CAPSULE.skin);
 controller.enableAutostep(.25,.2,false);
 controller.setMaxSlopeClimbAngle(40*Math.PI/180);
 controller.setMinSlopeSlideAngle(43*Math.PI/180);
 controller.enableSnapToGround(.35);
 const keys=new Set(),euler=new T.Euler(0,0,0,'YXZ');
 let yaw=0,pitch=-.13,locked=false,dragging=false,enabled=true,overview=false,lastSafe={x:spawn.x,z:spawn.z},vy=0,ignoreLookUntil=0;
 let fallback=false,dragStart=null,dragged=false;
 const obstacleHandles=new Map(),damLayouts=new Map();
 function release(){keys.clear();dragging=false;dragStart=null;dragged=false;locked=false;ignoreLookUntil=performance.now()+100;if(document.pointerLockElement===canvas)document.exitPointerLock();}
 function applyPose(position){
  body.setTranslation(position,true);body.setNextKinematicTranslation(position);vy=0;
  physics.propagateModifiedBodyPositionsToColliders();
 }
 function reset(p=lastSafe){
  const ground=World.heightAt(p.x,p.z)+.87;
  const position={x:p.x,y:Number.isFinite(p.y)?Math.max(p.y,ground):ground,z:p.z};
  applyPose(position);
  ensureClearOfDams([...damLayouts.values()]);
 }
 function look(dx,dy){yaw-=dx*.002;pitch=clamp(pitch-dy*.002,-1.4,1.35);}
 function useFallback(){fallback=true;onState?.('fallback');}
 document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===canvas;if(locked)fallback=false;ignoreLookUntil=performance.now()+100;keys.clear();onState?.(locked?'locked':'unlocked');});
 document.addEventListener('pointerlockerror',useFallback);
 document.addEventListener('mousemove',e=>{if(performance.now()<ignoreLookUntil)return;if(enabled&&!overview&&((locked&&document.pointerLockElement===canvas)||dragging))look(e.movementX,e.movementY);});
 canvas.addEventListener('pointerdown',e=>{dragged=false;if(!locked&&fallback&&enabled&&!overview&&e.button===0){dragging=true;dragStart={x:e.clientX,y:e.clientY};try{canvas.setPointerCapture?.(e.pointerId);}catch{}}});
 document.addEventListener('pointermove',e=>{if(dragging&&dragStart&&Math.hypot(e.clientX-dragStart.x,e.clientY-dragStart.y)>4)dragged=true;});
 window.addEventListener('pointerup',()=>{dragging=false;dragStart=null;});
 canvas.addEventListener('pointercancel',()=>{dragging=false;dragStart=null;dragged=true;});
 window.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select'))return;
  if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code))keys.add(e.code);
  if(['Space','Tab'].includes(e.code))e.preventDefault();
 });
 window.addEventListener('keyup',e=>keys.delete(e.code));
 window.addEventListener('blur',()=>{release();onState?.('blur');});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){release();onState?.('blur');}});
 function tick(dt){
  if(overview||!enabled){keys.clear();return;}
  const f=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),s=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight'))?5.5:3.5,length=Math.hypot(f,s)||1;
  const dx=(Math.cos(yaw)*s-Math.sin(yaw)*f)/length*speed*dt;
  const dz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)/length*speed*dt;
  vy=controller.computedGrounded()?-2:Math.max(-20,vy-18*dt);
  controller.computeColliderMovement(collider,{x:dx,y:vy*dt,z:dz});
  const delta=controller.computedMovement(),p=body.translation();
  body.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});
  physics.timestep=dt;physics.step();
  let now=body.translation();
  if(!World.inBounds(now.x,now.z)||now.y<World.heightAt(now.x,now.z)-2||!Number.isFinite(now.y)){reset();now=body.translation();}
  else if(controller.computedGrounded())lastSafe={x:now.x,y:now.y,z:now.z};
  camera.position.set(now.x,now.y+.82,now.z);
  euler.set(pitch,yaw,0);camera.quaternion.setFromEuler(euler);
 }
 function addDam(s){
  removeDam(s.id);
  const p=World.pointAt(s.channel,s.t);
  const colliders=damSegments(s).map(segment=>{
   const desc=RAPIER.ColliderDesc.convexHull(segment.vertices);
   desc.setTranslation(p.x,p.y,p.z).setRotation({x:0,y:Math.sin(p.angle/2),z:0,w:Math.cos(p.angle/2)});
   return physics.createCollider(desc);
  });
  obstacleHandles.set(s.id,colliders);
  damLayouts.set(s.id,{...s});
 }
 function removeDam(id){const colliders=obstacleHandles.get(id);if(colliders){for(const c of colliders)physics.removeCollider(c,true);obstacleHandles.delete(id);}damLayouts.delete(id);}
 function ensureClearOfDams(items){
  const dams=items.filter(s=>s.type==='dam');
  if(!dams.some(s=>damOverlapsPlayer(s,body.translation())))return false;
  const safe=p=>{
   if(!World.inBounds(p.x,p.z)||World.slopeAt(p.x,p.z)>40*Math.PI/180)return false;
   const position={x:p.x,z:p.z,y:World.heightAt(p.x,p.z)+.87};
   if(dams.some(s=>damOverlapsPlayer(s,position)))return false;
   keys.clear();applyPose(position);lastSafe={...position};return true;
  };
  const current=body.translation();
  for(const radius of [2,4,6,8,12])for(let i=0;i<16;i++){
   const angle=i*Math.PI/8;
   if(safe({x:current.x+Math.cos(angle)*radius,z:current.z+Math.sin(angle)*radius}))return true;
  }
  if(safe(lastSafe)||safe({x:spawn.x,z:spawn.z}))return true;
  for(const channel of ['main','west','east'])for(let i=1;i<20;i++)if(safe(World.pointAt(channel,i/20)))return true;
  return false;
 }
 return{tick,physics,controller,body,collider,addDam,removeDam,reset,ensureClearOfDams,
  get position(){return body.translation();},get locked(){return locked;},
  get fallback(){return fallback;},
  consumeDragClick(){const wasDragged=dragged;dragged=false;return wasDragged;},
  lookAt(x,y,z){const p=body.translation(),d=new T.Vector3(x-p.x,y-p.y-.82,z-p.z);yaw=Math.atan2(-d.x,-d.z);pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));},
  setEnabled(v){enabled=v;if(!v)release();},
  setOverview(v){overview=v;release();},
  enter(){if(!enabled||overview||fallback)return;try{const p=canvas.requestPointerLock();p?.catch(useFallback);}catch{useFallback();}},
  release,
  setTouchKey(code,down){if(down)keys.add(code);else keys.delete(code);},
  lookDelta(dx,dy){if(enabled&&!overview)look(dx,dy);},
  teleport(x,z){reset({x,z});},
  get state(){return{yaw,pitch,grounded:controller.computedGrounded(),colliders:obstacleHandles.size};}
 };
}
