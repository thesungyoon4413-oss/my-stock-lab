// Owner-only encrypted backup lifecycle and conflict checks.
import {createBackupClient,createBackupLoop,createFollowerLoop,businessDigest,validateCloudConfig} from './cloud-client.js?v=2.9.0';
import {sealSession,openSession} from './cloud-session.js?v=2.9.0';
import {verifyActiveBackup} from './backup-ui.js?v=2.9.0';
import {decrypt} from './core.js?v=2.9.0';
const error=code=>Object.assign(Error(code),{code});
export const CLOUD_MESSAGES={
 approval_required:'외부 계정 연결 승인 대기',login_required:'백업 계정 로그인이 필요합니다',cloud_login_required:'백업 계정 로그인이 필요합니다',
 ready:'연결 확인 완료',paused:'자동 백업 중지',primary:'이 기기에서 자동 백업',follower:'다른 기기의 백업을 확인 중',
 uploaded:'암호화 백업 저장 완료',restored:'암호화 백업 복원 완료',unchanged:'백업할 새 변경 없음',recent:'다음 점검 대기',skipped:'점검 대기',
 not_writer:'백업 원본 기기가 바뀌었습니다',conflict:'기기별 변경이 달라 자동 반영을 멈췄습니다',local_changes:'이 기기의 변경을 보존하고 자동 반영을 멈췄습니다',
 revision_conflict:'새 원격 버전이 있습니다. 다시 확인하세요',writer_changed:'다른 기기가 백업 원본으로 지정됐습니다',
 free_limit:'무료 보호 한도 도달 · 24시간 대기 후 자동 재개',free_backup_size_limit:'무료 백업 크기 10MB를 초과했습니다',
 not_owner:'허용된 백업 계정이 아닙니다',setup_incomplete:'백업 저장소의 소유자 설정이 필요합니다',
 cloud_request_failed:'백업 서비스에 연결하지 못했습니다',offline:'백업 연결 실패 · 현재 기기 자료는 유지됩니다',
 cloud_login_invalid:'백업 계정 인증을 다시 진행하세요',cloud_integrity_failed:'백업 파일 검증 실패',
 cloud_restore_required:'원격 백업을 먼저 복원하거나 명시적으로 교체를 승인하세요',confirmation_required:'확인 항목을 선택하세요',
 password_changed:'백업의 비밀번호가 바뀌었습니다. 직접 복원이 필요합니다',needs_initial_restore:'최초 원격 백업 복원이 필요합니다',
 local_changed:'미리보기 이후 현재 금고가 바뀌었습니다. 다시 확인하세요',preview_expired:'복원 미리보기를 다시 진행하세요',
 backup_missing:'아직 저장된 원격 백업이 없습니다',vault_locked:'금고가 잠겨 백업을 중지했습니다',busy:'백업 작업이 진행 중입니다',
 local_storage_failed:'기기 백업 설정을 저장하지 못했습니다. 자동 처리를 멈췄습니다',
};
export function cloudMessage(code){return CLOUD_MESSAGES[code]||'백업 처리 실패 · 현재 기기 자료는 유지됩니다';}
export function createCloudController(config,c,{approved=false,device,storage,fetcher,clock=()=>Date.now()}={}){
 const cfg=validateCloudConfig(config);
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(device))throw error('invalid_device');
 const storeKey='my-stock-lab.cloud-device.v1:'+new URL(cfg.url).hostname+':'+device;
 let local={mode:'paused'},ownerKey=c.getKey(),disposed=false,busy=false,loop=null,pending=null,status='approval_required';
 const active=()=>!disposed&&!!c.getDB()&&c.getKey()===ownerKey;
 const client=createBackupClient(cfg,{...(fetcher?{fetcher}:{}),active});
 const binding=()=>({url:cfg.url,device,salt:c.getEnvelope().salt});
 function persist(){try{storage.setItem(storeKey,JSON.stringify(local));}catch{local.mode='paused';loop=null;throw error('local_storage_failed');}}
 async function remember(){if(local.remember){requireActive();const sealed=await sealSession(client.sessionSnapshot(),ownerKey,binding());requireActive();local.session=sealed;persist();}}
 function requireActive(){if(!approved)throw error('approval_required');if(!active())throw error('vault_locked');}
 async function withOperation(fn){requireActive();if(busy)throw error('busy');busy=true;try{return await fn();}catch(e){status=e.code||e.message;throw error(status);}finally{busy=false;}}
 async function authenticate(){
  if(!client.sessionSnapshot())throw error('login_required');
  if(client.sessionSnapshot().expiresAt*1000<clock()+60000){await client.refresh();await remember();}
 }
 function makeLoop(){
  loop=null;
  const base={client,state:local,persistState:async()=>persist(),getDB:c.getDB,getKey:c.getKey,getEnvelope:c.getEnvelope,active,clock};
  if(local.mode==='primary')loop=createBackupLoop({...base,writer:device,flush:c.flush});
  if(local.mode==='follower')loop=createFollowerLoop({...base,applyRemote:async data=>{await c.applyRemote({...data,key:ownerKey});}});
 }
 async function initialize(){
  if(!approved){status='approval_required';return snapshot();}requireActive();
  try{
   const saved=JSON.parse(storage.getItem(storeKey)||'null');
   if(saved&&['paused','primary','follower'].includes(saved.mode))local=saved;
   if(local.remember&&local.session){
    client.resume(await openSession(local.session,ownerKey,binding()));await client.refresh();await client.status();await remember();
    status=local.mode==='paused'?'ready':local.mode;makeLoop();
   }else status='login_required';
  }catch(e){client.disconnect();status=e.code||'cloud_login_invalid';loop=null;}
  return snapshot();
 }
 async function login(email,password,rememberDevice=false){return withOperation(async()=>{
  await client.login(email,password);
  // RLS/RPC authorization is checked before a session can be remembered.
  try{await client.status();}catch(e){client.disconnect();throw e;}
  local.remember=!!rememberDevice;delete local.session;
  try{await remember();persist();}catch(e){client.disconnect();throw e;}
  status=local.mode==='paused'?'ready':local.mode;makeLoop();return snapshot();
 });}
 async function inspect(){return withOperation(async()=>{await authenticate();const head=await client.status();return {revision:head.revision,hasBackup:!!head.digest,isWriter:head.writer_id===device,updatedAt:head.updated_at};});}
 async function primary({expected,replaceConfirmed=false,confirmed=false}={}){return withOperation(async()=>{
  if(!confirmed)throw error('confirmation_required');await authenticate();await c.flush();
  const current=c.getDB(),head=await client.status();if(head.revision!==expected)throw error('revision_conflict');
  if(head.digest&&!replaceConfirmed){const row=await client.download();try{if(row.digest!==head.digest)throw error('revision_conflict');await verifyActiveBackup(row.envelope,ownerKey,current);}catch{throw error('cloud_restore_required');}}
  if(!active()||current!==c.getDB())throw error('vault_locked');
  const claimed=await client.claim(head.revision,device);local.mode='primary';local.revision=claimed.revision;local.lastDigest=claimed.digest;delete local.lastSemantic;
  persist();makeLoop();status='primary';return snapshot();
 });}
 async function follow(){return withOperation(async()=>{
  await authenticate();await c.flush();const current=c.getDB(),row=await client.download();if(!row)throw error('backup_missing');
  try{await verifyActiveBackup(row.envelope,ownerKey,current);}catch{throw error('needs_initial_restore');}
  if(!active()||current!==c.getDB())throw error('vault_locked');local.mode='follower';local.revision=row.revision;local.lastDigest=row.digest;
  local.lastImportedSemantic=await businessDigest(current,c.getEnvelope().salt);persist();makeLoop();status='follower';return snapshot();
 });}
 async function previewRestore(password){return withOperation(async()=>{
  await authenticate();await c.flush();const current=c.getDB(),before=await businessDigest(current,c.getEnvelope().salt);
  const row=await client.download();if(!row)throw error('backup_missing');
  const restored=await decrypt(row.envelope,password);
  if(!active()||c.getDB()!==current||before!==await businessDigest(current,c.getEnvelope().salt))throw error('local_changed');
  const token=crypto.randomUUID();pending={token,current,before,row,restored,at:clock()};
  return {token,revision:row.revision,capturedAt:row.capturedAt,counts:{holdings:restored.db.holdings.length,reports:restored.db.reports.length,trades:restored.db.trades.length,dividends:restored.db.dividends.length,statementRows:(restored.db.statementArchives||[]).reduce((n,a)=>n+a.package.events.length,0),recommendations:restored.db.recommendations.length}};
 });}
 async function confirmRestore(token,confirmed=false){return withOperation(async()=>{
  if(!confirmed)throw error('confirmation_required');const p=pending;
  if(!p||p.token!==token||clock()-p.at>300000)throw error('preview_expired');pending=null;
  if(c.getDB()!==p.current||p.before!==await businessDigest(c.getDB(),c.getEnvelope().salt))throw error('local_changed');
  const head=await client.status();if(head.digest!==p.row.digest)throw error('revision_conflict');
  if(!active()||c.getDB()!==p.current||p.before!==await businessDigest(c.getDB(),c.getEnvelope().salt))throw error('local_changed');
  await c.applyRemote({...p.restored,envelope:p.row.envelope,expectedLocalSemantic:p.before});ownerKey=c.getKey();
  local.mode='follower';local.revision=head.revision;local.lastDigest=p.row.digest;
  local.lastImportedSemantic=await businessDigest(c.getDB(),p.row.envelope.salt);await remember();persist();makeLoop();status='restored';return snapshot();
 });}
 async function tick(){
  if(!approved||!active()||busy||!loop)return {status:'skipped'};
  return withOperation(async()=>{
   await authenticate();const result=await loop.tick();status=result.status;
   if(['conflict','local_changes','not_writer','password_changed'].includes(status)){local.mode='paused';loop=null;persist();}
   return result;
  });
 }
 function pause(){requireActive();if(busy)throw error('busy');local.mode='paused';loop=null;pending=null;persist();status='paused';return snapshot();}
 function disconnect(){disposed=true;client.disconnect();loop=null;pending=null;status='vault_locked';}
 function logout(){requireActive();if(busy)throw error('busy');client.disconnect();local.mode='paused';local.remember=false;delete local.session;loop=null;pending=null;persist();status='login_required';return snapshot();}
 function snapshot(){return {approved,connected:!!client.sessionSnapshot(),mode:local.mode,status,message:cloudMessage(status),busy,remembered:!!local.remember,revision:local.revision??null,lastUploadedAt:local.lastUploadedAt||null};}
 return {initialize,login,inspect,primary,follow,previewRestore,confirmRestore,tick,pause,logout,disconnect,snapshot};
}
