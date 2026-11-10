import {decrypt} from './core.js?v=2.4.0';
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export async function inspectBackup(envelope,password,current){
 const {db}=await decrypt(envelope,password);
 return {matchesCurrent:JSON.stringify(canonical(db))===JSON.stringify(canonical(current)),holdings:db.holdings.length,trades:db.trades.length,dividends:db.dividends.length,reports:db.reports.length,recommendations:db.recommendations.length,sourceRows:(db.statementArchives||[]).reduce((s,a)=>s+a.package.events.length,0),taxRevisions:(db.taxAllocations||[]).length};
}
export function createBackupUI(c){
 function view(){return c.panel('암호화 백업·복구 점검',`<p>백업 파일을 열어 비밀번호와 자료 구조를 확인합니다. 현재 금고는 유지합니다. 기기 분실·브라우저 데이터 삭제에 대비해 암호화 백업과 비밀번호를 개인 보관하세요.</p><div class="actions">${c.button('백업 파일 검증','verify-backup')}</div><input id="verify-backup" class="broker-file-input" type="file" accept=".json"><p class="small">파일 생성 후 실제 파일 앱에 보관됐는지는 사용자가 확인해야 합니다. 서버·외부 클라우드 자동 백업은 연결하지 않습니다.</p>`);}
 async function fileSelected(file){if(!file)return;try{if(file.size>70000000)throw Error('백업 파일은 70MB 이하만 지원합니다');const envelope=JSON.parse(await file.text()),current=c.getDB();c.modal('암호화 백업 파일 검증',c.input('이 백업의 비밀번호 (기기 안에서만 사용)','password','','password',true)+'<p>백업을 검사하며 현재 보유·키·보고서를 변경하지 않습니다.</p>',async f=>{const out=await inspectBackup(envelope,f.password,current);setTimeout(()=>{if(c.getDB()!==current)return;c.modal('백업 검증 완료',`<p><strong>비밀번호·암호문·자료 구조 확인 완료</strong><br>${out.matchesCurrent?'현재 금고와 내용이 일치합니다.':'현재 금고와 내용이 다릅니다. 이전 시점 백업일 수 있습니다.'}</p>`+c.table(['항목','백업 내 기록 수'],[['보유 종목',out.holdings],['직접 매매',out.trades],['직접 배당',out.dividends],['보고서',out.reports],['추천',out.recommendations],['원장 행',out.sourceRows],['세금 분류 이력',out.taxRevisions]].map(([k,n])=>c.td(k,c.n(n))))+'<p>실제 복구하려면 설정의 기존 백업 복구 기능을 사용하세요.</p>',async()=>{},'확인');},0);},'비밀번호로 검증');}catch(e){c.toast(e.message);}}
 async function handle(act){if(act!=='verify-backup')return false;document.getElementById('verify-backup')?.click();return true;}
 return {view,fileSelected,handle};
}
