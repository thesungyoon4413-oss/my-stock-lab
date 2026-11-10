// Financial statements stay in the encrypted vault. No API keys or raw payloads.
export const FINANCIAL_KINDS=['INCOME_STATEMENT','BALANCE_SHEET'];
export const FINANCIAL_DOC='https://www.alphavantage.co/documentation/';
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e20;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const financialSymbol=v=>typeof v==='string'&&/^[A-Z][A-Z0-9.\-]{0,14}$/.test(v);
const fields={INCOME_STATEMENT:['totalRevenue','operatingIncome','netIncome'],BALANCE_SHEET:['totalAssets','totalLiabilities','totalShareholderEquity']};
export function initialFinancialState(){return {version:1,watchlist:['MSFT','AAPL','AMD','IBM'],records:[],checked:{},lastAutoDate:''};}
export function parseFinancialResponse(raw,symbol,kind,collected=new Date().toISOString()){
 if(!FINANCIAL_KINDS.includes(kind)||!financialSymbol(symbol)||raw?.symbol!==symbol)throw Error('재무 응답의 종목·자료 종류가 일치하지 않습니다');
 if(raw.Information||raw.Note||raw['Error Message'])throw Error('재무 자료 접근 제한·키·종목 오류');
 if(!Number.isFinite(Date.parse(collected)))throw Error('재무 수집 시각 오류');
 const day=collected.slice(0,10);
 const parse=(input,max)=>{
  if(!Array.isArray(input)||input.length>500)throw Error('재무 기간 목록 오류');
  const seen=new Set();
  return input.map(r=>{
   if(!date(r.fiscalDateEnding)||r.fiscalDateEnding>day||!(/^[A-Z]{3}$/.test(r.reportedCurrency))||seen.has(r.fiscalDateEnding))throw Error('재무 결산일·통화·중복 오류');
   seen.add(r.fiscalDateEnding);const row={date:r.fiscalDateEnding,currency:r.reportedCurrency};
   for(const k of fields[kind]){
    const v=r[k];
    if(v===null||v===undefined||['','None','N/A','-'].includes(v))row[k]=null;
    else if(!['string','number'].includes(typeof v)||(typeof v==='string'&&!/^-?\d+(?:\.\d+)?$/.test(v))||!numeric(Number(v)))throw Error('재무 숫자 형식 오류');
    else row[k]=Number(v);
   }
   return row;
  }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,max);
 };
 const record={symbol,kind,collected,source:FINANCIAL_DOC,quarterly:parse(raw.quarterlyReports,12),annual:parse(raw.annualReports,3)};
 if(!record.quarterly.length&&!record.annual.length)throw Error('공개 재무 자료가 없습니다');
 return record;
}
export function validateFinancialState(s){
 if(s===undefined)return;
 const fail=()=>{throw Error('재무 캐시 구조 오류');};
 if(!s||s.version!==1||!Array.isArray(s.watchlist)||s.watchlist.length>12||s.watchlist.some(v=>!financialSymbol(v))||new Set(s.watchlist).size!==s.watchlist.length||!Array.isArray(s.records)||s.records.length>200||!s.checked||typeof s.checked!=='object'||Array.isArray(s.checked)||!(s.lastAutoDate===''||date(s.lastAutoDate)))fail();
 if(Object.keys(s.checked).length>500||Object.entries(s.checked).some(([k,v])=>!financialSymbol(k)||!date(v)))fail();
 const keys=new Set();
 for(const r of s.records){
  const key=r.symbol+':'+r.kind;
  if(!financialSymbol(r.symbol)||!FINANCIAL_KINDS.includes(r.kind)||keys.has(key)||r.source!==FINANCIAL_DOC||typeof r.collected!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(r.collected)||!Number.isFinite(Date.parse(r.collected)))fail();
  keys.add(key);
  for(const [period,max] of [['quarterly',12],['annual',3]]){
   if(!Array.isArray(r[period])||r[period].length>max)fail();const dates=new Set();
   for(const row of r[period]){
    if(!date(row.date)||row.date>r.collected.slice(0,10)||dates.has(row.date)||!(/^[A-Z]{3}$/.test(row.currency))||fields[r.kind].some(k=>row[k]!==null&&!numeric(row[k])))fail();dates.add(row.date);
   }
  }
  if(!r.quarterly.length&&!r.annual.length)fail();
 }
}
const age=(d,now)=>(now-Date.parse(d+'T00:00:00Z'))/86400000;
const previousYear=(rows,current)=>rows.filter(r=>r.currency===current.currency&&r.date<current.date&&Math.abs((Date.parse(current.date)-Date.parse(r.date))/86400000-365.25)<=10).sort((a,b)=>Math.abs((Date.parse(current.date)-Date.parse(a.date))/86400000-365.25)-Math.abs((Date.parse(current.date)-Date.parse(b.date))/86400000-365.25))[0];
const growth=(a,b)=>{const r=numeric(a)&&numeric(b)&&b>0?(a/b-1)*100:null;return numeric(r)?r:null;};
const percent=(a,b)=>{const r=numeric(a)&&numeric(b)&&b>0?a/b*100:null;return numeric(r)?r:null;};
export function financialView(db,symbol,now=new Date()){
 const records=(db.financials?.records||[]).filter(r=>r.symbol===symbol&&Date.parse(r.collected)<=+now),income=records.find(r=>r.kind==='INCOME_STATEMENT'),balance=records.find(r=>r.kind==='BALANCE_SHEET');
 const sorted=rows=>(rows||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
 const q=sorted(income?.quarterly)[0],prior=q&&previousYear(income.quarterly,q),annual=sorted(income?.annual)[0];
 const b=q&&balance?.quarterly.find(r=>r.date===q.date&&r.currency===q.currency);
 const end=annual&&balance?.annual.find(r=>r.date===annual.date&&r.currency===annual.currency),start=end&&previousYear(balance.annual,end);
 const equity=end&&start&&end.totalShareholderEquity>0&&start.totalShareholderEquity>0?(end.totalShareholderEquity+start.totalShareholderEquity)/2:null;
 const revenueGrowth=q&&prior?growth(q.totalRevenue,prior.totalRevenue):null,profitGrowth=q&&prior?growth(q.operatingIncome,prior.operatingIncome):null;
 const roe=annual?percent(annual.netIncome,equity):null,debtRatio=b&&b.totalLiabilities>=0?percent(b.totalLiabilities,b.totalShareholderEquity):null;
 const operatingMargin=q?percent(q.operatingIncome,q.totalRevenue):null;
 const quote=(db.quotes||[]).filter(x=>x.symbol===symbol&&x.currency==='USD'&&date(x.date)&&age(x.date,now)>=0&&x.price>0).sort((a,b)=>b.date.localeCompare(a.date))[0];
 const complete=!!q&&!!annual&&!!b&&[revenueGrowth,profitGrowth,roe,debtRatio].every(numeric);
 const fresh=complete&&records.every(r=>+now-Date.parse(r.collected)<=7*86400000)&&age(q.date,now)>=0&&age(q.date,now)<=180&&age(annual.date,now)>=0&&age(annual.date,now)<=450;
 const criteria=[{label:'분기 매출 전년 동기 대비 10% 이상',pass:numeric(revenueGrowth)&&revenueGrowth>=10},{label:'분기 영업흑자·전년 동기 대비 10% 이상',pass:q?.operatingIncome>0&&numeric(profitGrowth)&&profitGrowth>=10},{label:'연간 ROE 10% 이상',pass:numeric(roe)&&roe>=10},{label:'동일 분기 부채비율 100% 이하',pass:numeric(debtRatio)&&debtRatio>=0&&debtRatio<=100}];
 const held=(db.holdings||[]).some(h=>h.symbol===symbol&&h.currency==='USD'&&h.qty>0);
 const eligible=fresh&&criteria.every(r=>r.pass)&&!!quote&&age(quote.date,now)<=7;
 const reason=!complete?'비교 가능한 기간·재무 항목 부족':!fresh?'재무자료 갱신 필요':!quote||age(quote.date,now)>7?'최근 가격 확인 필요':!criteria.every(r=>r.pass)?'재무 선별 조건 미충족':'재무 조건 충족 · 밸류에이션·정성 검토 필요';
 return {symbol,income,balance,quarter:q,prior,annual,revenueGrowth,profitGrowth,roe,debtRatio,operatingMargin,quote,criteria,score:criteria.filter(r=>r.pass).length,complete,fresh,eligible,held,reason};
}
export function financialShortlist(db,now=new Date()){
 const symbols=[...new Set((db.financials?.records||[]).map(r=>r.symbol))],all=symbols.map(s=>financialView(db,s,now));
 const byScore=(a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol);
 return {all:all.sort(byScore),candidates:all.filter(r=>r.eligible&&!r.held).sort(byScore).slice(0,2),held:all.filter(r=>r.held).sort(byScore)};
}
export function financialReportText(db,symbol,now=new Date()){
 const r=financialView(db,symbol,now);if(!r.income&&!r.balance)return '';
 const val=n=>numeric(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'미확인';
 return `저장 재무자료 · ${symbol}\n출처 Alpha Vantage (SEC 자료 정규화, 원문 공시와 별도) ${FINANCIAL_DOC}\n수집 ${r.income?.collected||r.balance.collected}\n분기 결산 ${r.quarter?.date||'미확인'} · 표시 통화 ${r.quarter?.currency||'미확인'} · 금액은 표시 통화의 1단위\n매출 ${val(r.quarter?.totalRevenue)} / 영업이익 ${val(r.quarter?.operatingIncome)}\n전년 동기 매출 ${val(r.revenueGrowth)}% / 영업이익 ${val(r.profitGrowth)}%\n연간 ROE ${val(r.roe)}% (결산 ${r.annual?.date||'미확인'}, 기초·기말 평균 자본) / 분기 부채비율 ${val(r.debtRatio)}%\n상태 ${r.reason}\nPER·PBR·경쟁사·뉴스·촉매·목표주가: 별도 확인 필요. 재무 선별은 매수 판단이 아닙니다.`;
}
