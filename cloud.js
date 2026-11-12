import {CLOUD_CONFIG} from './cloud-config.js?v=2.9.0';
import {createCloudController,cloudMessage} from './cloud-controller.js?v=2.9.0';
import {createCloudUI} from './cloud-ui.js?v=2.9.0';
export function createCloud(c){
 let ui=null,controller=null,issue='',generation=0;
 async function start(){
  stop();if(!c.getDB())return;const mine=generation;
  try{
   await c.flush();if(mine!==generation||!c.getDB())return;
   let device=localStorage.getItem('my-stock-lab.cloud-device.v1');
   if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(device||'')){device=crypto.randomUUID();localStorage.setItem('my-stock-lab.cloud-device.v1',device);}
   controller=createCloudController(CLOUD_CONFIG,c,{approved:CLOUD_CONFIG.approved,device,storage:localStorage});
   ui=createCloudUI(c,controller);await ui.start();
  }catch(e){if(mine!==generation)return;issue=cloudMessage(e.code||e.message);c.render();}
 }
 function stop(forgetSession=false){
  generation++;ui?.stop();ui=null;controller=null;issue='';
  if(forgetSession){try{const device=localStorage.getItem('my-stock-lab.cloud-device.v1');if(device)localStorage.removeItem('my-stock-lab.cloud-device.v1:'+new URL(CLOUD_CONFIG.url).hostname+':'+device);}catch{issue=cloudMessage('local_storage_failed');}}
 }
 function view(){return ui?ui.view():c.panel('외부 암호화 자동 백업','<p>'+c.esc(issue||'백업 연결 준비 중')+'</p>');}
 async function handle(act,id){return ui?ui.handle(act,id):false;}
 return {start,stop,view,handle,state:()=>controller?.snapshot()||null};
}
