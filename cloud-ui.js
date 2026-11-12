// Private backup login, device role and verified restore controls.
import {cloudMessage} from './cloud-controller.js?v=2.9.0';
export function createCloudUI(c,controller,{setTimer=setInterval,clearTimer=clearInterval}={}){
 let timer=null,stopped=false;
 const modal=(title,body,save,label)=>c.modal(title,body,async f=>{try{return await save(f);}catch(e){throw Error(cloudMessage(e.code||e.message));}},label);
 const check=(label,name)=>`<label class="check-label"><input type="checkbox" name="${name}" required>${c.esc(label)}</label>`;
 function view(){
  const s=controller.snapshot();
  if(!s.approved)return c.panel('외부 암호화 자동 백업',`<p><strong>계정 연결 승인 대기</strong></p><p>무료 백업 계정은 아직 연결하지 않았습니다. 현재 금고와 자동 보고서 수신은 기존 방식으로 이용할 수 있습니다.</p>`);
  return c.panel('외부 암호화 자동 백업',`<p role="status"><strong>${c.esc(s.message)}</strong></p><p>원본 기기 한 대에서 변경된 금고를 암호화해 보관하고, 다른 기기는 변경을 확인해 반영합니다. 금고가 열려 있을 때 5분 간격으로 점검합니다.</p><div class="actions">${s.connected?c.button('원격 백업 확인','cloud-status')+c.button('이 기기를 백업 원본으로','cloud-primary')+c.button('다른 기기 백업 따라가기','cloud-follow')+c.button('원격 백업 복원','cloud-restore')+c.button('자동 처리 중지','cloud-pause')+c.button('백업 계정 로그아웃','cloud-logout'):c.button('백업 계정 로그인','cloud-login','primary')}</div><p class="small">최근 저장: ${c.esc(s.lastUploadedAt||'이 기기에서 저장한 기록 없음')}<br>무료 보호 한도: 최근 24시간 4회 저장 · 최대 10MB · 최근 3개 보관. 한도에 도달하면 현재 기기 자료를 유지하고 저장을 멈춥니다. 기기별 변경이 다르면 자동 덮어쓰기를 멈춥니다.</p>`);
 }
 async function showStatus(){const h=await controller.inspect();modal('원격 백업 상태',`<p>저장된 백업: ${h.hasBackup?'있음':'없음'}<br>버전: ${h.revision}<br>이 기기가 백업 원본: ${h.isWriter?'예':'아니요'}<br>원격 변경 시각: ${c.esc(h.updatedAt||'없음')}</p><p>금고가 닫히면 이 기기의 자동 백업도 멈춥니다. 클라우드 저장 성공과 실제 기기 복원은 별도로 확인합니다.</p>`,async()=>{},'닫기');}
 function login(){modal('백업 계정 로그인',c.input('백업 계정 이메일','email','','email',true)+c.input('백업 계정 비밀번호 (금고 비밀번호와 별개)','cloudPassword','','password',true)+'<label class="check-label"><input type="checkbox" name="remember">이 기기에서 자동 연결 유지 (인증 세션을 기기 안에 암호화 보관)</label><p class="small">백업 서비스 인증정보는 이 화면에서만 입력하세요. 금고 비밀번호·증권사 키는 전송하지 않습니다.</p>',async f=>{await controller.login(f.email,f.cloudPassword,f.remember==='on');c.render();},'로그인');}
 async function primary(){const h=await controller.inspect();modal('백업 원본 기기 선택',`<p>이 기기가 앞으로 자동 백업을 저장합니다. 다른 기기의 저장은 중지됩니다.</p>${h.hasBackup?'<p>저장된 원격 백업이 있습니다. 다른 내용으로 교체하면 새 백업 버전을 만듭니다. 최근 3개보다 오래된 백업은 보관되지 않습니다.</p><label class="check-label"><input type="checkbox" name="replace">현재 기기 내용이 다르더라도 원격 백업을 새 버전으로 교체하는 데 동의합니다.</label>':''}`+check('이 기기를 백업 원본으로 지정합니다','confirmed'),async f=>{await controller.primary({expected:h.revision,confirmed:f.confirmed==='on',replaceConfirmed:f.replace==='on'});await controller.tick();c.render();},'확인 후 원본 지정');}
 function restore(){modal('원격 암호화 백업 미리보기',c.input('저장된 백업의 금고 비밀번호 (이 기기에서만 확인)','vaultPassword','','password',true)+'<p>먼저 이 기기 안에서 복호화해 기록 수를 확인합니다. 미리보기만으로 현재 금고를 교체하지 않습니다.</p>',async f=>{
  const p=await controller.previewRestore(f.vaultPassword);
  setTimeout(()=>{if(stopped)return;modal('기록 확인 후 금고 복원',`<p>백업 버전 ${p.revision} · 저장 ${c.esc(p.capturedAt||'미확인')}</p>`+c.table(['항목','백업 내 기록'],Object.entries(p.counts).map(([k,v])=>c.td(({holdings:'보유 종목',reports:'보고서',trades:'직접 매매',dividends:'직접 배당',statementRows:'거래내역서 원장',recommendations:'추천 이력'})[k],v)))+'<p>현재 기기의 금고를 이 백업으로 교체합니다. 필요한 현재 자료는 먼저 파일로 백업하세요.</p>'+check('확인한 백업으로 현재 금고를 교체합니다','confirmed'),async fields=>{await controller.confirmRestore(p.token,fields.confirmed==='on');c.render();},'확인 후 복원');},0);
 },'기기에서 복호화·미리보기');}
 async function handle(act){
  if(!act.startsWith('cloud-'))return false;
  if(!controller.snapshot().approved){c.toast(cloudMessage('approval_required'));return true;}
  try{
   if(act==='cloud-login')login();
   else if(act==='cloud-status')await showStatus();
   else if(act==='cloud-primary')await primary();
   else if(act==='cloud-restore')restore();
   else if(act==='cloud-follow'){await controller.follow();c.render();}
   else if(act==='cloud-pause'){controller.pause();c.render();}
   else if(act==='cloud-logout'){controller.logout();c.render();}
   else return false;
  }catch(e){c.toast(cloudMessage(e.code||e.message));}return true;
 }
 async function start(){await controller.initialize();if(stopped)return;c.render();if(!controller.snapshot().approved)return;
  const poll=async()=>{if(stopped||!c.getDB()||c.appBusy?.())return;try{const out=await controller.tick();if(!['recent','skipped','unchanged'].includes(out.status))c.render();}catch{c.render();}};
  timer=setTimer(poll,60000);await poll();
 }
 function stop(){stopped=true;if(timer!==null)clearTimer(timer);timer=null;controller.disconnect();}
 return {view,handle,start,stop};
}
