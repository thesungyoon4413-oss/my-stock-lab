// Same-device encrypted recovery points. This is not off-device cloud backup.
let opening,disabled=false;
const valid=e=>e?.format==='MY-STOCK-LAB-AES256'&&e.version===1&&typeof e.salt==='string'&&typeof e.iv==='string'&&typeof e.data==='string'&&e.data.length>20&&e.data.length<70000000;
function database(){
 if(!globalThis.indexedDB)return Promise.reject(Error('이 브라우저의 자동 복구점 저장소를 사용할 수 없습니다'));
 if(opening)return opening;
 opening=new Promise((resolve,reject)=>{
  const request=indexedDB.open('my-stock-lab.recovery',1);let settled=false;
  const timer=setTimeout(()=>{settled=true;opening=null;disabled=true;reject(Error('자동 복구점 저장소 시간 초과'));},5000);
  request.onupgradeneeded=()=>request.result.createObjectStore('snapshots',{keyPath:'id'});
  request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;clearTimeout(timer);request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
  request.onerror=()=>{if(settled)return;settled=true;clearTimeout(timer);opening=null;disabled=true;reject(Error('자동 복구점 저장소 오류'));};
 });return opening;
}
export function retainedRecoveries(rows){
 const sorted=rows.slice().sort((a,b)=>b.created.localeCompare(a.created));
 return [...sorted.filter(r=>r.kind==='daily').slice(0,3),...sorted.filter(r=>r.kind==='recent').slice(0,3)];
}
export async function archiveRecovery(envelope,now=new Date()){
 if(disabled||!valid(envelope))return false;
 try{
  const body=JSON.stringify(envelope),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),created=now.toISOString(),db=await database();
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),read=store.getAll();
   read.onsuccess=()=>{
    const rows=read.result,newRows=[{id:'daily-'+date,kind:'daily',created,bytes:body.length,envelope},{id:'recent-'+hash,kind:'recent',created,bytes:body.length,envelope}];
    for(const row of newRows)if(!rows.some(r=>r.id===row.id)){rows.push(row);store.put(row);}
    const keep=new Set(retainedRecoveries(rows).map(r=>r.id));for(const row of rows)if(!keep.has(row.id))store.delete(row.id);
   };
   tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(Error('자동 복구점 저장 공간 오류'));
  });return true;
 }catch{disabled=true;return false;}
}
export async function listRecoveries(){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('snapshots','readonly').objectStore('snapshots').getAll();r.onsuccess=()=>resolve(r.result.map(({id,kind,created,bytes})=>({id,kind,created,bytes})).sort((a,b)=>b.created.localeCompare(a.created)));r.onerror=()=>reject(Error('자동 복구점 조회 실패'));});}
export async function readRecovery(id){if(typeof id!=='string'||!/^daily-\d{4}-\d{2}-\d{2}$|^recent-[a-f0-9]{64}$/.test(id))throw Error('복구점 선택 오류');const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('snapshots','readonly').objectStore('snapshots').get(id);r.onsuccess=()=>{if(!valid(r.result?.envelope)){reject(Error('복구점이 없거나 형식 오류입니다'));return;}resolve(r.result);};r.onerror=()=>reject(Error('복구점 읽기 실패'));});}
