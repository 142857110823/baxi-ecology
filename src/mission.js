const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function validate(result){
 const baseline=result?.baseline??100;
 if(!result||!Number.isFinite(baseline)||baseline<=0||!['exported','prevented','trapped'].every(k=>Number.isFinite(result[k])&&result[k]>=0&&result[k]<=baseline+1e-6)||
  Math.abs(result.exported+result.prevented+result.trapped-baseline)>1e-6)throw Error('来水结果无效');
}
export function assessResult(result,cost,previous=null,mode='challenge',limit=70,budget=30){
 validate(result);
 const won=result.exported<=limit+1e-6&&(mode==='free'||cost<=budget);
 return{won,stars:won?(result.exported<=limit*.57?3:result.exported<=limit*.79?2:1):0,
  health:Math.round(clamp(100-Math.max(0,result.exported-30)*1.1,0,100)),
  improvement:previous?Number((previous.exported-result.exported).toFixed(1)):null,
  retained:result.trapped,avoided:result.prevented,exported:result.exported};
}
export class Mission{
 constructor(){this.phase='prepare';this.remaining=60;this.active=false;this.paused=false;this.time=0;this.result=null;this.previous=null;this.outcome=null;this.cost=0;this.round=1;this.mode='challenge';}
 ready(){if(this.phase==='prepare'){this.active=true;this.paused=false;}}
 pause(value){this.paused=!!value;}
 launch(result,cost,mode='challenge',limit=70,budget=30){
  if(this.phase==='wave')return false;
  validate(result);this.result=structuredClone(result);this.cost=cost;this.mode=mode;this.limit=limit;this.budget=budget;
  this.phase='wave';this.time=0;this.paused=false;this.active=true;return true;
 }
 tick(dt){
  if(!Number.isFinite(dt)||dt<=0||this.paused||!this.active)return;
  if(this.phase==='prepare'){this.remaining=Math.max(0,this.remaining-dt);if(this.remaining===0)this.phase='due';}
  if(this.phase==='wave'){
   this.time=Math.min(this.result.duration??35,this.time+dt);
   if(this.time>=(this.result.duration??35)){this.phase='result';this.outcome=assessResult(this.result,this.cost,this.previous,this.mode,this.limit,this.budget);}
  }
 }
 rebuild(){
  if(this.phase==='wave')return false;
  if(this.result){this.previous=structuredClone(this.result);this.round++;}
  this.phase='prepare';this.remaining=60;this.active=false;this.time=0;this.paused=false;this.result=null;this.outcome=null;return true;
 }
}
