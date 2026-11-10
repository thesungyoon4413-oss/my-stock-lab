import {listRecoveries,readRecovery} from './recovery.js?v=2.7.0';
import {decrypt,validateDB} from './core.js?v=2.7.0';
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export async function inspectBackup(envelope,password,current){
 const {db}=await decrypt(envelope,password);
 return {matchesCurrent:JSON.stringify(canonical(db))===JSON.stringify(canonical(current)),holdings:db.holdings.length,trades:db.trades.length,dividends:db.dividends.length,reports:db.reports.length,recommendations:db.recommendations.length,sourceRows:(db.statementArchives||[]).reduce((s,a)=>s+a.package.events.length,0),taxRevisions:(db.taxAllocations||[]).length};
}
export async function verifyActiveBackup(envelope,key,current){
 if(!key||envelope?.format!=='MY-STOCK-LAB-AES256'||envelope.version!==1)throw Error('열린 금고의 백업만 검증할 수 있습니다');
 const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},key,bytes(envelope.data)),restored=validateDB(JSON.parse(new TextDecoder().decode(raw)));
 if(JSON.stringify(canonical(restored))!==JSON.stringify(canonical(current)))throw Error('최신 금고 저장이 끝난 뒤 백업을 다시 내보내세요');
 return {verified:true,verifiedAt:new Date().toISOString(),reports:restored.reports.length,sourceRows:(restored.statementArchives||[]).reduce((s,a)=>s+a.package.events.length,0),recipientKeyIncluded:!!restored.inbox};
}
export function createBackupUI(c){
 async function verifyExport(envelope){const current=c.getDB(),key=c.getKey?.();const result=await verifyActiveBackup(envelope,key,current);if(c.getDB()!==current)throw Error('금고가 잠겨 백업 내보내기를 중지했습니다');return result;}
 function view(){return c.panel('암호화 백업·복구 점검',`<p>백업 파일을 열어 비밀번호와 자료 구조를 확인합니다. 현재 금고는 유지합니다. 기기 분실·브라우저 데이터 삭제에 대비해 암호화 백업과 비밀번호를 개인 보관하세요.</p><div class="actions">${c.button('백업 파일 검증','verify-backup')}${c.button('기기 내 자동 복구점','recovery-list')}</div><input id="verify-backup" class="broker-file-input" type="file" accept=".json"><p class="small">파일 생성 후 실제 파일 앱에 보관됐는지는 사용자가 확인해야 합니다. 변경 전 암호문을 최근 3개와 하루 첫 저장 3개까지 기기 안에 자동 보관합니다. 기기 분실·Safari 데이터 삭제에 대비한 외부 파일 백업은 별도로 필요합니다. 서버·기기 간 자동 동기화는 연결하지 않습니다.</p>`);}
 async function fileSelected(file){if(!file)return;try{if(file.size>70000000)throw Error('백업 파일은 70MB 이하만 지원합니다');const envelope=JSON.parse(await file.text()),current=c.getDB();c.modal('암호화 백업 파일 검증',c.input('이 백업의 비밀번호 (기기 안에서만 사용)','password','','password',true)+'<p>백업을 검사하며 현재 보유·키·보고서를 변경하지 않습니다.</p>',async f=>{const out=await inspectBackup(envelope,f.password,current);setTimeout(()=>{if(c.getDB()!==current)return;c.modal('백업 검증 완료',`<p><strong>비밀번호·암호문·자료 구조 확인 완료</strong><br>${out.matchesCurrent?'현재 금고와 내용이 일치합니다.':'현재 금고와 내용이 다릅니다. 이전 시점 백업일 수 있습니다.'}</p>`+c.table(['항목','백업 내 기록 수'],[['보유 종목',out.holdings],['직접 매매',out.trades],['직접 배당',out.dividends],['보고서',out.reports],['추천',out.recommendations],['원장 행',out.sourceRows],['세금 분류 이력',out.taxRevisions]].map(([k,n])=>c.td(k,c.n(n))))+'<p>실제 복구하려면 설정의 기존 백업 복구 기능을 사용하세요.</p>',async()=>{},'확인');},0);},'비밀번호로 검증');}catch(e){c.toast(e.message);}}
 async function handle(act,id){
  if(act==='recovery-list'){const rows=await listRecoveries();c.modal('기기 내 자동 복구점',rows.length?'<div class="financial-grid">'+rows.map(r=>'<article class="financial-card"><h4>'+c.esc(new Date(r.created).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+'</h4><p>'+(r.kind==='daily'?'하루 첫 저장':'최근 변경 전')+' · '+c.n(r.bytes/1024)+' KB</p><div class="actions">'+c.button('복구','recovery-restore:'+r.id,'mini')+c.button('파일 보관','recovery-export:'+r.id,'mini')+'</div></article>').join('')+'</div>'+'<p>이 기기·브라우저 안의 암호화 저장본입니다. 복구 시 해당 시점 금고 비밀번호를 기기에서 확인한 뒤 현재 금고를 교체합니다. 기기 분실·브라우저 저장소 삭제에는 별도 백업 파일이 필요합니다.</p>':'<p>아직 저장된 복구점이 없습니다. 저장 공간이나 브라우저 설정으로 생성하지 못할 수 있습니다.</p>',async()=>{},'닫기');return true;}
  if(act==='recovery-export'||act==='recovery-restore'){const current=c.getDB(),r=await readRecovery(id);if(c.getDB()!==current)throw Error('금고가 잠겼습니다');if(act==='recovery-export')c.download('my-stock-lab-recovery-'+r.id+'.encrypted.json',JSON.stringify(r.envelope));else {document.getElementById('modal').close();await c.restoreCheckpoint(r.envelope);}return true;}
  if(act!=='verify-backup')return false;document.getElementById('verify-backup')?.click();return true;
 }
 return {view,fileSelected,handle,verifyExport};
}
