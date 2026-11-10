import {reviewedEvidence,evidenceText} from './research.js?v=2.3.1';
import {known,today,validDate,quote,valuation,krw} from './core.js?v=2.3.1';
export const RELEASE='2.3.1';
export function normalize(db){
 db.preferences??={autoRefresh:false,reportOnOpen:false};
 db.providers??={};
 for(const id of ['av','fsc']){db.providers[id]??={key:'',accepted:false,attempts:[],fetched:{}};db.providers[id].attempts??=[];db.providers[id].fetched??={};}
 db.etfFacts??=[];db.researchCandidates??=[];
 return db;
}
export function safeNumber(v,{positive=false,nullable=false}={}){
 if(nullable&&(v==null||v===''))return null;
 if(v==null||v==='')throw Error('필수 숫자 누락');
 const n=Number(String(v).replace(/,/g,''));
 if(!Number.isFinite(n)||(positive&&n<=0))throw Error('유효하지 않은 숫자');return n;
}
export function alphaQuote(raw,symbol,now=today()){
 if(raw.Information||raw.Note||raw['Error Message'])throw Error('제공자 한도·키·종목 오류. 설정에서 제공자 응답을 확인하세요.');
 const q=raw['Global Quote'];
 if(!q||q['01. symbol']!==symbol)throw Error('요청 종목과 응답 종목이 다릅니다');
 const date=q['07. latest trading day'];
 if(!validDate(date)||date>now)throw Error('유효하지 않은 거래일');
 return {symbol,currency:'USD',price:safeNumber(q['05. price'],{positive:true}),date,source:'Alpha Vantage GLOBAL_QUOTE · 일별 종가',sourceUrl:'https://www.alphavantage.co/documentation/#latestprice',updated:new Date().toISOString(),provider:'av',changePercent:q['10. change percent']?safeNumber(q['10. change percent'].replace('%','')):null,previousClose:safeNumber(q['08. previous close'],{nullable:true}),timing:'end-of-day'};
}
export function fscQuotes(raw,symbol=null,now=today()){
 const response=raw.response??raw;
 if(!response.header||!['00','0'].includes(String(response.header.resultCode)))throw Error('공공데이터 인증·조회 오류');
 let items=response.body?.items?.item??[];if(!Array.isArray(items))items=[items];
 const rows=items.filter(x=>!symbol||String(x.srtnCd).replace(/^A/,'')===symbol).map(x=>{
  const code=String(x.srtnCd).replace(/^A/,'');const date=String(x.basDt).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  if(!/^[0-9A-Z]{6}$/.test(code)||!validDate(date)||date>now)throw Error('공공데이터 종목·기준일 오류');
  return {symbol:code,currency:'KRW',price:safeNumber(x.clpr,{positive:true}),date,source:'금융위원회·한국거래소 주식시세정보 · 공공데이터포털',sourceUrl:'https://www.data.go.kr/data/15094808/openapi.do',updated:new Date().toISOString(),provider:'fsc',changePercent:safeNumber(x.fltRt,{nullable:true}),timing:'end-of-day-delayed'};
 });
 return rows.sort((a,b)=>b.date.localeCompare(a.date));
}
export function upsertQuote(db,q){
 const i=db.quotes.findIndex(x=>x.symbol===q.symbol&&x.currency===q.currency&&x.date===q.date&&x.provider===q.provider);
 if(i<0)db.quotes.push(q);else db.quotes[i]=q;
}
export function requestBudget(provider,now=Date.now()){
 return provider.attempts.filter(t=>t>now-86400000&&t<=now).length;
}
export function effectiveRealized(t){if(t.date&&t.date>today())return null;return known(t.realized)?t.realized:known(t.calculatedRealized)?t.calculatedRealized:null;}
export function replayInventory(db,h){
 const b=h.inventory;
 if(!b||!validDate(b.date))throw Error('먼저 기준일의 실제 잔고를 설정하세요');
 let qty=b.qty,avg=b.avg;const changes=[];
 const eligible=db.trades.map((t,index)=>({t,index})).filter(({t})=>t.symbol.toUpperCase()===h.symbol.toUpperCase()&&t.date>b.date&&t.date<=today()).sort((a,b)=>a.t.date.localeCompare(b.t.date)||a.index-b.index);
 for(const {t} of eligible){
  if(t.currency!==h.currency)throw Error('거래 통화가 기준 잔고와 다릅니다: '+t.date);
  if(!(t.price>0)||!(t.qty>0)||!known(t.fee)||t.fee<0)throw Error('체결가·수량·수수료가 미확인입니다: '+t.date);
  let realized=null;
  if(t.side==='BUY'){
   avg=(qty===0||known(avg))?((qty===0?0:qty*avg)+t.qty*t.price+t.fee)/(qty+t.qty):null;
   qty+=t.qty;
  }else{
   if(t.qty>qty+1e-8)throw Error('매도 수량이 잔고를 초과합니다: '+t.date);
   realized=known(avg)?t.qty*(t.price-avg)-t.fee:null;qty-=t.qty;if(Math.abs(qty)<1e-8){qty=0;avg=null;}
  }
  changes.push({id:t.id,qty,avg,realized,date:t.date});
 }
 return {qty,avg,changes,base:b};
}
export function paidDividends(db,asOf=today()) {return db.dividends.filter(d=>d.date<=asOf&&d.status!=='scheduled');}
export function totalReturn(db,h){
 const q=quote(db,h);const fail=reason=>({complete:false,reason});
 if(!h.fullHistoryConfirmed)return fail('전체 매매·분배금 이력 확인 전');
 if(!q||h.verified===false)return fail('평가 가격·상품 미확인');
 const ts=db.trades.filter(t=>t.symbol===h.symbol),ds=db.dividends.filter(d=>d.symbol===h.symbol);
 if(!ts.length)return fail('전체 매매 기록 필요');
 if(ts.some(t=>!t.date||t.date>q.date||t.currency!==h.currency||!known(t.price)||t.price<=0||!known(t.fee)||t.fee<0))return fail('거래일·통화·체결가·수수료 또는 평가 기준일 확인 필요');
 let buys=0,sells=0,balance=0;
 for(const t of ts.slice().sort((a,b)=>a.date.localeCompare(b.date))){
  if(t.side==='BUY'){buys+=t.qty*t.price+t.fee;balance+=t.qty;}else{sells+=t.qty*t.price-t.fee;balance-=t.qty;}
  if(balance<-1e-6)return fail('전체 이력에서 보유 수량이 음수가 됩니다');
 }
 if(Math.abs(balance-h.qty)>1e-6||!(buys>0))return fail('장부와 현재 수량 불일치 · 분할/병합·입출고 확인 필요');
 const paid=ds.filter(d=>d.date<=q.date&&d.status!=='scheduled');
 if(paid.some(d=>d.currency!==h.currency))return fail('분배금 통화가 다릅니다');
 const distributions=paid.reduce((s,d)=>s+d.gross-d.tax,0),value=q.price*h.qty;
 return {complete:true,profit:value+sells+distributions-buys,returnPercent:(value+sells+distributions-buys)/buys*100,buys,sells,distributions,value,currency:h.currency,date:q.date};
}
export function dividendSummary(db){
 const groups=new Map(),symbols=new Map();let converted=0,missing=0;
 for(const d of paidDividends(db)){
  const net=krw(d.gross-d.tax,d.currency,d.fx),m=d.date.slice(0,7),y=d.date.slice(0,4);
  for(const k of [m,y]){if(!groups.has(k))groups.set(k,{net:0,missing:0});let g=groups.get(k);if(known(net))g.net+=net;else g.missing++;}
  if(known(net)){converted+=net;symbols.set(d.symbol,(symbols.get(d.symbol)||0)+net);}else missing++;
 }
 return {periods:[...groups].sort((a,b)=>b[0].localeCompare(a[0])),symbols:[...symbols].map(([symbol,net])=>({symbol,net,weight:converted>0?net/converted*100:null})),converted,missing};
}
export function autoObserve(db){
 let added=0;
 for(const r of db.recommendations){
  const q=quote(db,{symbol:r.symbol,currency:r.currency});
  if(!q||q.date<=r.date||r.observations.some(o=>o.date===q.date))continue;
  const benchmark=r.benchmarkSymbol?quote(db,{symbol:r.benchmarkSymbol,currency:r.currency}):null;
  r.observations.push({date:q.date,price:q.price,benchmark:benchmark?.date===q.date?benchmark.price:null,source:q.source,benchmarkSource:benchmark?.date===q.date?benchmark.source:null,created:new Date().toISOString(),automatic:true});added++;
 }
 return added;
}
export function buildReport(db,market,{automatic=false,now=new Date()}={}){
 const hs=db.holdings.filter(h=>h.market===market&&h.qty>0),valuations=hs.map(h=>({h,...valuation(db,h)}));
 const dates=valuations.map(v=>v.q?.date).filter(Boolean),asOf=dates.length?dates.slice().sort().at(-1):today();
 if(automatic){
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  if(time<(market==='KR'?'16:30':'08:00'))return {skip:'목표 시각 전입니다'};
  if(!hs.length||dates.length!==hs.length||new Set(dates).size!==1||valuations.some(v=>v.h.verified===false))return {skip:'동일 거래일의 전체 보유 시세가 필요합니다'};
  if((now-new Date(asOf+'T00:00:00Z'))>4*86400000)return {skip:'시세가 오래되어 자동 보고서를 보류합니다'};
  if(db.reports.some(r=>r.automationKey===`${market}:${asOf}`))return {skip:'해당 거래일 보고서가 이미 있습니다'};
 }
 const evidence=hs.map(h=>reviewedEvidence(db,h.symbol,market,asOf)).filter(Boolean);
 const previous=db.reports.filter(r=>r.market===market&&r.date<asOf).sort((a,b)=>b.date.localeCompare(a.date))[0];
 const decisions=hs.map(h=>({symbol:h.symbol,judgment:'판단 보류',reason:'시점이 다른 저장 근거의 최신성·전체 자료 검증 필요'}));
 const lines=[`보고서 기준 거래일: ${asOf}`,`생성: ${now.toISOString()} · ${automatic?'앱을 연 뒤 목표 시각 이후 실행':'사용자 직접 실행'} · 규칙형 분석 (AI 생성 아님)`,...valuations.map(v=>`${v.h.name} (${v.h.symbol})\n종가: ${v.q?`${v.q.price} ${v.h.currency} · 거래일 ${v.q.date} · 출처 ${v.q.source}`:'미확인'}\n등락률: ${known(v.q?.changePercent)?v.q.changePercent+'%':'미확인'}\n평가액(KRW): ${known(v.value)?v.value:'미확인'} · 평가손익: ${known(v.pnl)?v.pnl:'미확인'}\n판단: 보류. 최신 실적·공시·뉴스·수급의 독립 검증이 필요합니다.`),market==='US'?`환율: ${db.fx?`${db.fx.rate} KRW/USD · ${db.fx.date} · ${db.fx.source}`:'미확인'}\n주요 지수·연준·고용·물가·산업 동향: 검증 자료 없음`:'공시·분기/연간 실적·외국인/기관·업종/정책: 검증 자료 없음',`이전 보고서: ${previous?previous.date+' '+previous.title:'없음'}`,previous?.decisions?'이전 자동 판단과 비교: 판단 보류 유지. 새로운 검증 근거가 없어 변경하지 않음.':'이전 판단 자동 비교: 구조화된 이전 판단 없음. 보관함에서 원문 확인 필요.','신규 종목: 오늘은 신규 매수 추천 없음','위험: 미확인 매수가, 자료 기준일 차이, 달러 환율, 커버드콜 ETF 원금 잠식 가능성. 분배금과 투자 수익은 다릅니다.','최종 결론: 신규 매매 판단 보류. 현금 보유액·종목 편중과 원금 변동 위험을 점검하세요.'];
 if(evidence.length)lines.push('저장된 분석 근거 (발표일·검토일 기준, 자동 최신 검증 아님)',...evidence.map(e=>evidenceText(e)+(new Date(asOf)-new Date(e.reviewDate)>30*86400000?'\n주의: 검토 후 30일이 지난 자료입니다. 새 공시·뉴스를 확인하세요.':'')));
 return {report:{id:crypto.randomUUID(),market,date:asOf,title:`${market==='KR'?'국내':'미국'}주식 ${asOf} 규칙형 점검`,source:'금고 내 시세·거래 기록 · 규칙형',created:now.toISOString(),body:lines.join('\n\n'),decisions,...(automatic?{automationKey:`${market}:${asOf}`}:{})}};
}
export function importBalances(rows){
 const seen=new Set();return rows.map((r,i)=>{
  const symbol=String(r.symbol||'').trim().toUpperCase(),market=r.market,currency=r.currency;
  if(!symbol||!r.name||!['KR','US'].includes(market)||currency!==(market==='KR'?'KRW':'USD')||seen.has(symbol))throw Error(`${i+2}행 종목·시장·통화·중복 오류`);
  seen.add(symbol);const qty=safeNumber(r.qty),avg=safeNumber(r.avg,{positive:true,nullable:true});if(qty<0)throw Error('잔고 수량은 음수일 수 없습니다');
  return {id:crypto.randomUUID(),symbol,name:r.name,market,currency,qty,avg,verified:r.verified==='true',importSource:'사용자 확인 잔고 CSV'};
 });
}
export function invalidateInventory(db,symbol){
 for(const t of db.trades)if(t.symbol===symbol){delete t.calculatedRealized;delete t.calculationMethod;}
 const h=db.holdings.find(h=>h.symbol===symbol);if(h)delete h.reconciledAt;
}
export function rankResearch(db,now=new Date()){
 const scored=(db.researchCandidates||[]).map(r=>{
  const fetched=quote(db,r),q=fetched&&fetched.date>=r.priceDate?fetched:null,priceDate=q?.date||r.priceDate,price=q?.price??r.price;
  const metrics=[r.revenueGrowth,r.operatingProfit,r.profitGrowth,r.per,r.roe,r.debtRatio];
  const missing=!r.source||!validDate(r.fiscalDate)||!validDate(priceDate)||!known(price)||price<=0||metrics.some(v=>!known(v))||!r.catalysts||!r.risks||!r.failure;
  const stale=!missing&&(new Date(priceDate+'T00:00:00Z')>now||new Date(r.fiscalDate+'T00:00:00Z')>now||(now-new Date(priceDate+'T00:00:00Z'))>7*86400000||(now-new Date(r.fiscalDate+'T00:00:00Z'))>450*86400000);
  let score=0;const criteria=[];
  for(const [label,pass] of [['매출 성장률 10% 이상',r.revenueGrowth>=10],['영업이익 양수·성장률 10% 이상',r.operatingProfit>0&&r.profitGrowth>=10],['PER 0 초과·25 이하',r.per>0&&r.per<=25],['ROE 10% 이상',r.roe>=10],['부채비율 100% 이하',known(r.debtRatio)&&r.debtRatio>=0&&r.debtRatio<=100]]){if(pass)score++;criteria.push({label,pass});}
  return {...r,price,priceDate,score,criteria,eligible:!missing&&!stale&&r.operatingProfit>0&&r.roe>0&&score>=4,reason:missing?'필수 재무·가격·근거 누락':stale?'자료 기준일 갱신 필요':score>=4?'동일 규칙 기준 연구 후보':'선별 기준 미충족',held:db.holdings.some(h=>h.symbol===r.symbol&&h.qty>0)};
 });
 return {all:scored,KR:scored.filter(r=>r.market==='KR'&&r.eligible&&!r.held).sort((a,b)=>b.score-a.score).slice(0,2),US:scored.filter(r=>r.market==='US'&&r.eligible&&!r.held).sort((a,b)=>b.score-a.score).slice(0,2)};
}
