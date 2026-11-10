// Derived views only: source statement rows and existing manual records stay intact.
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const value=v=>number(v)?Number(v):null;
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const nowDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const sum=(rows,key)=>rows.reduce((s,r)=>s+(r[key]??0),0);
const near=(a,b)=>Math.abs(a-b)<.000001;
const sourceMoney=(r,k,reference=false)=>value(r.fields[k]?.[reference?'krw':r.currency.toLowerCase()]);
export function statementAssets(db){const assets=new Map();for(const a of db.statementArchives||[])for(const r of a.package.events)if(r.securityId&&!assets.has(r.securityId))assets.set(r.securityId,{securityId:r.securityId,symbol:r.symbol,name:r.securityName,currency:r.currency});return [...assets.values()];}
function rawTaxes(db){const seen=new Set();return (db.statementArchives||[]).flatMap(a=>a.package.taxAdjustments.map(t=>({...t,archiveId:a.id,amount:Number(t.cash)}))).filter(t=>{if(seen.has(t.eventKey))return false;seen.add(t.eventKey);return true;});}
export function validateTaxAllocations(allocations,archives){
 if(allocations===undefined)return;
 if(!Array.isArray(allocations)||allocations.length>10000)throw Error('세금 분류 기록 오류');
 const db={statementArchives:archives||[]},taxes=rawTaxes(db),assets=new Set(statementAssets(db).map(a=>a.securityId)),ids=new Set();
 for(const a of allocations){
  if(!a||Object.keys(a).some(k=>!['id','archiveId','eventKey','parts','evidence','created'].includes(k))||typeof a.id!=='string'||ids.has(a.id)||typeof a.created!=='string'||!Number.isFinite(Date.parse(a.created))||typeof a.evidence!=='string'||a.evidence.trim().length<3||a.evidence.length>2000||!Array.isArray(a.parts))throw Error('세금 분류 근거·구조 오류');
  const t=taxes.find(t=>t.archiveId===a.archiveId&&t.eventKey===a.eventKey);
  if(!t||t.securityId!==null)throw Error('원문에서 종목이 미분류인 세금만 배분할 수 있습니다');
  const used=new Set();let allocated=0;
  for(const p of a.parts){if(!p||Object.keys(p).some(k=>!['securityId','amount'].includes(k))||!assets.has(p.securityId)||used.has(p.securityId)||typeof p.amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(p.amount)||!(Number(p.amount)>0)||(t.currency==='KRW'&&!Number.isInteger(Number(p.amount))))throw Error('세금 배분 종목·금액 오류');used.add(p.securityId);allocated+=Number(p.amount);}
  if(allocated>Math.abs(t.amount)+.000001)throw Error('배분 합계가 원문 세금을 초과합니다');ids.add(a.id);
 }
}
export function taxLedger(db){
 const active=new Map();for(const a of db.taxAllocations||[])active.set(a.archiveId+':'+a.eventKey,a);
 return rawTaxes(db).map(t=>{const a=active.get(t.archiveId+':'+t.eventKey),parts=t.securityId?[{securityId:t.securityId,amount:t.amount}]:a?.parts.map(p=>({securityId:p.securityId,amount:Math.sign(t.amount)*Number(p.amount)}))||[];return {...t,parts,unallocated:t.amount-sum(parts,'amount'),classification:a||null};});
}
export function allocationRevision(db,{archiveId,eventKey,securityId,amount,evidence}){
 const tax=taxLedger(db).find(t=>t.archiveId===archiveId&&t.eventKey===eventKey);if(!tax||tax.securityId!==null)throw Error('미분류 원문 세금을 선택하세요');
 const parts=(tax.classification?.parts||[]).filter(p=>p.securityId!==securityId).map(p=>({...p}));if(Number(amount)>0)parts.push({securityId,amount:String(amount)});
 const revision={id:crypto.randomUUID(),archiveId,eventKey,parts,evidence:evidence.trim(),created:new Date().toISOString()};validateTaxAllocations([...(db.taxAllocations||[]),revision],db.statementArchives);return revision;
}
export function incomeEntries(db,asOf=nowDay()){
 const archives=db.statementArchives||[],out=[],seen=new Set();let suppressedManual=0,scheduled=0;
 for(const a of archives){const refs=new Map(a.package.events.map(e=>[e.recordId,e]));for(const d of a.package.dividends){if(d.date>asOf||seen.has(d.eventKey))continue;seen.add(d.eventKey);const r=refs.get(d.sourceRecordId);out.push({id:d.eventKey,archiveId:a.id,date:d.date,symbol:d.symbol||d.securityId||'UNCLASSIFIED',securityId:d.securityId,name:d.name||'종목 미분류',currency:d.currency,gross:Number(d.gross),tax:Number(d.tax),net:Number(d.net),krwReference:sourceMoney(r,'settled',true),source:'statement',derivedGross:d.grossDerivedFromNetAndTax,kind:d.kind,sourceRecordId:d.sourceRecordId});}}
 for(const d of db.dividends||[]){if(d.date>asOf||d.status==='scheduled'){scheduled++;continue;}if(archives.some(a=>a.package.periodStart<=d.date&&d.date<=a.package.periodEnd)){suppressedManual++;continue;}out.push({id:d.id,date:d.date,symbol:d.symbol,securityId:null,name:d.symbol,currency:d.currency,gross:d.gross,tax:d.tax,net:d.gross-d.tax,krwReference:d.currency==='KRW'?d.gross-d.tax:number(d.fx)&&d.fx>0?(d.gross-d.tax)*d.fx:null,source:'manual',kind:'직접 등록',sourceRecordId:null});}
 return {entries:out.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),suppressedManual,scheduled};
}
export function incomeSummary(db,{asOf=nowDay(),year=null}={}){
 const all=incomeEntries(db,asOf),entries=all.entries.filter(d=>!year||d.date.startsWith(year)),assets=new Map(),periods=new Map();
 const add=(group,key,r)=>{if(!group.has(key))group.set(key,{key,currency:r.currency,symbol:r.symbol,name:r.name,gross:0,tax:0,net:0,krwReference:0,missingReference:0,count:0});const g=group.get(key);g.gross+=r.gross;g.tax+=r.tax;g.net+=r.net;g.count++;if(r.krwReference===null)g.missingReference++;else g.krwReference+=r.krwReference;};
 for(const r of entries){add(assets,r.symbol+':'+r.currency,r);for(const period of [r.date.slice(0,4),r.date.slice(0,7)])add(periods,period+':'+r.currency,r);}
 const native={KRW:0,USD:0};for(const r of entries)native[r.currency]+=r.net;
 const taxes=taxLedger(db).filter(t=>t.date<=asOf&&(!year||t.date.startsWith(year))),unallocated={KRW:0,USD:0};for(const t of taxes)unallocated[t.currency]+=t.unallocated;
 return {...all,entries,assets:[...assets.values()].sort((a,b)=>b.krwReference-a.krwReference),periods:[...periods.values()].sort((a,b)=>b.key.localeCompare(a.key)),native,referenceTotal:sum(entries,'krwReference'),missingReference:entries.filter(r=>r.krwReference===null).length,taxes,unallocated};
}
export function coveredReturn(db,h,{asOf=nowDay()}={}){
 const fail=reason=>({available:false,reason,symbol:h.symbol});
 const archives=(db.statementArchives||[]).slice().sort((a,b)=>a.package.periodStart.localeCompare(b.package.periodStart));
 if(!archives.length)return fail('거래내역서 원장 미등록');
 const matches=archives.flatMap(a=>a.package.positions.filter(p=>p.symbol===h.symbol&&p.currency===h.currency).map(p=>({p,a})));const latest=matches.at(-1);
 if(!latest)return fail('원장에 해당 종목의 잔존 원가 없음');
 const {p,a}=latest,securityId=p.securityId;
 if(h.verified===false)return fail('상품 식별 확인 필요');
 if(!near(Number(p.qty),h.qty))return fail('현재 수량이 원장 잔고와 다름 · 최신 거래내역 확인 필요');
 if((db.trades||[]).some(t=>t.symbol===h.symbol&&(!t.date||t.date>a.package.periodEnd)))return fail('원장 이후 또는 일자 미확인 매매가 있음 · 최신 원장과 대조 필요');
 const rows=archives.flatMap(a=>a.package.events).filter(r=>r.securityId===securityId&&r.date<=asOf),trades=rows.filter(r=>r.category==='trade'),moves=rows.filter(r=>r.category==='trade'||r.category==='corporate_action');
 if(!trades.length)return fail('최초 매수 이력 필요');
 const first=moves[0],opening=Number(first.fields.balance_qty)-Number(first.fields.qty)*(first.kind==='구매'||first.kind==='주식병합입고'?1:-1);
 if(!near(opening,0))return fail('자료 시작 전 보유 원가 미확인');
 const ending=opening+moves.reduce((s,r)=>s+Number(r.fields.qty)*(r.kind==='구매'||r.kind==='주식병합입고'?1:-1),0);
 if(!near(ending,h.qty))return fail('원장 전체 수량과 현재 수량 불일치');
 const q=(db.quotes||[]).filter(q=>q.symbol===h.symbol&&q.currency===h.currency&&dateOK(q.date)&&q.date<=asOf&&q.price>0).sort((x,y)=>y.date.localeCompare(x.date)||(y.updated||'').localeCompare(x.updated||''))[0];
 if(!q)return fail('가격·거래일·출처가 있는 시세 필요');
 const lastTrade=trades.map(r=>r.date).sort().at(-1);if(q.date<lastTrade)return fail('시세가 마지막 원장 매매보다 오래됨');
 const buys=trades.filter(r=>r.kind==='구매').reduce((s,r)=>s+sourceMoney(r,'settled'),0),sells=trades.filter(r=>r.kind==='판매').reduce((s,r)=>s+sourceMoney(r,'settled'),0),corporate=rows.filter(r=>r.category==='corporate_fractional_proceeds').reduce((s,r)=>s+sourceMoney(r,'settled'),0);
 if(!(buys>0)||!number(p.costIncludingCharges))return fail('정산 원가 미확인');
 const income=incomeEntries(db,asOf),distributions=income.entries.filter(d=>d.currency===h.currency&&(d.securityId===securityId||d.source==='manual'&&d.symbol===h.symbol));
 const taxes=taxLedger(db).filter(t=>t.date<=asOf),assetTaxes=taxes.flatMap(t=>t.parts.filter(p=>p.securityId===securityId).map(p=>({...t,allocatedAmount:p.amount}))),taxNative=assetTaxes.filter(t=>t.currency===h.currency).reduce((s,t)=>s+t.allocatedAmount,0),taxKrw=assetTaxes.filter(t=>t.currency==='KRW'&&h.currency!=='KRW').reduce((s,t)=>s+t.allocatedAmount,0);
 const outstanding=taxes.filter(t=>Math.abs(t.unallocated)>.000001),remainingCost=Number(p.costIncludingCharges),valueNow=q.price*h.qty,received=sum(distributions,'net'),profit=valueNow+sells+corporate+received+taxNative-buys;
 let flowReference=0,missingReference=0;
 for(const r of rows.filter(r=>r.category==='trade'||r.category==='corporate_fractional_proceeds')){const v=sourceMoney(r,'settled',true);if(v===null)missingReference++;else flowReference+=v*(r.kind==='구매'?-1:1);}
 for(const d of distributions){if(d.krwReference===null)missingReference++;else flowReference+=d.krwReference;}
 for(const t of assetTaxes){if(t.currency==='KRW')flowReference+=t.allocatedAmount;else{const r=archives.flatMap(a=>a.package.events).find(r=>r.eventKey===t.eventKey);const ref=r?sourceMoney(r,'settled',true):null;if(ref===null)missingReference++;else flowReference+=ref*Math.sign(t.amount)*(t.allocatedAmount/t.amount);}}
 const fx=h.currency==='KRW'?1:number(db.fx?.rate)&&db.fx.rate>0?db.fx.rate:null,profitKrw=fx!==null&&!missingReference?valueNow*fx+flowReference:null;
 return {available:true,symbol:h.symbol,securityId,currency:h.currency,qty:h.qty,buys,sells,corporate,distributions:received,taxNative,taxKrw,remainingCost,value:valueNow,unrealized:valueNow-remainingCost,realized:sells+corporate-buys+remainingCost,profitNativeBeforeKrwTax:profit,returnPercentBeforeKrwTax:profit/buys*100,profitKrwReference:profitKrw,missingReference,fx:db.fx||null,quote:q,periodStart:archives[0].package.periodStart,periodEnd:a.package.periodEnd,unallocatedTaxes:outstanding,provisional:outstanding.length>0,manualOverlapsExcluded:income.suppressedManual};
}
