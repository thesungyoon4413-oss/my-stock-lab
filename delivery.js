// One-way report delivery. Only the recipient's public key leaves the vault.
const FORMAT='MY-STOCK-LAB-SEALED-REPORT',enc=new TextEncoder(),dec=new TextDecoder();
const str=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function bytes(s,max){if(typeof s!=='string'||s.length>max||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('암호문 인코딩 오류');return Uint8Array.from(atob(s),x=>x.charCodeAt(0));}
const url64=s=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s);
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function validatePublicKey(key){if(!key||key.kty!=='RSA'||key.e!=='AQAB'||!url64(key.n)||key.n.length!==512||['d','p','q','dp','dq','qi','oth'].some(k=>key[k]!==undefined))throw Error('RSA 3072 공개키 형식 오류');return {kty:'RSA',n:key.n,e:key.e,alg:'RSA-OAEP-256',ext:true,key_ops:['encrypt']};}
export async function keyId(key){const k=validatePublicKey(key);return digest(JSON.stringify([k.kty,k.n,k.e]));}
export async function newInbox(){
 const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
 const publicKey=validatePublicKey(await crypto.subtle.exportKey('jwk',pair.publicKey)),privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);
 return {version:1,enabled:true,kid:await keyId(publicKey),publicKey,privateKey,lastChecked:'',lastReceived:'',error:''};
}
export function validateInbox(inbox){
 if(inbox===undefined)return;
 const key=validatePublicKey(inbox.publicKey),p=inbox.privateKey;
 if(inbox.version!==1||typeof inbox.enabled!=='boolean'||!hex(inbox.kid)||!p||p.kty!=='RSA'||p.n!==key.n||p.e!==key.e||!['d','p','q','dp','dq','qi'].every(k=>url64(p[k]))||!['lastChecked','lastReceived','error'].every(k=>typeof inbox[k]==='string'&&inbox[k].length<2000))throw Error('자동 수신함 설정 오류');
}
export function connectionCode(inbox){validateInbox(inbox);return 'MSL1.'+b64(enc.encode(JSON.stringify({format:'MY-STOCK-LAB-RECIPIENT',version:1,kid:inbox.kid,publicKey:inbox.publicKey})));}
export async function readRecipient(raw){
 const value=typeof raw==='string'?JSON.parse(raw.startsWith('MSL1.')?dec.decode(bytes(raw.slice(5),5000)):raw):raw;
 if(value?.format!=='MY-STOCK-LAB-RECIPIENT'||value.version!==1||value.kid!==await keyId(value.publicKey))throw Error('받는 사람 공개 연결 코드 오류');
 return {format:value.format,version:1,kid:value.kid,publicKey:validatePublicKey(value.publicKey)};
}
export function validatePayload(raw){
 const r=raw?.report;
 if(raw?.version!==1||!str(raw.deliveryId,300)||!r||!['KR','US'].includes(r.market)||!date(r.date)||r.date>today()||!str(r.title,300)||!str(r.body,200000)||!str(r.source,1000)||!str(r.created,100)||!Number.isFinite(Date.parse(r.created)))throw Error('수신 보고서 형식·기준일 오류');
 if(r.originalChatUrl!==undefined&&!/^https:\/\/chatgpt\.com\/c\/[a-f0-9-]{36}$/.test(r.originalChatUrl))throw Error('원본 채팅 링크 오류');
 return {version:1,deliveryId:raw.deliveryId,report:{...(r.originalChatUrl?{originalChatUrl:r.originalChatUrl}:{}),market:r.market,date:r.date,title:r.title,body:r.body,source:r.source,created:r.created}};
}
export async function sealReport(recipient,raw){
 recipient=await readRecipient(recipient);const payload=validatePayload(raw),plain=JSON.stringify(payload),id=await digest(plain),kid=recipient.kid;
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const publicKey=await crypto.subtle.importKey('jwk',recipient.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const wrappedKey=b64(new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,await crypto.subtle.exportKey('raw',key))));
 const ciphertext=b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`MSL|1|${kid}|${id}`)},key,enc.encode(plain))));
 return {format:FORMAT,version:1,kid,id,wrappedKey,iv:b64(iv),ciphertext};
}
export async function openReport(inbox,envelope){
 validateInbox(inbox);const e=envelope;
 if(e?.format!==FORMAT||e.version!==1||e.kid!==inbox.kid||!hex(e.id)||await keyId(inbox.publicKey)!==inbox.kid)throw Error('이 금고의 수신 보고서가 아닙니다');
 const wrapped=bytes(e.wrappedKey,600),iv=bytes(e.iv,30),cipher=bytes(e.ciphertext,2000000);if(wrapped.length!==384||iv.length!==12||cipher.length<16)throw Error('암호문 길이 오류');
 const key=await crypto.subtle.importKey('jwk',inbox.privateKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
 const aes=await crypto.subtle.importKey('raw',await crypto.subtle.decrypt({name:'RSA-OAEP'},key,wrapped),{name:'AES-GCM'},false,['decrypt']);
 const plain=dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(`MSL|1|${e.kid}|${e.id}`)},aes,cipher));
 const payload=validatePayload(JSON.parse(plain));if(await digest(JSON.stringify(payload))!==e.id)throw Error('보고서 내용 해시 불일치');return payload;
}
export function validateManifest(value,kid){
 if(value?.format!=='MY-STOCK-LAB-INBOX'||value.version!==1||value.kid!==kid||!Array.isArray(value.items)||value.items.length>10000||value.items.some(x=>!hex(x.id)||!hex(x.sha256))||new Set(value.items.map(x=>x.id)).size!==value.items.length)throw Error('보고서 수신 목록 오류');
 return value;
}
export function appendDelivered(db,payload,id){
 payload=validatePayload(payload);if(!hex(id))throw Error('수신 보고서 식별자 오류');
 if(db.reports.some(r=>r.deliveryDigest===id))return false;
 const corrected=db.reports.some(r=>r.deliveryId===payload.deliveryId);
 db.reports.push({...payload.report,id:crypto.randomUUID(),deliveryId:payload.deliveryId,deliveryDigest:id,receivedAt:new Date().toISOString(),source:payload.report.source+(corrected?' · 같은 실행의 수정본 (이전 기록 유지)':'')});return true;
}
export async function receiveInbox(db,{fetcher=fetch,baseURL=new URL('./',location.href),active=()=>true,now=Date.now(),force=false}={}){
 const inbox=db.inbox;if(!inbox?.enabled)return {skipped:'disabled',added:0,errors:[]};validateInbox(inbox);
 if(!force&&inbox.lastChecked&&now-Date.parse(inbox.lastChecked)<10*60000)return {skipped:'recent',added:0,errors:[]};
 const origin=new URL(baseURL);if(!['https:','http:'].includes(origin.protocol)||origin.search||origin.hash)throw Error('수신함 주소 오류');
 const get=async(path,max)=>{const response=await fetcher(new URL(path,origin),{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(15000)});if(response.status===404)return null;if(!response.ok)throw Error('수신함 응답 '+response.status);const length=Number(response.headers?.get?.('content-length'));if(length>max)throw Error('수신 파일 크기 제한');const text=await response.text();if(text.length>max)throw Error('수신 파일 크기 제한');return text;};
 const raw=await get('inbox/index.json',2000000);if(!active())return {skipped:'locked',added:0,errors:[]};inbox.lastChecked=new Date(now).toISOString();
 if(raw===null){inbox.error='연결은 준비됐지만 아직 발행된 보고서가 없습니다';return {added:0,errors:[],unpublished:true};}
 const manifest=validateManifest(JSON.parse(raw),inbox.kid),delivered=new Set(db.reports.map(r=>r.deliveryDigest).filter(Boolean)),pending=manifest.items.filter(x=>!delivered.has(x.id)).slice(0,25);let added=0;const errors=[];
 for(const item of pending){
  if(!active())return {added,errors,skipped:'locked'};
  try{const body=await get('inbox/'+item.id+'.json',2000000);if(!body||await digest(body)!==item.sha256)throw Error('보고서 파일 누락·해시 불일치');const envelope=JSON.parse(body);if(envelope.id!==item.id)throw Error('수신 파일 식별자 불일치');const payload=await openReport(inbox,envelope);if(!active())return {added,errors,skipped:'locked'};if(appendDelivered(db,payload,item.id)){added++;delivered.add(item.id);}}catch(e){errors.push('보고서 수신 실패: '+(e.name==='OperationError'?'암호문 검증 실패':e.message));}
 }
 if(added)inbox.lastReceived=new Date(now).toISOString();inbox.error=errors.slice(0,3).join('\n');return {added,errors,pending:Math.max(0,manifest.items.filter(x=>!delivered.has(x.id)).length)};
}
