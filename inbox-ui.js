import {newInbox,connectionCode,receiveInbox} from './delivery.js?v=2.4.0';
export function createInboxUI(c){
 const {panel,button,modal,esc,toast,area}=c;let busy=false;
 function status(){const i=c.getDB().inbox;return !i?'아직 연결하지 않음':!i.enabled?'자동 받기 중지':i.lastReceived?'최근 수신 '+i.lastReceived:'받는 금고 준비됨 · 발행 연결 확인 필요';}
 function view(){const i=c.getDB().inbox;return panel('보고서 자동 수신함',`<p><strong>${esc(status())}</strong></p><p>기존 예약 보고서를 발행 측에서 암호화해 저장하면, 금고를 열었을 때 자동으로 받아 보관합니다. 파일을 내려받아 선택할 필요가 없습니다.</p><div class="actions">${i?button('연결 코드 복사','inbox-copy','primary')+button('새 보고서 확인','inbox-check')+button(i.enabled?'자동 받기 중지':'자동 받기 재개','inbox-toggle'):button('자동 보고서 연결 준비','inbox-setup','primary')}</div>${i?.error?'<p class="small">'+esc(i.error)+'</p>':''}<p class="small">${i?'마지막 확인: '+esc(i.lastChecked||'아직 없음')+'<br>':''}최초 한 번만 공개 연결 코드를 전달해 발행 연결을 완료해야 합니다. 이 코드에는 금고 비밀번호·복호화 키·보유 내역이 없습니다. 발행 설정이 끝나기 전에는 자동 전달 완료가 아닙니다. 수신 키도 전체 암호화 백업에 포함됩니다.</p>`);}
 async function copy(){const code=connectionCode(c.getDB().inbox);try{await navigator.clipboard.writeText(code);toast('공개 연결 코드를 복사했습니다. 채팅에 한 번만 붙여넣어 주세요.');}catch{modal('최초 한 번만 연결 코드 전달',area('아래 코드 전체를 복사해 채팅에 보내주세요 (비밀번호 아님)','code',code),async()=>{},'닫기');}}
 async function sync(force=false){
  const d=c.getDB();if(!d?.inbox?.enabled||busy)return;busy=true;
  try{const out=await receiveInbox(d,{active:()=>c.getDB()===d&&d.inbox.enabled,force});if(c.getDB()!==d)return;if(!out.skipped){if(out.errors.length)d.logs.push({date:new Date().toISOString(),message:out.errors.slice(0,3).join('; ')});await c.commit();if(out.added)toast(`예약 보고서 ${out.added}개를 자동 저장했습니다`);else if(force)toast(out.unpublished?'아직 발행된 보고서가 없습니다':out.errors.length?'수신 오류 · 기존 보고서는 유지합니다':'새 보고서가 없습니다');}}
  catch(e){if(c.getDB()!==d)return;d.inbox.error='자동 수신 확인 실패 · '+e.message;await c.save();if(force)toast('수신 확인 실패 · 기존 보고서는 유지합니다');}
  finally{busy=false;}
 }
 function setup(){
  const current=c.getDB();modal('다운로드 없는 자동 보고서 준비',`<p>기기에서 수신 전용 키를 만듭니다. 복호화 키는 기존 금고 안에만 암호화 저장하고, 발행 측에는 공개 연결 코드만 전달합니다.</p><p>보고서 암호문은 기존 GitHub 사이트에 저장합니다. 원문 투자 내역은 공개하지 않습니다. 기존 ChatGPT 예약 두 개는 변경하지 않습니다.</p><label class="check-label"><input type="checkbox" name="consent" required>이 암호화 저장 방식에 동의하고 자동 받기를 준비합니다.</label><label class="check-label"><input type="checkbox" name="localAuto" checked>이미 연결한 무료 시세·환율과 사이트 점검 보고서도 자동 확인합니다.</label><p class="small">발행 연결은 공개 코드를 한 번 전달한 뒤 실제 수신까지 확인해야 완료됩니다. 앱이 닫힌 동안에도 발행된 암호문은 저장되며, 금고 안으로 가져오기는 잠금을 해제한 뒤 실행합니다.</p>`,async f=>{
   if(f.consent!=='on')throw Error('암호화 저장 방식 동의가 필요합니다');if(c.getDB()!==current)throw Error('금고를 다시 열어 주세요');if(busy)throw Error('처리 중입니다');busy=true;
   try{const generated=current.inbox||await newInbox();if(c.getDB()!==current)return;current.inbox=generated;current.inbox.enabled=true;if(f.localAuto==='on'){current.preferences.reportOnOpen=true;current.preferences.autoRefresh=Object.values(current.providers||{}).some(p=>p.accepted&&p.key);current.preferences.autoFx=true;}await c.commit();setTimeout(()=>{if(c.getDB()===current)copy();},0);}finally{busy=false;}
  },'기기에서 연결 준비');
 }
 async function handle(act){if(act==='inbox-setup')setup();else if(act==='inbox-copy')await copy();else if(act==='inbox-check')await sync(true);else if(act==='inbox-toggle'){const d=c.getDB();d.inbox.enabled=!d.inbox.enabled;await c.commit();}else return false;return true;}
 function dashboard(){const d=c.getDB();if(!d.inbox)return '';const recent=['KR','US'].map(m=>d.reports.filter(r=>r.market===m&&r.deliveryDigest).sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created))[0]).filter(Boolean);return panel('자동으로 받은 투자 보고서',recent.length?recent.map(r=>'<p><strong>'+esc(r.title)+'</strong><small>보고서 기준 '+r.date+' · 수신 '+esc(r.receivedAt)+'</small></p>'+button('보고서 읽기','view-report:'+r.id)).join(''):'<p>'+esc(status())+' · 발행 연결 후 이곳에 표시합니다.</p>');}
 return {view,sync,handle,dashboard};
}
