import {financialShortlist,financialView,financialReportText,financialSymbol} from './financial-data.js?v=2.7.0';
import {normalizeFinancials} from './fundamentals.js?v=2.7.0';
export function createFinancialUI(c,{update,lookup,review}){
 const {esc,n,pct,button,panel,table,td,modal,input}=c,db=()=>c.getDB();
 const name=s=>db().holdings.find(h=>h.symbol===s&&h.currency==='USD')?.name||s;
 function view(){
  const s=normalizeFinancials(db()),rank=financialShortlist(db());
  const rows=items=>'<div class="financial-grid">'+items.map(r=>`<article class="financial-card"><h4>${esc(name(r.symbol))} (${esc(r.symbol)})</h4><p class="small">${r.held?'현재 보유':'관찰 기업'} · 결산 ${esc(r.quarter?.date||'미확인')} · ${r.score}/4</p><p>${esc(r.reason)}</p><div class="actions">${button('실적·근거','finance-detail:'+r.symbol,'mini')}${r.eligible?button('연구 초안에 담기','finance-review:'+r.symbol,'mini'):r.reason==='최근 가격 확인 필요'?button('종가 확인','finance-price:'+r.symbol,'mini'):''}</div></article>`).join('')+'</div>';
  return panel('무료 실적 비교·신규 후보 선별',`<p>보유 미국 기업과 관찰 기업의 실적을 같은 기준으로 비교합니다. 하루 최대 2개 기업을 순환 점검합니다.</p><div class="actions">${button('실적 자료 갱신','finance-update','primary')}${button('관찰 목록·자동화','finance-settings')}</div><p class="small">관찰 목록: ${s.watchlist.map(esc).join(', ')||'없음'}<br>${db().preferences.autoRefresh&&db().preferences.autoFundamentals!==false?'금고를 열 때 자동 점검 사용':'자동 점검 꺼짐'} · 보유 기업 우선</p><h3>미국 신규 재무 후보 · 최대 2개</h3>${rank.candidates.length?rows(rank.candidates):'<p>가격·재무자료와 선별 조건이 모두 확인된 신규 재무 후보 없음</p>'}<p class="small">재무 후보는 매수 추천과 구분합니다. 밸류에이션·경쟁력·위험을 확인한 뒤 연구 기록으로 검토하세요.</p><details><summary>선별 기준·출처·갱신 방식</summary><p>분기 매출 성장 ≥10%, 영업흑자·성장 ≥10%, 연간 평균 자본 ROE ≥10%, 분기 부채비율 ≤100%를 모두 충족해야 합니다. 금융업·업종별 차이는 반영하지 않습니다. 자동으로 매수 추천 기록을 만들지 않습니다.</p><p>자료: Alpha Vantage의 SEC 재무 정규화 데이터. 원문 공시·뉴스 자동 수집과 국내 기업 재무 직접 연결은 별도입니다. ETF·SPCX는 이 비교에서 제외합니다. 무료 기업 개요 자료는 사용하지 않습니다.</p><p>재무자료는 7일간 재사용하며 시세와 최근 24시간 20회 한도를 공유합니다. 기존 무료 연결과 시세 자동 갱신을 켜면 금고를 열 때 실행합니다. 앱이 닫혀 있으면 실행되지 않습니다.</p></details>${rank.held.length?'<h3>보유 기업과 같은 기준으로 비교</h3>'+rows(rank.held):''}${rank.all.some(r=>!r.held)?'<details><summary>전체 관찰 기업·미충족 이유</summary>'+rows(rank.all.filter(r=>!r.held))+'</details>':''}`);
 }
 function detail(symbol){
  const r=financialView(db(),symbol),metric=v=>typeof v==='number'?pct(v):'미확인';
  const period=(record,rows)=>record?`<p class="small">수집 ${esc(record.collected)} · <a href="${record.source}" target="_blank" rel="noreferrer">출처·항목 정의 ↗</a></p>`+table(['결산일·통화','매출 / 자산','영업이익 / 부채','순이익 / 자본'],rows.map(x=>td(esc(x.date)+' · '+esc(x.currency),n(x.totalRevenue??x.totalAssets),n(x.operatingIncome??x.totalLiabilities),n(x.netIncome??x.totalShareholderEquity)))):'<p>미수집</p>';
  modal(esc(name(symbol))+' 실적·재무 근거',`<p>${esc(r.reason)} · ${r.score}/4</p><p><a href="https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(symbol)}" target="_blank" rel="noreferrer">SEC 원문 공시 검색 ↗</a> · <a href="https://dart.fss.or.kr/dsab001/main.do" target="_blank" rel="noreferrer">국내 DART 공시 검색 ↗</a></p>${table(['비교 항목','확인 값'],[td('분기 매출 전년 동기 성장률',metric(r.revenueGrowth)),td('분기 영업이익 전년 동기 성장률',metric(r.profitGrowth)),td('분기 영업이익률',metric(r.operatingMargin)),td('연간 ROE · '+esc(r.annual?.date||'결산 미확인'),metric(r.roe)),td('동일 분기 부채비율',metric(r.debtRatio)),td('최근 등록 종가',r.quote?'$'+n(r.quote.price)+' · '+esc(r.quote.date)+' · '+esc(r.quote.source):'미확인')])}<h3>분기 손익계산서 · 금액은 표시 통화의 1단위</h3>${period(r.income,r.income?.quarterly.slice(0,5)||[])}<h3>연간 손익계산서 · 금액은 표시 통화의 1단위</h3>${period(r.income,r.income?.annual||[])}<h3>분기 재무상태표 · 금액은 표시 통화의 1단위</h3>${period(r.balance,r.balance?.quarterly.slice(0,5)||[])}<p class="small">USD는 달러 단위이며 백만 달러가 아닙니다. ROE는 연간 순이익 ÷ 해당 연도 기초·기말 평균 자본입니다. 분기 부채비율은 총부채 ÷ 자본입니다. 같은 결산일·통화가 없거나 기준 이익·자본이 0 이하이면 관련 계산을 보류합니다. PER·PBR·경쟁사·촉매·매수 구간·실패 조건은 별도 검토가 필요합니다. 가격 기준일과 재무 결산일은 서로 다릅니다.</p>`,async()=>{},'확인');
 }
 function settings(){
  const s=normalizeFinancials(db()),automatic=db().preferences.autoFundamentals!==false;
  modal('무료 실적 관찰 목록',input('미국 기업 종목코드 · 쉼표로 구분 · 최대 12개','symbols',s.watchlist.join(', '))+'<label class="check-label"><input type="checkbox" name="automatic" '+(automatic?'checked':'')+'>시세 자동 갱신 후 하루 한 번 실적 자료도 점검</label><p>설정의 시세 자동 갱신과 기존 Alpha Vantage 무료 연결이 켜져 있을 때 실행됩니다. 앱이 닫히거나 금고가 잠기면 실행하지 않습니다. 전체 시장 탐색이 아닌 이 목록과 보유 기업의 비교입니다. 한도·무료 접근 제한 시 이전 자료를 유지합니다.</p>',async f=>{
   const symbols=[...new Set(f.symbols.toUpperCase().split(/[\s,]+/).filter(Boolean))];if(symbols.length>12||symbols.some(v=>!financialSymbol(v)))throw Error('미국 종목코드 최대 12개를 확인하세요');s.watchlist=symbols;db().preferences.autoFundamentals=f.automatic==='on';await c.commit();
  });
 }
 async function handle(act,id){
  if(act==='finance-update')await update();else if(act==='finance-settings')settings();else if(act==='finance-detail')detail(id);else if(act==='finance-price')await lookup({symbol:id,currency:'USD'});else if(act==='finance-review'){
   const r=financialView(db(),id);if(!r.eligible)throw Error('가격·재무 선별 조건을 먼저 확인하세요');
   review({symbol:id,name:name(id),market:'US',price:r.quote.price,priceDate:r.quote.date,fiscalDate:r.quarter.date,source:r.income.source,revenue:r.quarter.totalRevenue,revenueGrowth:r.revenueGrowth,operatingProfit:r.quarter.operatingIncome,profitGrowth:r.profitGrowth,roe:r.roe,debtRatio:r.debtRatio,business:financialReportText(db(),id),catalysts:'',risks:'',failure:'',per:null,pbr:null});
  }else return false;return true;
 }
 return {view,handle};
}
