// Separate, append-only reviews; original picks and personal cash ledgers never change.
const num=v=>typeof v==='number'&&Number.isFinite(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const text=v=>typeof v==='string'&&v.length<=2000;
const nowDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const RETURN_PERIODS=[7,30,90,180];
export function publicEvidenceURL(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&v.length<=2000&&![...u.searchParams.keys()].some(k=>/key|token|secret|signature|password|authorization/i.test(k));}catch{return false;}}
export function periodDue(date,days){
 if(!day(date)||!RETURN_PERIODS.includes(days))throw Error('성과 기간 오류');
 const d=new Date(date+'T00:00:00Z'),original=d.getUTCDate();
 if(days===7)d.setUTCDate(original+7);else{d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+days/30);d.setUTCDate(Math.min(original,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));}return d.toISOString().slice(0,10);
}
export function originalBaseline(r){return {symbol:r.symbol,currency:r.currency,price:r.price,priceDate:r.priceDate||r.date,date:r.date,benchmarkSymbol:r.benchmarkSymbol||'',benchmark:r.benchmark??null};}
export function baselineMatches(r,b){return !!b&&Object.entries(originalBaseline(r)).every(([k,v])=>v===b[k]);}
export function recommendationMarketDay(db,r){
 const source=(db.reports||[]).find(x=>x.id===r.originReportId),stamp=source?.created||r.created;
 if(!Number.isFinite(Date.parse(stamp)))return r.date;
 const local=zone=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
 return local('Asia/Seoul')===r.date?local(r.currency==='USD'?'America/New_York':'Asia/Seoul'):r.date;
}
export function reviewedPriceCutoff(db,r){
 const stamp=(db.reports||[]).find(x=>x.id===r.originReportId)?.created||r.created;
 const previous=d=>new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 if(!Number.isFinite(Date.parse(stamp))||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp))!==r.date)return r.currency==='USD'?previous(r.date):r.date;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:r.currency==='USD'?'America/New_York':'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp)).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day,minute=(Number(p.hour)%24)*60+Number(p.minute);return minute>=(r.currency==='USD'?960:990)?date:previous(date);
}
export function reviewableThrough(currency,now=new Date()){return reviewedPriceCutoff({reports:[]},{currency,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),created:now.toISOString()});}
export function actionRows(rows,allowedSymbols,from,through,currency){
 if(!Array.isArray(rows)||rows.length>2000)throw Error('권리 변동 내역은 2,000행 이하로 입력하세요');
 const seen=new Set(),number=v=>v===''||v==null?null:Number(v);
 return rows.map((r,i)=>{
  if(Object.keys(r).some(k=>!['symbol','type','date','currency','amount','newShares','oldShares','payDate','source','note'].includes(k)))throw Error(`${i+2}행: 지원하지 않는 CSV 열입니다. 양식을 확인하세요`);
  const e={symbol:String(r.symbol||'').trim().toUpperCase(),type:r.type,date:r.date,currency:r.currency||'',amount:number(r.amount),newShares:number(r.newShares),oldShares:number(r.oldShares),payDate:r.payDate||'',source:r.source||'',note:r.note||''};
  if(!allowedSymbols.includes(e.symbol)||!['SPLIT','DIVIDEND','UNRESOLVED'].includes(e.type)||!day(e.date)||e.date<from||(e.date===from&&e.type!=='UNRESOLVED')||e.date>through||!publicEvidenceURL(e.source)||!text(e.note)||(e.currency&&e.currency!==currency))throw Error(`${i+2}행: 종목·유형·통화·기준일 이후 날짜·공식 출처 확인 필요`);
  if(e.type==='SPLIT'&&(!(e.newShares>0)||!(e.oldShares>0)||!num(e.newShares)||!num(e.oldShares)||e.amount!==null||e.payDate))throw Error(`${i+2}행: 분할은 신주 수·구주 수만 입력하세요`);
  if(e.type==='DIVIDEND'&&(e.currency!==currency||!['USD','KRW'].includes(e.currency)||!num(e.amount)||e.amount<0||!day(e.payDate)||e.payDate<e.date||e.newShares!==null||e.oldShares!==null))throw Error(`${i+2}행: 배당은 거래 통화·당시 주당 세전 금액·지급일을 입력하세요`);
  if(e.type==='UNRESOLVED'&&(e.amount!==null||e.newShares!==null||e.oldShares!==null||e.payDate||!e.note.trim()))throw Error(`${i+2}행: 분사·합병 등 미해결 사건은 설명만 입력하세요`);
  // Same-symbol/day/type duplicates may be a conflicting correction or a special
  // dividend; do not silently sum or discard either interpretation.
  const key=[e.symbol,e.type,e.date].join('|');if(seen.has(key))throw Error(`${i+2}행: 같은 날·유형의 중복은 공식 합산 근거로 한 행에 정리하세요`);seen.add(key);return e;
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol)||a.type.localeCompare(b.type));
}
export function validateActionReviews(reviews){
 if(reviews===undefined)return;
 const fail=()=>{throw Error('성과 보정 검증 이력 형식 오류');};
 if(!Array.isArray(reviews)||reviews.length>100000)fail();const seen=new Map(),latest=new Map();
 for(const v of reviews){
  const b=v?.baseline;
  if(v?.format!=='MSL-PERFORMANCE-REVIEW'||v.version!==1||!text(v.id)||!v.id||seen.has(v.id)||!text(v.recId)||!v.recId||!text(v.createdAt)||!Number.isFinite(Date.parse(v.createdAt))||!day(v.asOf)||v.asOf>nowDay()||!day(v.through)||v.through>v.asOf||!publicEvidenceURL(v.coverageSource)||v.rawPricesConfirmed!==true||v.completeConfirmed!==true||typeof v.benchmarkConfirmed!=='boolean'||!text(v.note)||!day(v.marketRecDate)||!b||!text(b.symbol)||!b.symbol||!['KRW','USD'].includes(b.currency)||!num(b.price)||b.price<=0||!day(b.priceDate)||!day(b.date)||b.date>v.asOf||b.priceDate>v.marketRecDate||v.through<b.priceDate||!text(b.benchmarkSymbol)||!(b.benchmark===null||num(b.benchmark)))fail();
  if(v.benchmarkConfirmed&&(!b.benchmarkSymbol||!(b.benchmark>0)||b.benchmarkSymbol===b.symbol))fail();
  if(!day(v.priceCutoff)||b.priceDate>v.priceCutoff||v.priceCutoff>v.marketRecDate)fail();
  if(!day(v.observationCutoff)||v.through>v.observationCutoff||v.observationCutoff!==reviewableThrough(b.currency,new Date(v.createdAt)))fail();
  if(v.supersedes!==(latest.get(v.recId)||null))fail();
  if(!Array.isArray(v.events)||v.events.length>2000)fail();
  try{actionRows(v.events,[b.symbol,...v.benchmarkConfirmed?[b.benchmarkSymbol]:[]],b.priceDate,v.through,b.currency);}catch{fail();}
  if(!Array.isArray(v.observations)||v.observations.length>4)fail();const periods=new Set();
  for(const o of v.observations){if(!RETURN_PERIODS.includes(o.days)||periods.has(o.days)||!day(o.date)||o.date>v.observationCutoff||o.date<periodDue(b.date,o.days)||Date.parse(o.date)-Date.parse(periodDue(b.date,o.days))>7*86400000||!num(o.price)||o.price<=0||!(o.benchmark===null||num(o.benchmark))||!text(o.source))fail();periods.add(o.days);}
  seen.set(v.id,v.recId);latest.set(v.recId,v.id);
 }
}
export function createActionReview(db,recId,form,rows,{now=new Date()}={}){
 const r=(db.recommendations||[]).find(r=>r.id===recId);if(!r)throw Error('최초 추천 기록을 찾을 수 없습니다');
 const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),baseline=originalBaseline(r);
 if(!form.rawPricesConfirmed||!form.completeConfirmed)throw Error('미보정 가격과 전체 권리 변동 확인이 필요합니다');
 const observationCutoff=reviewableThrough(r.currency,now),through=form.through;if(!day(through)||through>observationCutoff||through<baseline.priceDate)throw Error('확정 종가일 이내의 검증 기간을 확인하세요');
 const priceCutoff=reviewedPriceCutoff(db,r);if(baseline.priceDate>priceCutoff)throw Error('추천 공개 시점에 확정된 종가의 거래일인지 먼저 확인하세요. 이후 종가로 과거 기준을 보정하지 않습니다');
 const events=actionRows(rows,[baseline.symbol,...form.benchmarkConfirmed?[baseline.benchmarkSymbol]:[]],baseline.priceDate,through,baseline.currency),observations=[];
 for(const days of RETURN_PERIODS){const due=periodDue(r.date,days);const o=(r.observations||[]).filter(o=>o.date>=due&&o.date<=observationCutoff&&Date.parse(o.date)-Date.parse(due)<=7*86400000).sort((a,b)=>a.date.localeCompare(b.date))[0];if(o)observations.push({days,date:o.date,price:o.price,benchmark:o.benchmark??null,source:o.source});}
 const review={format:'MSL-PERFORMANCE-REVIEW',version:1,id:crypto.randomUUID(),recId,createdAt:now.toISOString(),asOf,through,priceCutoff,observationCutoff,marketRecDate:recommendationMarketDay(db,r),baseline,rawPricesConfirmed:true,completeConfirmed:true,benchmarkConfirmed:!!form.benchmarkConfirmed,coverageSource:form.coverageSource,note:form.note||'',events,observations,supersedes:(db.actionReviews||[]).filter(v=>v.recId===recId).at(-1)?.id||null};
 validateActionReviews([...(db.actionReviews||[]),review]);return review;
}
function cashFlow(review,symbol,basePrice,close,date){
 const events=review.events.filter(e=>e.symbol===symbol&&e.date<=date);
 if(events.some(e=>e.date>review.baseline.priceDate&&e.date<=review.marketRecDate))return {status:'blocked',reason:'기준가 이후·추천 공개일 이전의 권리 변동: 기준가 시점 재검증 필요'};
 if(events.some(e=>e.type==='UNRESOLVED'))return {status:'blocked',reason:'분사·합병 등 미해결 권리 변동'};
 if(events.some(e=>e.type==='SPLIT'&&events.some(d=>d.type==='DIVIDEND'&&d.date===e.date)))return {status:'blocked',reason:'같은 날 분할·배당의 주당 단위 확인 필요'};
 let shares=1,paid=0,receivable=0;
 for(const e of events){if(e.type==='SPLIT')shares*=e.newShares/e.oldShares;else if(e.type==='DIVIDEND'){const amount=shares*e.amount;if(e.payDate<=date)paid+=amount;else receivable+=amount;}}
 const value=shares*close,total=value+paid+receivable;
 if(![shares,paid,receivable,value,total].every(num)||shares<=0)return {status:'blocked',reason:'계산 범위를 벗어난 권리 변동'};
 const returns={priceReturn:(close/basePrice-1)*100,splitPriceReturn:(value/basePrice-1)*100,totalReturn:(total/basePrice-1)*100};
 if(!Object.values(returns).every(num))return {status:'blocked',reason:'수익률 계산 범위를 벗어난 가격'};
 return {status:'ready',shares,value,paid,receivable,...returns};
}
export function reviewedReturns(review){
 validateActionReviews([{...review,supersedes:null}]);
 return RETURN_PERIODS.map(days=>{
  const due=periodDue(review.baseline.date,days),o=review.observations.find(o=>o.days===days),base={days,due};
  if(!o)return {...base,status:'awaiting',reason:due>review.asOf?'검증 당시 목표일 전':'검증 당시 관측 가격 없음'};
  if(o.date>review.through)return {...base,date:o.date,status:'blocked',reason:'관측일까지 권리 변동 검증 기간 연장 필요'};
  const result=cashFlow(review,review.baseline.symbol,review.baseline.price,o.price,o.date);
  let excess=null,benchmarkReason='동일 기간 비교자산 미확인';
  if(result.status==='ready'&&review.benchmarkConfirmed&&o.benchmark>0){const b=cashFlow(review,review.baseline.benchmarkSymbol,review.baseline.benchmark,o.benchmark,o.date);if(b.status==='ready'){excess=result.totalReturn-b.totalReturn;benchmarkReason='동일 날짜·같은 세전 미재투자 기준';}else benchmarkReason=b.reason;}
  return {...base,date:o.date,close:o.price,...result,excess,benchmarkReason};
 });
}
export function appendActionReview(db,review){
 const r=db.recommendations.find(r=>r.id===review.recId);if(!r||!baselineMatches(r,review.baseline))throw Error('최초 추천 기준이 달라져 저장을 중지했습니다');
 const previous=(db.actionReviews||[]).filter(v=>v.recId===r.id).at(-1)?.id||null;if(previous!==review.supersedes)throw Error('다른 보정 이력이 추가됐습니다. 다시 검토하세요');
 validateActionReviews([...(db.actionReviews||[]),review]);db.actionReviews??=[];db.actionReviews.push(structuredClone(review));return review.id;
}
