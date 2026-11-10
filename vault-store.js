// Preserve v1 local vaults; expand to IndexedDB only when the small store fills up.
import {archiveRecovery} from './recovery.js?v=2.7.0';
let latestKnown=null;
const STORE='my-stock-lab.v1',REVISION='my-stock-lab.revision';let primary=false,opening;
const legacy=()=>{try{const raw=localStorage.getItem(STORE);return raw?JSON.parse(raw):null;}catch{throw Error('기기 저장소를 읽을 수 없습니다');}};
function database(){
 if(!globalThis.indexedDB)return Promise.reject(Error('대용량 기기 저장소를 지원하지 않습니다'));
 if(opening)return opening;
 opening=new Promise((resolve,reject)=>{const request=indexedDB.open('my-stock-lab.encrypted',1);let settled=false;const timer=setTimeout(()=>{settled=true;opening=null;reject(Error('기기 저장소 열기 시간 초과'));},7000);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('vault'))request.result.createObjectStore('vault');};
  request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;clearTimeout(timer);request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  request.onerror=()=>{if(settled)return;settled=true;clearTimeout(timer);opening=null;reject(Error('대용량 기기 저장소를 열 수 없습니다'));};
 });return opening;
}
async function readPrimary(){const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('vault','readonly').objectStore('vault').get('current');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(Error('암호화 금고 읽기 실패'));});}
async function writePrimary(envelope){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('vault','readwrite');tx.objectStore('vault').put(envelope,'current');tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('암호화 금고 저장 실패 · 이전 저장본 유지'));});}
const isEnvelope=v=>v?.format==='MY-STOCK-LAB-AES256'&&v.version===1&&typeof v.data==='string';
export async function readEnvelope(){
 let value=null,problem=null;try{value=await readPrimary();}catch(e){problem=e;}
 if(value){if(!isEnvelope(value))throw Error('대용량 금고 형식 오류 · 백업을 확인하세요');primary=true;latestKnown=value;return value;}
 const old=legacy();if(old?.format==='MY-STOCK-LAB-IDB')throw problem||Error('대용량 금고를 찾을 수 없습니다 · 백업을 확인하세요');
 if(old&&!isEnvelope(old))throw Error('기존 금고 형식 오류 · 백업을 확인하세요');primary=false;latestKnown=old;return old;
}
export async function writeEnvelope(envelope){
 if(!isEnvelope(envelope))throw Error('암호화 금고 형식 오류');
 const previous=latestKnown;const recovered=async()=>{latestKnown=envelope;await archiveRecovery(previous||envelope);};
 if(!primary){try{localStorage.setItem(STORE,JSON.stringify(envelope));await recovered();return envelope;}catch{/* Expand only after an actual small-store write failure. */}}
 await writePrimary(envelope);primary=true;
 try{localStorage.setItem(STORE,JSON.stringify({format:'MY-STOCK-LAB-IDB',version:1}));localStorage.setItem(REVISION,crypto.randomUUID());}catch{/* Encrypted primary write has already committed. */}
 await recovered();return envelope;
}
