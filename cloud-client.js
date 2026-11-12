// Encrypted transport to the approved free backup project.
import {verifyActiveBackup} from './backup-ui.js?v=2.9.0';
import {validateDB} from './core.js?v=2.9.0';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
export function validateCloudConfig({url,publicKey}){
 const u=new URL(url);if(u.protocol!=='https:'||!(/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname))||u.pathname!=='/'||u.search||u.hash||u.username||u.password||u.port)throw Error('무료 프로젝트 HTTPS 주소를 확인하세요');
 if(typeof publicKey!=='string'||publicKey.startsWith('sb_secret_'))throw Error('브라우저에는 공개 키만 사용할 수 있습니다');
 if(!/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(publicKey)){
  try{const raw=JSON.parse(atob(publicKey.split('.')[1].replaceAll('-','+').replaceAll('_','/')));if(raw.role!=='anon'||raw.ref!==u.hostname.split('.')[0])throw Error();}catch{throw Error('해당 프로젝트의 anon 또는 publishable 공개 키가 필요합니다');}
 }
 return {url:u.origin,publicKey};
}
const hex=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export function createBackupClient(config,{fetcher=fetch,active=()=>true}={}){
 const c=validateCloudConfig(config);let session=null,generation=0;
 const safeError=raw=>{const key=['revision_conflict','writer_changed','not_owner','setup_incomplete','free_limit','invalid_envelope','digest_mismatch'].find(s=>String(raw?.message||'').includes(s));const e=Error(key||'cloud_request_failed');e.code=key||'cloud_request_failed';return e;};
 function acceptSession(raw){
  if(typeof raw?.access_token!=='string'||!raw.access_token||raw.access_token.length>20000||typeof raw.refresh_token!=='string'||!raw.refresh_token||raw.refresh_token.length>20000||!uuid(raw.user?.id))throw Error('cloud_login_invalid');
  const expiresAt=Number(raw.expires_at)||Math.floor(Date.now()/1000)+Math.min(Number(raw.expires_in)||3600,86400);
  if(!Number.isFinite(expiresAt)||expiresAt<=0)throw Error('cloud_login_invalid');
  session={access_token:raw.access_token,refresh_token:raw.refresh_token,userId:raw.user.id,expiresAt};
  return {userId:session.userId};
 }
 async function request(path,body,{auth=true}={}){
  const started=generation;if(!active())throw Error('vault_locked');if(auth&&!session?.access_token)throw Error('cloud_login_required');
  if(!/^\/rest\/v1\/rpc\/msl_backup_(?:status|claim|put|get)$|^\/auth\/v1\/token\?grant_type=(?:password|refresh_token)$/.test(path))throw Error('endpoint_not_allowed');
  const response=await fetcher(c.url+path,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:c.publicKey,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify(body)});
  let raw;try{raw=await response.json();}catch{throw safeError(null);}if(!active())throw Error('vault_locked');if(generation!==started)throw Error('cloud_disconnected');if(!response.ok)throw safeError(raw);return raw;
 }
 async function login(email,password){return acceptSession(await request('/auth/v1/token?grant_type=password',{email,password},{auth:false}));}
 async function refresh(){if(!session)throw Error('cloud_login_required');const raw=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token},{auth:false});if(raw.user?.id!==session.userId)throw Error('cloud_login_invalid');return acceptSession(raw);}
 const status=()=>request('/rest/v1/rpc/msl_backup_status',{});
 async function claim(expected,writer){if(!Number.isSafeInteger(expected)||expected<0||!uuid(writer))throw Error('invalid_revision_or_device');return request('/rest/v1/rpc/msl_backup_claim',{p_expected:expected,p_writer:writer});}
 async function upload({envelope,key,current,expected,writer}){
  if(!Number.isSafeInteger(expected)||expected<0||!uuid(writer))throw Error('invalid_revision_or_device');
  // Requires actual local decryption and equality with the active complete vault.
  // No vault password, CryptoKey or plaintext state goes into the HTTP request.
  await verifyActiveBackup(envelope,key,current);if(!active())throw Error('vault_locked');
  const wire=JSON.stringify(envelope);if(new TextEncoder().encode(wire).length>10000000)throw Error('free_backup_size_limit');
  return request('/rest/v1/rpc/msl_backup_put',{p_expected:expected,p_writer:writer,p_payload:wire,p_digest:await hex(wire)});
 }
 async function download(revision=null){
  if(revision!==null&&(!Number.isSafeInteger(revision)||revision<0))throw Error('invalid_revision');const row=await request('/rest/v1/rpc/msl_backup_get',{p_revision:revision});if(row===null)return null;
  if(typeof row.payload!=='string'||new TextEncoder().encode(row.payload).length>10000000||row.digest!==await hex(row.payload))throw Error('cloud_integrity_failed');
  const envelope=JSON.parse(row.payload);if(envelope.format!=='MY-STOCK-LAB-AES256'||envelope.version!==1||typeof envelope.data!=='string')throw Error('cloud_integrity_failed');return {revision:row.revision,envelope,digest:row.digest,capturedAt:row.captured_at};
 }
 return {login,refresh,status,claim,upload,download,sessionSnapshot:()=>session?structuredClone(session):null,resume:raw=>{
  if(!raw||!Number.isFinite(raw.expiresAt))throw Error('cloud_login_invalid');
  return acceptSession({access_token:raw.access_token,refresh_token:raw.refresh_token,user:{id:raw.userId},expires_at:raw.expiresAt});
 },disconnect:()=>{generation++;session=null;}};
}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export async function businessDigest(db,salt){
 const copy=structuredClone(db);delete copy.logs;
 if(copy.inbox)for(const k of ['lastChecked','lastReceived','error'])delete copy.inbox[k];
 for(const p of Object.values(copy.providers||{}))for(const k of ['attempts','lastResponse','fetched','cooldownUntil'])delete p[k];
 if(copy.preferences)delete copy.preferences.lastFxCheck;
 return hex(JSON.stringify({salt,data:canonical(copy)}));
}
export function createBackupLoop({client,writer,state={},persistState=async()=>{},getDB,getKey,getEnvelope,flush=async()=>{},active=()=>true,clock=()=>Date.now()}){
 if(!uuid(writer))throw Error('invalid_device');let busy=false,lastCheck=0;
 async function tick(){
  if(busy||!active())return {status:'skipped'};if(state.retryAfter>clock())return {status:'free_limit',retryAfter:state.retryAfter};if(lastCheck&&clock()-lastCheck<300000)return {status:'recent'};
  busy=true;lastCheck=clock();const current=getDB();
  try{
   await flush();if(!active()||getDB()!==current)return {status:'locked'};
   const envelope=getEnvelope(),semantic=await businessDigest(current,envelope.salt);if(semantic===state.lastSemantic)return {status:'unchanged'};
   const head=await client.status();if(!active()||getDB()!==current)return {status:'locked'};
   if(head.writer_id!==writer)return {status:'not_writer'};
   if(head.digest&&head.revision!==state.revision)return {status:'conflict'};
   const saved=await client.upload({envelope,key:getKey(),current,expected:head.revision,writer});
   if(!active()||getDB()!==current)return {status:'locked'};state.revision=saved.revision;state.lastSemantic=semantic;state.lastUploadedAt=new Date(clock()).toISOString();delete state.retryAfter;await persistState(state);return {status:'uploaded',revision:saved.revision};
  }catch(e){if(e.code==='free_limit'){state.retryAfter=clock()+86400000;try{await persistState(state);}catch{}}return {status:['revision_conflict','writer_changed'].includes(e.code)?'conflict':e.code==='free_limit'?'free_limit':'offline',localDataPreserved:true};}finally{busy=false;}
 }
 return {tick};
}
export function createFollowerLoop({client,state={},persistState=async()=>{},getDB,getKey,getEnvelope,applyRemote,active=()=>true,clock=()=>Date.now()}){
 let busy=false,lastCheck=0;
 async function tick(){
  if(busy||!active())return {status:'skipped'};if(lastCheck&&clock()-lastCheck<300000)return {status:'recent'};
  if(!state.lastImportedSemantic||!state.lastDigest)return {status:'needs_initial_restore'};
  busy=true;lastCheck=clock();const current=getDB();
  try{
   const local=await businessDigest(current,getEnvelope().salt),head=await client.status();
   if(!active()||getDB()!==current)return {status:'locked'};
   if(local!==state.lastImportedSemantic)return {status:head.digest!==state.lastDigest?'conflict':'local_changes',localDataPreserved:true};
   if(head.digest===state.lastDigest){state.revision=head.revision;await persistState(state);return {status:'unchanged'};}
   const remote=await client.download();if(!active()||getDB()!==current)return {status:'locked'};
   if(!remote||remote.digest!==head.digest)return {status:'retry'};
   if(remote.envelope.salt!==getEnvelope().salt)return {status:'password_changed',localDataPreserved:true};
   const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
   const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(remote.envelope.iv)},getKey(),bytes(remote.envelope.data));
   const restored=validateDB(JSON.parse(new TextDecoder().decode(raw))),semantic=await businessDigest(restored,remote.envelope.salt);
   if(!active()||getDB()!==current||await businessDigest(current,getEnvelope().salt)!==local)return {status:'conflict',localDataPreserved:true};
   await applyRemote({db:restored,envelope:remote.envelope,expectedLocalSemantic:local});state.revision=head.revision;state.lastDigest=remote.digest;state.lastImportedSemantic=semantic;await persistState(state);return {status:'restored',revision:head.revision};
  }catch(e){return {status:['local_changed','revision_conflict'].includes(e.code||e.message)?'conflict':'offline',localDataPreserved:true};}finally{busy=false;}
 }
 return {tick};
}
