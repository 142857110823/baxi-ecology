import {World,clamp} from './world.js';
import {createScene} from './scene.js';
import {createPlayer} from './player.js';
import {LayoutStore,validatePlacement,costOf,parseSave} from './layout.js';
import {createPreview,disposePreview,structureRenderer} from './structures.js';
import {createEffects} from './effects.js';
import {runSimulation,ledgerAt} from './simulation.js';
import {Mission} from './mission.js';
import {Campaign,SCENARIOS,parseWorldSave} from './campaign.js';
import {createAftermath} from './aftermath.js';
import {createSoundscape} from './soundscape.js';
const T=window.THREE,P=window.BaxiPlugins,$=id=>document.getElementById(id),icons=()=>window.lucide?.createIcons();
const SAVE_KEY='baxi-ecology-world-v2',BACKUP_KEY='baxi-ecology-backup-v2';
let campaign=new Campaign(),aftermath,replay=null,hints=true,stroke=null,saveError='';
try{const saved=localStorage.getItem(SAVE_KEY);if(saved)campaign=new Campaign(parseWorldSave(saved));}catch(e){saveError=e.message;}
const mission=new Mission(),canvas=$('world'),ray=new T.Raycaster();
const soundscape=createSoundscape();
const store={
 get items(){return campaign.state.structures;},get mode(){return campaign.state.mode;},
 get cost(){return campaign.cost;},get undoStack(){return campaign.undoStack;},
 snapshot(){return structuredClone(this.items);},
 commit(next,mode=this.mode){campaign.setLayout(next,mode);},
 undo(){return campaign.undo();},export(){return campaign.export();}
};
const animations=new P.TWEEN.Group(),pluginUsage={bvhRays:0,cameraTweens:0};
let stage,player,objects,effects,view='command',tool='dam',level=1,rotation=0,candidate=null,validity=null,selected=null,moving=null,ghost=null,uid=Date.now();
let toastEnd=0,eventEnd=0,last=performance.now(),resultShown=false,pausedBeforeMenu=false,importEpoch=0,lastClock='',lastPause=null,lastReady='';
let cameraTween=null,drag=null,pinching=false,dragIgnoreUntil=0,aimPoint=null,lastEvent=0,seenTraps=new Set(),firstWalk=true;
const pointers=new Map(),mobile=matchMedia('(max-width:680px),(pointer:coarse)').matches;
const orbit={x:2,y:9,z:28,azimuth:-.45,elevation:.40,distance:108};
const names={main:'主河道',west:'左侧支流',east:'右侧支流'};
ray.firstHitOnly=true;
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');toastEnd=performance.now()+2500;}
function banner(text){$('event-text').textContent=text;$('event-banner').classList.add('show');eventEnd=performance.now()+2600;}
function editable(){if(mission.phase==='wave'||mission.phase==='due'||replay){toast('先看完这段来水，再继续营造。');return false;}return true;}
function safely(action){try{action();}catch(e){toast(plainReason(e.message));}}
function saveWorld(){
 try{localStorage.setItem(SAVE_KEY,campaign.export());$('save-state').textContent='世界已自动保存 · 雨中退出回到雨前';}
 catch{ $('save-state').textContent='自动保存不可用，请保存整个世界到文件';}
}
function backupWorld(){
 try{localStorage.setItem(BACKUP_KEY,campaign.export());return true;}
 catch{return false;}
}
function syncWorld(){
 stage?.setWorldState?.(campaign.state);
 aftermath?.sync(campaign.state,campaign.scenario,store.items);
 aftermath?.setGauges(hints);
 $('maintenance').textContent=campaign.state.maintenance;$('soil').textContent=campaign.state.soil.toFixed(1);
 document.querySelectorAll('[data-weather]').forEach(el=>{
  const i=+el.dataset.weather;el.classList.toggle('current',i===campaign.state.round);
  el.classList.toggle('finished',!!campaign.state.history[i]);el.classList.toggle('missed',campaign.state.history[i]?.won===false);
 });
 $('world-note').textContent=campaign.state.phase==='complete'?'三场雨已过，继续营造自己的沟谷':campaign.state.phase==='aftermath'?'雨后整治 · 旧墙与泥土会留到下一场':'营造 → 迎雨 → 整治 → 下一场';
 $('history-list').innerHTML=campaign.state.history.map((h,i)=>`<p><b>${SCENARIOS[i].title} · ${h.won?'田路守住':'需要调整'}</b><br>坡上留下 ${h.prevented.toFixed(1)} · 沟中拦住 ${h.trapped.toFixed(1)} · 到村口 ${h.exported.toFixed(1)} / ${SCENARIOS[i].limit}</p>`).join('')||'还没有迎来第一场雨。';
 const after=['aftermath','complete'].includes(campaign.state.phase);
 $('trial').disabled=mission.phase==='wave'||!!replay;
 $('trial').innerHTML=`<i data-lucide="${after?'arrow-right':'cloud-rain'}"></i><span>${campaign.state.phase==='complete'?'巡看自己的沟谷':after?'整治好了，下一场':'迎接这场雨'}</span>`;
 $('ready').hidden=after||mission.phase==='wave';
 $('checkpoint').hidden=!campaign.checkpoint||mission.phase==='wave'||!!replay;
 if(!replay&&mission.phase!=='wave'){
  const previous=campaign.state.history.at(-1),health=campaign.state.field.integrity;
  $('home-state').textContent=previous?(previous.won?'田路已守住':'田路边仍有积土'):'等待你的保护';
  $('home-meter-fill').style.width=`${health}%`;$('home-meter-fill').style.background=previous?.won===false?'#d19a73':'#8fd3a5';
 }
 saveWorld();icons();
}
function editSelected(){
 const id=selected;
 if(!editable())return false;
 if(id&&store.items.some(s=>s.id===id))selected=id;
 return true;
}
function clearCandidate(){
 candidate=null;validity=null;aimPoint=null;$('placement').hidden=true;
 if(ghost){stage.scene.remove(ghost);disposePreview(ghost);ghost=null;}
}
function closeFacility(){selected=null;objects.select(null);$('facility').hidden=true;}
function cameraPose(){
 if(view!=='command')return;
 const h=Math.cos(orbit.elevation)*orbit.distance,x=orbit.x+Math.sin(orbit.azimuth)*h,z=orbit.z+Math.cos(orbit.azimuth)*h;
 stage.camera.position.set(x,Math.max(orbit.y+Math.sin(orbit.elevation)*orbit.distance,World.heightAt(x,z)+4),z);
 stage.camera.lookAt(orbit.x,orbit.y,orbit.z);
}
function moveView(name){
 if(view!=='command')setView('command');
 const target=name==='east'?{x:55,y:18,z:-12,distance:81,elevation:.68,azimuth:.25}:name==='west'?{x:-58,y:18,z:-29,distance:94,elevation:.67,azimuth:-.25}:
  name==='middle'?{x:-3,y:12,z:0,distance:112,elevation:.63,azimuth:-.42}:
  {x:20,y:8,z:32,distance:82,elevation:.38,azimuth:-.75};
 cameraTween?.stop();
 if($('reduced').checked){Object.assign(orbit,target);cameraPose();}
 else{cameraTween=new P.TWEEN.Tween(orbit,animations).to(target,650).easing(P.TWEEN.Easing.Cubic.InOut).start(performance.now());pluginUsage.cameraTweens++;}
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
 clearCandidate();
}
function setView(next){
 closeFacility();clearCandidate();view=next;cameraTween?.stop();
 stage.camera.fov=next==='walk'?75:52;stage.camera.updateProjectionMatrix();
 player.setEnabled(next==='walk');player.setOverview(next!=='walk');
 $('reticle').hidden=next!=='walk';$('touch-walk').hidden=next!=='walk'||!mobile;$('walk-build').hidden=next!=='walk';
 $('mode-view').innerHTML=`<i data-lucide="${next==='walk'?'map':'footprints'}"></i>`;
 $('mode-view').title=next==='walk'?'返回布置视角':'走进现场';$('mode-view').setAttribute('aria-label',$('mode-view').title);
 document.body.classList.toggle('walk',next==='walk');icons();
 if(next==='walk'){if(firstWalk){const upstream=World.pointAt('main',.67);player.lookAt(upstream.x,upstream.y+4,upstream.z);firstWalk=false;}player.tick(.016);if(!mobile)player.enter();toast('已走进现场；随时返回地图布置。');}
 else cameraPose();
}
function updateStore(){
 objects.sync(store.items);player.ensureClearOfDams(store.items);stage.setWaterLayout(store.items);effects.setLayout(store.items);
 $('budget').textContent=store.mode==='free'?`∞ · ${store.cost}`:String(campaign.remaining);
 $('undo').disabled=!store.undoStack.length||mission.phase==='wave';
 $('mode').value=store.mode;closeFacility();clearCandidate();syncWorld();
}
function setTool(next){
 if(!editable())return;tool=next;moving=null;closeFacility();clearCandidate();
 $('results').hidden=true;
 for(const type of ['dam','vegetation','clean','field'])$(`tool-${type}`).classList.toggle('active',next===type);
 $('new-level').hidden=next!=='dam';$('rotate').hidden=next!=='vegetation';
 $('field-project').hidden=next!=='field';
 $('gesture-note').textContent=next==='dam'?'跨两岸拖一面墙，也可点河道预览':next==='vegetation'?'沿裸坡拖出草带，费用随长度变化':next==='clean'?'选择有泥土的墙，查看容量与清理代价':'把留下的泥土，用到村口田埂';
 if(next==='field'){moveView('village');updateField();}
}
function updateField(){
 const built=campaign.state.field.built;
 $('field-description').textContent=built?'田埂已修好。你留下的土，成为村庄的一部分。':'从墙前清理出泥土，修好这块田的石土边界。';
 $('build-field').disabled=built||campaign.state.soil<6||mission.phase==='wave';
 $('build-field').innerHTML=`<i data-lucide="${built?'check':'hammer'}"></i>${built?'田埂已建成':'用6份留土修田埂'}`;icons();
}
function previewAt(point){
 if(!editable())return;
 closeFacility();aimPoint={x:point.x,z:point.z};
 const current=moving?store.items.find(s=>s.id===moving):null,kind=current?.type??tool,c=World.channelAt(point.x,point.z);
 if(!['dam','vegetation'].includes(kind))return;
 candidate=kind==='dam'?{id:moving||`s${uid+1}`,type:'dam',channel:c.id,t:c.t,level:current?.level??level,x:c.x,z:c.z}:
  {id:moving||`s${uid+1}`,type:'vegetation',x:point.x,z:point.z,rotation:current?.rotation??rotation,radius:5,
   halfLength:current?.halfLength??5,halfWidth:current?.halfWidth??2.5};
 validity=kind==='dam'&&c.distance>5?{ok:false,reason:'墙要横在河道里，点一下河底。'}:
  placementCheck(candidate);
 renderCandidate();
}
function placementCheck(s){
 if(s.type==='dam'&&s.channel==='main'&&s.t>.84)return{ok:false,reason:'村口留出流水与通行走廊，请往上游建墙'};
 const v=validatePlacement(s,store.items.filter(a=>a.id!==moving&&a.id!==s.id),view==='walk'?player.position:null,store.mode,campaign.state.materialLimit);
 if(v.ok&&s.type==='vegetation'&&s.halfLength){
  for(let i=0;i<=8;i++){
   const along=(i/4-1)*s.halfLength,x=s.x+Math.cos(s.rotation)*along,z=s.z-Math.sin(s.rotation)*along,c=World.channelAt(x,z);
   if(c.distance<6||c.distance>32||World.slopeAt(x,z)>55*Math.PI/180)return{ok:false,reason:'整段草带应在可种植坡面，转向时也要避开沟底与陡崖'};
  }
 }
 return v;
}
function renderCandidate(){
 const kind=candidate.type;
 if(ghost){stage.scene.remove(ghost);disposePreview(ghost);}
 ghost=createPreview(candidate,validity.ok);stage.scene.add(ghost);
 $('placement').hidden=false;$('placement').classList.toggle('invalid',!validity.ok);
 $('placement-title').textContent=moving?'移到这里':kind==='dam'?`挡沙墙 · ${['矮','中','高'][candidate.level]} · ${costOf(candidate)}材料`:`草带 · ${Math.round((candidate.halfLength??5)*2)}米 · ${costOf(candidate)}材料`;
 $('placement-reason').textContent=validity.ok?(kind==='dam'?`${World.pointAt(candidate.channel,candidate.t).width+2}米横断 · 缺口通水 · 容量${[6,12,18][candidate.level]}`:`宽${(candidate.halfWidth??2.5)*2}米 · ${coveredSources(candidate)}`):plainReason(validity.reason);
 $('confirm-place').disabled=!validity.ok;
}
function coveredSources(s){
 const c=Math.cos(s.rotation),si=Math.sin(s.rotation);
 const count=World.sources.filter(p=>{const dx=p.x-s.x,dz=p.z-s.z;return((dx*c-dz*si)/(s.halfLength+6))**2+((dx*si+dz*c)/(s.halfWidth+6))**2<=1;}).length;
 return count?'靠近裸坡来沙区':'未靠近标记裸坡，减沙可能很少';
}
function plainReason(text){
 return String(text).replaceAll('植被','草带').replaceAll('准星对准沟底，避开沟口','点河道内部，别堵住村庄旁的出口').replaceAll('资源','材料').replaceAll('坝体','挡沙墙').replaceAll('相邻坝','相邻墙').replaceAll('过流空间','流水空间').replaceAll('建设6座坝','建6面墙').replaceAll('措施','工具');
}
function place(){
 if(!candidate||!editable()||!validity?.ok)return;
 const check=placementCheck(candidate);
 if(!check.ok){toast(plainReason(check.reason));return;}
 const built={...candidate,id:moving||`s${++uid}`};
 try{store.commit([...store.snapshot().filter(s=>s.id!==moving),built]);}catch(e){toast(e.message);return;}moving=null;
 updateStore();effects.feedback(built);toast(built.type==='dam'?'挡沙墙建好了。下一场雨，看看它挡住什么。':'草带种下了。它会保护脚下这片山坡。');
}
function selectFacility(id){
 clearCandidate();$('results').hidden=true;$('field-project').hidden=true;selected=id;objects.select(id);const s=store.items.find(s=>s.id===id);if(!s)return;
 $('facility').hidden=false;$('facility-title').textContent=s.type==='dam'?`${names[s.channel]} · 挡沙墙`:'山坡上的草带';
 $('facility-desc').textContent=s.type==='dam'?`占用 ${costOf(s)} 材料 · 能留下 ${[6,12,18][s.level]} 份泥沙`:'占用 2 材料 · 转动方向会改变保护的山坡';
 const cap=[6,12,18][s.level]??0,fill=s.fill??0;
 $('facility-desc').textContent=s.type==='dam'?`建材 ${costOf(s)} · ${fill>0?'墙前的泥土会留到下一场雨':'留出低口，让水继续走'}`:`建材 ${costOf(s)} · 长${Math.round(2*(s.halfLength??5))}米 · 只保护覆盖的坡面`;
 $('capacity-row').hidden=s.type!=='dam';$('capacity-text').textContent=`已留土 ${fill.toFixed(1)} / ${cap} · 还能装 ${Math.max(0,cap-fill).toFixed(1)}`;
 $('capacity-meter').max=cap||1;$('capacity-meter').value=fill;
 $('clean-facility').hidden=s.type!=='dam';$('clean-facility').disabled=fill<1e-6||mission.phase==='wave'||Math.ceil(fill/6-1e-9)>campaign.state.maintenance;
 $('clean-facility').querySelector('span').textContent=fill>0?`清理 ${fill.toFixed(1)}土 · ${Math.ceil(fill/6-1e-9)}整治`:'还没有沉积';
 $('replay-facility').disabled=!campaign.checkpoint||mission.phase==='wave';$('replay-facility').hidden=s.type!=='dam';
 $('facility-level').hidden=s.type!=='dam';$('rotate-facility').hidden=s.type!=='vegetation';
 $('move-facility').disabled=fill>1e-6;$('remove-facility').disabled=fill>1e-6;
 $('move-facility').title=fill>1e-6?'先清理已留下的土':'移动';$('remove-facility').title=fill>1e-6?'先清理已留下的土':'拆除';
 document.querySelectorAll('[data-level]').forEach(b=>b.classList.toggle('active',+b.dataset.level===s.level));
 if(view==='walk')player.release();
}
function liveCapacity(result,time){
 if(!selected||!result)return;
 const d=result.dams.find(d=>d.id===selected);if(!d)return;
 const fill=(d.initialFill??0)+result.events.filter(e=>e.type==='trap'&&e.structureId===d.id&&e.time<=time).reduce((v,e)=>v+e.amount,0);
 $('capacity-text').textContent=`已留土 ${fill.toFixed(1)} / ${d.capacity} · 还能装 ${Math.max(0,d.capacity-fill).toFixed(1)}`;
 $('capacity-meter').max=d.capacity;$('capacity-meter').value=fill;$('clean-facility').disabled=true;
}
function changeLevel(value){
 if(!editSelected())return;
 if(selected){
  const s=store.items.find(s=>s.id===selected);if(s?.type!=='dam')return;
  const next={...s,level:value},v=validatePlacement(next,store.items.filter(a=>a.id!==s.id),view==='walk'?player.position:null,store.mode,campaign.state.materialLimit);
  if(!v.ok){toast(plainReason(v.reason));return;}
  const id=s.id;safely(()=>{store.commit(store.items.map(a=>a.id===id?next:a));updateStore();selectFacility(id);effects.feedback(next);});
 }else{level=value;document.querySelectorAll('[data-build-level]').forEach(b=>b.classList.toggle('active',+b.dataset.buildLevel===level));if(aimPoint)previewAt(aimPoint);}
}
function groundRay(x,y,center=false){
 ray.setFromCamera(center?new T.Vector2():new T.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),stage.camera);
 ray.far=view==='walk'?8:650;pluginUsage.bvhRays++;
 return ray.intersectObject(stage.terrain,false)[0];
}
function pick(x,y,center=false){
 if($('settings').open||replay)return;
 const ground=groundRay(x,y,center);
 const hit=ray.intersectObjects(objects.root.children,true).find(h=>h.object.name!=='deposit'&&(!ground||h.distance<=ground.distance+.1));
 if(hit&&!moving){let o=hit.object;while(o&&!o.userData.structureId)o=o.parent;if(o?.userData.structureId){selectFacility(o.userData.structureId);return;}}
 if(mission.phase==='wave'||replay)return;
 if(tool==='clean'&&!moving){toast('选中一面挡沙墙，再清理墙前的土。');return;}
 if(tool==='field'&&!moving){updateField();$('field-project').hidden=false;return;}
 if(ground)previewAt(ground.point);else{clearCandidate();toast(view==='walk'?'靠近一点，再对准地面。':'点一下河道或山坡。');}
}
function beginTrial(){
 if(replay){stopReplay();return;}
 if(mission.phase==='wave'){mission.pause(!mission.paused);return;}
 if(campaign.state.phase==='aftermath'){
  campaign.advance();resetMission();setTool('dam');updateStore();moveView(campaign.scenario.view);toast('旧墙、草带与泥土都留下了。新的雨，从这里继续。');return;
 }
 if(campaign.state.phase==='complete'){$('results').hidden=true;moveView('village');toast('三场雨已过。还可以整治、修田、巡看与保存。');return;}
 clearCandidate();closeFacility();moving=null;
 let result;try{result=campaign.begin();}catch(e){toast(e.message);return;}
 mission.launch(result,store.cost,store.mode,campaign.scenario.limit,campaign.state.materialLimit);saveWorld();importEpoch++;effects.setResult(result);seenTraps.clear();lastEvent=0;resultShown=false;
 document.body.classList.add('running');$('results').hidden=true;$('wave-status').hidden=false;
 $('trial').innerHTML='<i data-lucide="cloud-rain"></i><span>暴雨进行中</span>';$('trial').disabled=true;$('ready').hidden=true;icons();
 $('field-project').hidden=true;banner(`${campaign.scenario.title}到了。看泥水从哪片坡上下来。`);effects.feedback({x:0,z:40,type:'dam'});syncWorld();
}
function rebuild(){
 if(mission.phase==='wave')return;
 $('results').hidden=true;closeFacility();clearCandidate();setTool('clean');toast('看看墙前的土；清出空间，或者留下来修田埂。');
}
function resetMission(){
 mission.rebuild();mission.round=campaign.state.round+1;
 importEpoch++;effects.setResult(null);stage.setTrialState?.(null,0,{phase:'prepare'});resultShown=campaign.state.phase!=='prepare';
 document.body.classList.remove('running');$('results').hidden=true;$('wave-status').hidden=true;$('ready').hidden=false;
 $('ready').innerHTML='<i data-lucide="timer"></i>开始准备计时';
 $('home-state').textContent='等待你的保护';$('home-meter-fill').style.width='100%';$('home-meter-fill').style.background='#8fd3a5';
 updateStore();icons();
}
function showResult(){
 resultShown=true;const r=mission.result,o=mission.outcome;campaign.settle();closeFacility();syncWorld();objects.sync(store.items);
 document.body.classList.remove('running');$('wave-status').hidden=true;$('results').hidden=false;$('results').classList.toggle('lost',!o.won);
 $('result-title').textContent=o.won?'田与路，留下来了。':'田路边积了太多泥土。';
 $('result-kicker').textContent=`${campaign.scenario.title} · ${campaign.state.phase==='complete'?'三场雨走完了':'雨后，接着营造'}`;
 const fullest=[...r.dams].sort((a,b)=>(b.initialFill+b.trapped)/b.capacity-(a.initialFill+a.trapped)/a.capacity)[0];
 $('result-description').textContent=o.won?'泥沙在墙前落下，水继续往下走。清理一点留土，给村口修一道田埂。':
  fullest&&fullest.initialFill+fullest.trapped>fullest.capacity*.95?'墙已装满，后来的泥土越过了它。雨后清理、在上游分担，或回到雨前换一条路线。':'来沙绕过了你的保护。看看高来沙裸坡，换一个位置，或回到雨前再试。';
 $('cause-in').textContent=String(r.baseline);
 $('cause-trapped').textContent=r.trapped.toFixed(1);
 $('cause-exported').textContent=`${r.exported.toFixed(1)} / ${campaign.scenario.limit}`;
 const fullestAmount=fullest?fullest.initialFill+fullest.trapped:0;
 const weakest=[...r.sources].sort((a,b)=>b.produced-a.produced)[0];
 $('cause-note').textContent=fullest?
  `${names[fullest.channel]}的墙装了 ${fullestAmount.toFixed(1)} / ${fullest.capacity}${fullestAmount>=fullest.capacity*.95?'，已经装满':'，还有余量'}。最重来沙：${weakest?.id??'—'}。`:
  `最重来沙：${weakest?.id??'—'}；这场没有墙留下泥沙。`;
 $('stars').innerHTML=[0,1,2].map(i=>`<i data-lucide="star" class="${i<o.stars?'earned':'empty'}"></i>`).join('');
 $('stars').setAttribute('aria-label',`${o.stars}颗星`);
 $('saved').textContent=r.trapped.toFixed(1);$('avoided').textContent=r.prevented.toFixed(1);
 $('comparison').textContent=`本场来沙 ${r.baseline} · 到田路边 ${r.exported.toFixed(1)} / ${campaign.scenario.limit} 守护线。墙前已有的土会留到下一场。`;
 $('home-state').textContent=o.won?'田路已守住':'田路边仍有积土';$('home-meter-fill').style.width=`${campaign.state.field.integrity}%`;$('home-meter-fill').style.background=o.won?'#8fd3a5':'#df875e';
 $('replay').disabled=!r.events.some(e=>e.type==='trap');
 icons();if(view==='walk')player.release();banner(o.won?'留住了泥土，也留下了下一步。':'雨停了。调整布局，或者回到雨前再试。');
}
function updateMissionUI(){
 const wave=mission.phase==='wave',done=['aftermath','complete'].includes(campaign.state.phase),value=done?'—':wave?String(Math.max(0,Math.ceil(mission.result.duration-mission.time))):String(Math.ceil(mission.remaining));
 $('round-label').textContent=`${String(campaign.state.round+1).padStart(2,'0')} / 03 · ${campaign.scenario.title}`;
 $('phase-label').textContent=replay?'回看来水':done?'雨后整治':wave?'泥水来袭':mission.paused?'准备暂停':'雨来之前';
 $('mission-title').textContent=wave?'泥土正在经过你的建设。':done?(campaign.state.phase==='complete'?'这是你改变的沟谷。':'把留下的土，用起来。'):campaign.scenario.targetText;
 $('mission-note').textContent=wave?'看墙前的泥土落下，再看墙后的水色。':done?'选墙清理腾出容量，留土修田；准备好再迎下一场。':campaign.scenario.forecast;
 if(lastClock!==value){lastClock=value;$('countdown').textContent=value;}
 $('clock-unit').textContent=done?'世界已保留':wave?'秒来袭':'秒 · 可从容营造';
 $('mission').classList.toggle('counting',mission.active);$('mission').classList.toggle('danger',wave||mission.active&&mission.remaining<15);
 const readyLabel=!mission.active?'开始准备计时':mission.paused?'继续准备':'暂停准备';
 if(lastReady!==readyLabel){
  lastReady=readyLabel;$('ready').innerHTML=`<i data-lucide="${!mission.active?'flag':mission.paused?'play':'pause'}"></i>${readyLabel}`;icons();
 }
 if(wave){$('wave-seconds').textContent=`${Math.floor(mission.time)} / ${mission.result.duration}`;$('wave-progress').max=mission.result.duration;$('wave-progress').value=mission.time;
  $('wave-message').textContent=mission.paused?'暴雨已暂停':mission.time<8?'泥水从山坡冲下来':mission.time<24?'墙前留沙，观察下游水色':'余沙正在抵达村口';
  const l=ledgerAt(mission.result,mission.time),health=Math.round(clamp(100-Math.max(0,l.exported-30)*1.1,0,100));
  $('home-state').textContent=mission.time<12?'泥水正在接近':l.exported>campaign.scenario.limit?'田路边积土':'田路还在守护线内';$('home-meter-fill').style.width=`${health}%`;
  if(lastPause!==mission.paused){lastPause=mission.paused;$('pause').innerHTML=`<i data-lucide="${mission.paused?'play':'pause'}"></i>`;$('pause').title=mission.paused?'继续':'暂停';$('pause').setAttribute('aria-label',$('pause').title);icons();}
 }
 if(replay){
  $('wave-status').hidden=false;$('wave-message').textContent='回看：来沙 → 墙前落土 → 余流向下';
  $('wave-seconds').textContent=`${(replay.time-replay.start).toFixed(1)} / ${(replay.end-replay.start).toFixed(1)}秒`;
  $('wave-progress').max=replay.end-replay.start;$('wave-progress').value=replay.time-replay.start;
  if(lastPause!==replay.paused){lastPause=replay.paused;$('pause').innerHTML=`<i data-lucide="${replay.paused?'play':'pause'}"></i>`;$('pause').title=replay.paused?'继续回看':'暂停回看';$('pause').setAttribute('aria-label',$('pause').title);icons();}
 }
}
function replayPose(p){
 let best=null;
 for(const elevation of [.62,.82,1.02])for(const offset of [-.8,.8,-1.5,1.5,2.8]){
  const azimuth=p.angle+offset,distance=38,h=Math.cos(elevation)*distance;
  const eye={x:p.x+Math.sin(azimuth)*h,y:p.y+1+Math.sin(elevation)*distance,z:p.z+Math.cos(azimuth)*h};
  eye.y=Math.max(eye.y,World.heightAt(eye.x,eye.z)+4);
  let score=elevation*.1;
  for(const [side,along] of [[-3,0],[0,0],[3,0],[0,-6],[0,6]]){
   const target={x:p.x+Math.cos(p.angle)*side+Math.sin(p.angle)*along,y:p.y+1,z:p.z-Math.sin(p.angle)*side+Math.cos(p.angle)*along};
   for(let i=2;i<19;i++){
    const u=i/20,x=eye.x*(1-u)+target.x*u,z=eye.z*(1-u)+target.z*u,y=eye.y*(1-u)+target.y*u;
    if(World.heightAt(x,z)>y-.25)score+=20;
    for(const tree of stage.landscape.trees){
     const crown=tree.y+[8.2,5.9,4.7][tree.species]*tree.scale*.65;
     if(Math.hypot(x-tree.x,z-tree.z)<4*tree.scale&&Math.abs(y-crown)<4.3*tree.scale)score+=1;
    }
   }
  }
  if(!best||score<best.score)best={x:p.x,y:p.y+1,z:p.z,distance,elevation,azimuth,score};
 }
 return best;
}
function startReplay(id=null){
 if(mission.phase==='wave')return;
 if(!campaign.checkpoint){toast('先迎一场雨，再回看它留下的变化。');return;}
 let r=mission.result;
 if(!r){const s=campaign.scenario,cp=campaign.checkpoint;
  r=runSimulation({structures:cp.structures},World.sources.map(p=>({...p,weight:s.sourceWeights[p.id]})),s.seed,
   {baseline:s.baseline,initialFill:Object.fromEntries(cp.structures.filter(p=>p.type==='dam').map(p=>[p.id,p.fill??0]))});
 }
 const moments=new Map();
 for(const event of r.events){
  if(event.type!=='trap'||id&&event.structureId!==id)continue;
  const key=`${event.structureId}:${Math.floor(event.time/2)}`,moment=moments.get(key)??{event,amount:0};
  moment.amount+=event.amount;moments.set(key,moment);
 }
 const event=[...moments.values()].sort((a,b)=>b.amount-a.amount)[0]?.event;
 if(!event){toast('这面墙在这场雨中没有拦到泥沙，看看来沙是否经过它。');return;}
 const d=r.dams.find(d=>d.id===event.structureId),p=World.pointAt(d.channel,d.t);
 if(view!=='command')setView('command');
 cameraTween?.stop();const {score,...pose}=replayPose(p);
 cameraTween=new P.TWEEN.Tween(orbit,animations).to(pose,650).easing(P.TWEEN.Easing.Cubic.InOut).start(performance.now());
 clearCandidate();closeFacility();$('results').hidden=true;$('field-project').hidden=true;
 const recorded=campaign.checkpoint.structures;
 objects.sync(recorded);stage.setWaterLayout(recorded);effects.setLayout(recorded);
 aftermath.sync(campaign.checkpoint,campaign.scenario,recorded);aftermath.setGauges(hints);stage.setWorldState?.(campaign.checkpoint);
 const start=Math.max(0,Math.floor(event.time/2)*2-2);replay={result:r,start,end:Math.min(r.duration,start+8),time:start,paused:false};
 effects.setResult(r);document.body.classList.add('replaying');$('trial').disabled=false;
 $('checkpoint').hidden=true;
 $('trial').innerHTML='<i data-lucide="square"></i><span>结束回看</span>';icons();banner('回到这一刻：泥土留下，水继续走。');
}
function stopReplay(){
 replay=null;effects.setResult(null);effects.setLayout(store.items);objects.sync(store.items);stage.setWaterLayout(store.items);document.body.classList.remove('replaying');
 $('wave-status').hidden=true;const id=selected;syncWorld();if(id)selectFacility(id);
}
function replaceWorld(next){
 if(mission.phase==='wave')throw Error('雨后再载入世界');
 stopReplay();campaign=next;resetMission();setTool('dam');updateStore();moveView(campaign.scenario.view);
 toast('世界已载入。设施、泥土、田埂和雨序都在。');
}
function strokePreview(end){
 if(!stroke||!end)return;
 const a=stroke.start,b=end,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
 previewAt({x:(a.x+b.x)/2,z:(a.z+b.z)/2});
 if(!candidate)return;
 if(tool==='vegetation'){
  candidate.halfLength=clamp(Math.round(length)/2,2.5,15);candidate.halfWidth=2.5;candidate.rotation=Math.atan2(-dz,dx);
  validity=placementCheck(candidate);
  if(length>30)validity={ok:false,reason:'一次草带最长30米，分两段营造'};
  for(let i=0;i<=8&&validity.ok;i++){
   const x=a.x+dx*i/8,z=a.z+dz*i/8,c=World.channelAt(x,z);
   if(c.distance<6||c.distance>32||World.slopeAt(x,z)>55*Math.PI/180)validity={ok:false,reason:'整段草带都应落在可种植坡面，避开沟底和陡崖'};
  }
 }else{
  const p=World.pointAt(candidate.channel,candidate.t),side=q=>Math.cos(p.angle)*(q.x-p.x)-Math.sin(p.angle)*(q.z-p.z);
  if(side(a)*side(b)>=0||Math.abs(side(a))<p.width/2||Math.abs(side(b))<p.width/2)
   validity={ok:false,reason:'从一侧岸拖到对岸，预览会吸附成横断墙'};
  if(length>28)validity={ok:false,reason:'跨岸范围太长，请靠近一段河道'};
 }
 renderCandidate();
}
function bind(){
 window.addEventListener('pointerdown',()=>soundscape.unlock(),{once:true});
 window.addEventListener('keydown',()=>soundscape.unlock(),{once:true});
 window.addEventListener('pagehide',()=>soundscape.dispose(),{once:true});
 $('ready').onclick=()=>{if(!mission.active)mission.ready();else mission.pause(!mission.paused);$('ready').innerHTML=`<i data-lucide="${mission.paused?'play':'pause'}"></i>${mission.paused?'继续准备':'暂停准备'}`;icons();};
 $('trial').onclick=()=>safely(beginTrial);$('rebuild').onclick=rebuild;$('pause').onclick=()=>{if(replay)replay.paused=!replay.paused;else mission.pause(!mission.paused);};
 $('tool-dam').onclick=()=>setTool('dam');$('tool-vegetation').onclick=()=>setTool('vegetation');
 $('tool-clean').onclick=()=>setTool('clean');$('tool-field').onclick=()=>setTool('field');$('close-project').onclick=()=>$('field-project').hidden=true;
 $('build-field').onclick=()=>safely(()=>{campaign.restoreField();syncWorld();updateField();$('field-project').hidden=true;effects.feedback({...aftermath.fieldPoint,type:'dam'});banner('墙前留下的土，修好了村口的田埂。');});
 $('clean-facility').onclick=()=>safely(()=>{
  const id=selected,item=store.items.find(s=>s.id===id),done=campaign.clean(id);
  effects.setResult(null);updateStore();selectFacility(id);effects.feedback(item);toast(`清出${done.amount.toFixed(1)}份土，恢复同样容量；消耗${done.cost}份整治。`);
 });
 $('replay-facility').onclick=()=>startReplay(selected);$('replay').onclick=()=>startReplay();
 $('retry').onclick=()=>safely(()=>{campaign.retry();resetMission();setTool('dam');toast('回到了这场雨之前。资源与历史一并恢复。');});$('checkpoint').onclick=()=>$('retry').click();
 $('hints').onclick=()=>{hints=!hints;aftermath.setHints(hints);aftermath.setGauges(hints);$('hints').classList.toggle('active',hints);};
 $('rotate').onclick=()=>{
  if(candidate?.type==='vegetation'){candidate.rotation+=Math.PI/6;rotation=candidate.rotation;validity=placementCheck(candidate);renderCandidate();}
  else rotation+=Math.PI/6;
 };
 $('confirm-place').onclick=place;$('cancel-place').onclick=()=>{moving=null;clearCandidate();};
 $('close-facility').onclick=closeFacility;$('close-results').onclick=()=>$('results').hidden=true;
 document.querySelectorAll('[data-build-level]').forEach(b=>b.onclick=()=>changeLevel(+b.dataset.buildLevel));
 document.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>changeLevel(+b.dataset.level));
 $('rotate-facility').onclick=()=>{if(!editSelected())return;const s=store.items.find(a=>a.id===selected);if(!s)return;
  const next={...s,rotation:(s.rotation??0)+Math.PI/6},v=placementCheck(next);if(!v.ok){toast(v.reason);return;}store.commit(store.items.map(a=>a.id===s.id?next:a));updateStore();selectFacility(s.id);};
 $('move-facility').onclick=()=>{if(!editSelected())return;moving=selected;closeFacility();toast('点一下新的位置，再确认。');};
 $('remove-facility').onclick=()=>{if(!editSelected())return;safely(()=>{store.commit(store.items.filter(s=>s.id!==selected));updateStore();toast('已拆除，材料回到工具箱。');});};
 $('undo').onclick=()=>{if(editable()&&store.undo())updateStore();};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>moveView(b.dataset.view));
 $('zoom-in').onclick=()=>{orbit.distance=clamp(orbit.distance*.82,24,160);cameraTween?.stop();cameraPose();};
 $('zoom-out').onclick=()=>{orbit.distance=clamp(orbit.distance*1.2,24,160);cameraTween?.stop();cameraPose();};
 $('mode-view').onclick=()=>setView(view==='walk'?'command':'walk');
 $('aim-build').onclick=()=>pick(0,0,true);$('walk-select').onclick=()=>pick(0,0,true);
 $('menu').onclick=()=>{pausedBeforeMenu=mission.paused;mission.pause(true);player.setEnabled(false);$('settings').showModal();};
 $('close-settings').onclick=()=>$('settings').close();$('settings').addEventListener('close',()=>{mission.pause(pausedBeforeMenu);player.setEnabled(view==='walk');});
 $('quality').onchange=()=>stage.setQuality($('quality').value);$('audio').onchange=()=>{effects.setAudio($('audio').checked);soundscape.setEnabled($('audio').checked);if($('audio').checked)soundscape.unlock();};
 $('reduced').onchange=()=>{document.body.classList.toggle('reduced',$('reduced').checked);effects.setReduced($('reduced').checked);if($('reduced').checked)cameraTween?.stop();};
 $('mode').onchange=()=>{const requested=$('mode').value;if(!editable()){$('mode').value=store.mode;return;}safely(()=>{store.commit(store.snapshot(),requested);updateStore();});$('mode').value=store.mode;};
 $('reset-layout').onclick=()=>{if(editable())safely(()=>{store.commit([]);updateStore();toast('已拆除全部，可以撤销。');});};
 $('new-world').onclick=()=>safely(()=>{if(!editable())return;const backed=backupWorld();replaceWorld(new Campaign());if(!backed)toast('新沟已开始；本机备份不可用，请用文件保存世界。');});
 $('restore-backup').onclick=()=>safely(()=>{if(!editable())return;const text=localStorage.getItem(BACKUP_KEY);if(!text)throw Error('还没有上次备份');const next=new Campaign(parseWorldSave(text));localStorage.setItem(BACKUP_KEY,campaign.export());replaceWorld(next);});
 $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([store.export()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='坝系_生态营造_世界.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('import').onclick=()=>{if(mission.phase!=='wave')$('import-file').click();else toast('这场雨结束后再载入。');};
 $('import-file').onchange=async e=>{try{
  const file=e.target.files[0];if(!file)return;if(file.size>250000)throw Error('文件太大');const epoch=importEpoch,text=await file.text(),data=JSON.parse(text);
  if(epoch!==importEpoch||!editable())return;
  let next;if(data.version===1){const old=parseSave(text);next=new Campaign();next.setLayout(old.structures,old.mode);}
  else next=new Campaign(parseWorldSave(text));
  const backed=backupWorld();replaceWorld(next);if(!backed)toast('文件已载入；本机备份不可用，仍可保存世界文件。');
 }catch(error){toast(`没有载入：${plainReason(error.message)}`);}finally{e.target.value='';}};
 canvas.addEventListener('pointerdown',e=>{
  if($('settings').open)return;try{canvas.setPointerCapture(e.pointerId);}catch{}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===1){drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,moved:false};pinching=false;
   const ground=e.button===0&&view==='command'&&['dam','vegetation'].includes(tool)&&!moving&&mission.phase!=='wave'&&!replay?groundRay(e.clientX,e.clientY):null;
   stroke=ground?{start:{x:ground.point.x,z:ground.point.z}}:null;
  }
  else{pinching=true;dragIgnoreUntil=performance.now()+300;drag=null;}
 });
 canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  const before=[...pointers.values()],oldDistance=before.length===2?Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y):0;
  const prior=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2&&view==='command'){
   const now=[...pointers.values()],distance=Math.hypot(now[0].x-now[1].x,now[0].y-now[1].y);
   if(oldDistance&&distance){cameraTween?.stop();orbit.distance=clamp(orbit.distance*oldDistance/distance,24,160);cameraPose();}return;
  }
  if(!drag||drag.id!==e.pointerId)return;
  if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>7)drag.moved=true;
  if(drag.moved){
   if(stroke){cameraTween?.stop();const ground=groundRay(e.clientX,e.clientY);if(ground)strokePreview(ground.point);}
   else if(view==='command'){cameraTween?.stop();orbit.azimuth-=(e.clientX-prior.x)*.006;orbit.elevation=clamp(orbit.elevation+(e.clientY-prior.y)*.005,.36,1.35);cameraPose();}
   else if(mobile)player.lookDelta(e.clientX-prior.x,e.clientY-prior.y);
  }
 });
 canvas.addEventListener('pointerup',e=>{
  const tap=drag?.id===e.pointerId&&!drag.moved&&!pinching&&performance.now()>dragIgnoreUntil;
  pointers.delete(e.pointerId);drag=null;stroke=null;if(pointers.size===0)pinching=false;
  if(tap){if(view==='command')pick(e.clientX,e.clientY);else if(mobile)pick(0,0,true);else if(!player.locked&&!player.fallback)player.enter();else pick(0,0,true);}
 });
 canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);drag=null;stroke=null;pinching=false;});
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('wheel',e=>{e.preventDefault();if(view==='command'){cameraTween?.stop();orbit.distance=clamp(orbit.distance*Math.exp(e.deltaY*.001),24,160);cameraPose();}else changeLevel(clamp(level+(e.deltaY<0?1:-1),0,2));},{passive:false});
 document.querySelectorAll('[data-walk]').forEach(b=>{
  b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);player.setTouchKey(b.dataset.walk,true);};
  b.onpointerup=b.onpointercancel=()=>player.setTouchKey(b.dataset.walk,false);
 });
 window.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea')||$('settings').open||e.repeat)return;
  if(e.code==='Digit1')setTool('dam');if(e.code==='Digit2')setTool('vegetation');if(e.code==='Digit3')setTool('clean');if(e.code==='Digit4')setTool('field');
  if(e.code==='KeyR')beginTrial();
  if(e.code==='Space'){e.preventDefault();if(replay)replay.paused=!replay.paused;else mission.pause(!mission.paused);}
  if(e.code==='Tab'){e.preventDefault();setView(view==='walk'?'command':'walk');}
  if(e.code==='Escape'){player.release();clearCandidate();moving=null;closeFacility();mission.pause(true);}
  if(e.code==='KeyE'&&view==='walk')pick(0,0,true);
  if(e.ctrlKey&&e.code==='KeyZ'){e.preventDefault();$('undo').click();}
 });
 const pauseOnLeave=()=>{if(mission.active){mission.pause(true);if($('settings').open)pausedBeforeMenu=true;}};
 window.addEventListener('blur',pauseOnLeave);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseOnLeave();});
}
function heroPose(pose={}){
 const eye=pose.eye??{x:20,y:16,z:50},target=pose.target??{x:20,y:4,z:29};
 view='cinema';cameraTween?.stop();
 stage.camera.fov=pose.fov??55;stage.camera.updateProjectionMatrix();
 stage.camera.position.set(eye.x,Math.max(eye.y,World.heightAt(eye.x,eye.z)+7),eye.z);
 stage.camera.lookAt(target.x,target.y,target.z);
}
function prepareHero(){
 if(mission.phase==='wave')return false;
 closeFacility();clearCandidate();setView('command');
 const items=[];
 for(const [id,channel,t] of [['hero-west-1','west',.34],['hero-west-2','west',.56],['hero-main','main',.70]]){
  const p=World.pointAt(channel,t);
  items.push({id,type:'dam',channel,t,level:2,x:p.x,z:p.z});
 }
 try{store.commit(items,'challenge');}catch(error){toast(plainReason(error.message));return false;}
 updateStore();beginTrial();mission.paused=true;mission.time=0;
 document.body.classList.add('cinema','running');stage.landscape.setTreesVisible(false);effects.setLabelsVisible(false);heroPose();
 return true;
}
function heroTime(t){
 if(mission.phase!=='wave')return false;
 mission.paused=true;
 mission.time=clamp(t,0,mission.result?.duration??35);
 return true;
}
function endHero(){
 document.body.classList.remove('cinema');
 stage.landscape.setTreesVisible(true);
 effects.setLabelsVisible(true);
 mission.paused=false;
 view='command';stage.camera.fov=52;stage.camera.updateProjectionMatrix();
 moveView('village');
}
async function init(){
 try{
  T.BufferGeometry.prototype.computeBoundsTree=P.computeBoundsTree;T.BufferGeometry.prototype.disposeBoundsTree=P.disposeBoundsTree;T.Mesh.prototype.raycast=P.acceleratedRaycast;
  stage=createScene(canvas);stage.terrain.geometry.computeBoundsTree();
  player=await createPlayer(stage.camera,canvas,stage.grid,state=>{if(state==='blur')mission.pause(true);});
  objects=structureRenderer(stage.scene,player);effects=createEffects(stage.scene,stage.label,stage.camera);aftermath=createAftermath(stage.scene,World);bind();icons();
  player.setEnabled(false);player.setOverview(true);document.body.classList.toggle('mobile',mobile);
  if(mobile){stage.setQuality('low');$('quality').value='low';}
  resetMission();moveView('village');cameraPose();$('loading').hidden=true;
  if(saveError)toast(`旧自动存档未载入：${saveError}`);else if(store.items.length)toast('回来了。你改变过的沟谷还在这里。');
  window.BAXI={World,store,stage,player,objects,effects,mission,beginTrial,rebuild,setView,moveView,parseSave,hero:{prepare:prepareHero,pose:heroPose,time:heroTime,end:endHero},
   get campaign(){return campaign;},get aftermath(){return aftermath;},soundscape,
   get status(){return{view,mobile,tool,level,candidate,validity,selected,moving,phase:mission.phase,worldPhase:campaign.state.phase,round:campaign.state.round,replay:replay?{time:replay.time,start:replay.start,end:replay.end}:null,time:mission.time,paused:mission.paused,cost:store.cost,pluginUsage:{...pluginUsage}};},
   get ledger(){return mission.result?ledgerAt(mission.result,mission.time):null;}
  };
  requestAnimationFrame(frame);
 }catch(error){console.error(error);$('loading-detail').textContent=error.message;$('loading').querySelector('strong').textContent='山谷载入遇到问题';}
}
function frame(stamp){
 const dt=clamp((stamp-last)/1000,0,.08);last=stamp;
 animations.update(stamp);if(view==='command')cameraPose();else if(view==='walk')player.tick(dt);
 if(!replay)mission.tick(dt);if(mission.phase==='due')beginTrial();
 if(replay&&!replay.paused){replay.time=Math.min(replay.end,replay.time+dt);if(replay.time>=replay.end)stopReplay();}
 const activeResult=replay?.result??(mission.phase==='wave'?mission.result:null),visualTime=replay?.time??mission.time;
 effects.tick(visualTime,replay?.paused||mission.paused?0:dt);objects.animate(activeResult,visualTime);aftermath.tick(stamp/1000);
 liveCapacity(activeResult,visualTime);
 stage.setTrialState?.(activeResult,visualTime,{phase:replay?'wave':mission.phase,reduced:$('reduced').checked});
 soundscape.update({phase:mission.phase==='result'?campaign.state.phase:mission.phase,time:replay?.time??(activeResult?mission.time:stamp/1000),paused:replay?.paused??mission.paused,replay:!!replay,reduced:$('reduced').checked});
 if(mission.result&&mission.phase==='wave'){
  for(const event of mission.result.events){
   if(event.time>mission.time||event.time<=lastEvent||event.type!=='trap'||seenTraps.has(event.structureId))continue;
   seenTraps.add(event.structureId);banner('挡住了！泥沙留在墙前，下游正在变清。');
  }
  lastEvent=mission.time;
 }
 if(mission.phase==='result'&&!resultShown){showResult();effects.setResult(null);effects.setLayout(store.items);}
 updateMissionUI();
 if(stamp>toastEnd)$('toast').classList.remove('show');if(stamp>eventEnd)$('event-banner').classList.remove('show');
 stage.render(stamp/1000,!!replay||mission.phase==='wave'&&!mission.paused);requestAnimationFrame(frame);
}
init();
