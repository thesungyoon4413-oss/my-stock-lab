// Issuer snapshots are data inside the encrypted report archive, never account inputs.
export const FUND_FORMAT='MY-STOCK-LAB-OFFICIAL-FUNDS';
const symbols={GOOY:'GOOGL',NVDY:'NVDA',TSLY:'TSLA'},origin='https://yieldmaxetfs.com';
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const numeric=(v,max=1e6)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<max;
export function isFundReport(r){return typeof r?.body==='string'&&r.body.length<150000&&r.body.trimStart().startsWith('{')&&r.body.includes('"'+FUND_FORMAT+'"');}
export function validateFundSnapshot(s,{asOf=today()}={}){
 const fail=()=>{throw Error('운용사 자료의 종목·기준일·출처·구조를 확인할 수 없습니다');};
 if(s?.format!==FUND_FORMAT||s.version!==1||!Number.isFinite(Date.parse(s.collectedAt))||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.collectedAt))>asOf||!Array.isArray(s.funds)||s.funds.length<1||s.funds.length>3||!Array.isArray(s.errors)||s.errors.length>4)fail();
 const seen=new Set(),metric=(v,positive=false)=>{if(!v||!day(v.date)||v.date>asOf||!numeric(v.value,100000)||(positive&&v.value<=0))fail();};
 const dates=(r,planned=false)=>{if(!['declaredDate','exDate','recordDate','payDate'].every(k=>day(r[k]))||r.declaredDate>r.exDate||r.exDate>r.recordDate||r.recordDate>r.payDate||Date.parse(r.payDate)-Date.parse(r.exDate)>45*86400000||(!planned&&r.declaredDate>asOf))fail();};
 for(const f of s.funds){
  if(!Object.hasOwn(symbols,f.symbol)||seen.has(f.symbol)||f.underlyingSymbol!==symbols[f.symbol]||f.currency!=='USD'||f.sourceURL!==origin+'/our-etfs/'+f.symbol.toLowerCase()+'/'||!Number.isInteger(f.rejectedSourceRows)||f.rejectedSourceRows<0)fail();seen.add(f.symbol);
  metric(f.nav,true);metric(f.close,true);metric(f.distributionRate);metric(f.secYield);
  if(!Array.isArray(f.distributions)||!f.distributions.length||f.distributions.length>8)fail();
  for(const r of f.distributions){dates(r);if(!numeric(r.amount)||r.rocStatus!=='estimate'||r.rocSourceURL!==origin+'/TAX-Documents/'||(r.rocPercent!==null&&(!numeric(r.rocPercent,101)||r.rocPercent>100)))fail();}
 }
 for(const e of s.errors)if(!['GOOY','NVDY','TSLY','calendar'].includes(e.symbol)||!['official_source_unavailable_or_changed','official_calendar_unavailable_or_changed'].includes(e.code))fail();
 if(s.calendar!==null){const c=s.calendar;if(c?.sourceURL!==origin+'/distribution-schedule/'||c.group!==2||!Array.isArray(c.symbols)||c.symbols.length!==3||Object.keys(symbols).some(s=>!c.symbols.includes(s))||!Array.isArray(c.upcoming)||c.upcoming.length>3)fail();for(const r of c.upcoming){dates(r,true);if(r.amount!==null||r.status!=='planned')fail();}}
 return s;
}
export function readFundSnapshot(r,options){if(!isFundReport(r))return null;return validateFundSnapshot(JSON.parse(r.body),options);}
export function fundOverview(db,{asOf=today()}={}){
 const snapshots=[],invalid=[];
 for(const r of db.reports||[]){if(!isFundReport(r))continue;try{snapshots.push({report:r,snapshot:readFundSnapshot(r,{asOf})});}catch{invalid.push(r.id);}}
 snapshots.sort((a,b)=>b.snapshot.collectedAt.localeCompare(a.snapshot.collectedAt));const latest=snapshots[0];
 const funds=Object.keys(symbols).map(symbol=>{
  const all=snapshots.flatMap(s=>s.snapshot.funds.filter(f=>f.symbol===symbol).map(f=>({...f,collectedAt:s.snapshot.collectedAt,reportId:s.report.id})));
  all.sort((a,b)=>b.nav.date.localeCompare(a.nav.date)||b.collectedAt.localeCompare(a.collectedAt));const current=all[0]||null;
  const byDate=new Map();for(const f of all)if(!byDate.has(f.nav.date))byDate.set(f.nav.date,f.nav.value);
  const history=[...byDate].sort((a,b)=>a[0].localeCompare(b[0])).slice(-90).map(([date,value])=>({date,value}));
  return {symbol,underlyingSymbol:symbols[symbol],current,history,stale:!!current&&Date.parse(asOf)-Date.parse(current.nav.date)>10*86400000};
 });
 const calendar=snapshots.find(s=>s.snapshot.calendar)?.snapshot.calendar||null;
 return {funds,calendar:calendar?{...calendar,upcoming:calendar.upcoming.filter(r=>r.payDate>=asOf)}:null,latest:latest?.snapshot||null,invalid};
}
export function fundReportSummary(r){const s=readFundSnapshot(r);if(!s)return null;return ['운용사 공식자료 확인 '+s.collectedAt,'수치는 각 항목의 실제 기준일입니다. 분배율은 투자 수익률이 아니며 ROC는 잠정 추정치입니다.',...s.funds.map(f=>`${f.symbol} · NAV $${f.nav.value} (${f.nav.date}) · 최근 공시 분배금 $${f.distributions[0].amount}/주 · 추정 ROC ${f.distributions[0].rocPercent??'미확인'}%\n${f.sourceURL}`),s.errors.length?'일부 공식자료 조회 실패 · 이전 확인 자료는 유지합니다.':'수집한 세 ETF 자료의 형식·기준일·출처 검증 완료'].join('\n\n');}
export function mergeFundQuotes(db){
 let added=0;
 for(const {symbol,current:f} of fundOverview(db).funds){
  if(!f||!(db.holdings||[]).some(h=>h.symbol===symbol&&h.currency==='USD'&&h.qty>0&&h.verified!==false)&&!(db.recommendations||[]).some(r=>r.symbol===symbol&&r.currency==='USD'))continue;
  // Issuer close is a fallback, never NAV and never a replacement for an equal
  // or later dated user/provider quote. Source dates are not relabeled as today.
  if((db.quotes||[]).some(q=>q.symbol===symbol&&q.currency==='USD'&&q.date>=f.close.date))continue;
  db.quotes.push({symbol,currency:'USD',date:f.close.date,price:f.close.value,source:'YieldMax 운용사 공시 종가 · '+f.sourceURL,updated:f.collectedAt,provider:'yieldmax-official',changePercent:null});added++;
 }
 return added;
}
