// Sanitized, reviewed statement ledgers stay inside the encrypted device vault.
// Source amounts remain decimal strings. They never become generic trade fees.
const FORMAT='MY-STOCK-LAB-STATEMENT-PACKAGE';
const decimal=/^-?\d+(?:\.\d+)?$/,hash=/^[a-f0-9]{64}$/;
const kinds={구매:'trade',판매:'trade',배당금입금:'dividend',외화증권배당금입금:'dividend',분배금:'dividend',외화배당단주대금입금:'dividend',배당세출금:'dividend_tax_adjustment',외국납부세액출금:'dividend_tax_adjustment',외화세금환급:'dividend_tax_adjustment',외화주식병합단주대금입금:'corporate_fractional_proceeds',주식병합입고:'corporate_action',주식병합출고:'corporate_action',이자입금:'interest',외화이자입금:'interest',외화이자세금출금:'interest',캐시백입금:'cashback'};
const columns=['fx','qty','amount','settled','price','fee','trade_tax','tax','repayment','balance_qty','cash_balance'];
const fail=()=>{throw Error('거래내역 검토 파일의 구조·금액·대조 결과를 확인하세요');};
const num=v=>typeof v==='string'&&v.length<=80&&decimal.test(v)&&Number.isFinite(Number(v));
const text=v=>typeof v==='string'&&v.length<=2000;
const cur=v=>v==='KRW'||v==='USD';
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const only=(o,keys)=>{if(!o||Array.isArray(o)||typeof o!=='object'||Object.keys(o).some(k=>!keys.includes(k)))fail();};
const amount=(r,k)=>Number(r.fields[k]?.[r.currency.toLowerCase()]);
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
async function digest(v){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))))),x=>x.toString(16).padStart(2,'0')).join('');}
function numericTree(v){if(v===null)return;if(Array.isArray(v)){for(const x of v)numericTree(x);return;}if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){if(!/^[\w:-]+$/.test(k))fail();numericTree(x);}return;}if(!(num(v)||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||text(v)))fail();}
export function validateStatementPackage(p){
 only(p,['format','version','periodStart','periodEnd','documents','events','positions','dividends','taxAdjustments','monthly','yearly','income','incomeCounts','cashBalances','checks','errors','dateBasis','realizedBasis','warnings','securityTotals']);
 if(p.format!==FORMAT||p.version!==1||!day(p.periodStart)||!day(p.periodEnd)||p.periodStart>p.periodEnd||!Array.isArray(p.documents)||!p.documents.length||p.documents.length>100||!Array.isArray(p.events)||!p.events.length||p.events.length>20000||!Array.isArray(p.errors)||p.errors.length||!Array.isArray(p.positions)||p.positions.length>1000)fail();
 const docs=new Map(),docRows=new Map();let end;
 for(const d of p.documents){only(d,['document','sha256','periodStart','periodEnd','pages','pageRowCounts']);if(!Number.isInteger(d.document)||docs.has(d.document)||!hash.test(d.sha256)||!day(d.periodStart)||!day(d.periodEnd)||d.periodStart>d.periodEnd||!Number.isInteger(d.pages)||d.pages<1||!Array.isArray(d.pageRowCounts)||d.pageRowCounts.length!==d.pages||d.pageRowCounts.some(x=>!Number.isInteger(x)||x<0))fail();if(end&&new Date(Date.parse(end+'T00:00:00Z')+86400000).toISOString().slice(0,10)!==d.periodStart)fail();end=d.periodEnd;docs.set(d.document,d);docRows.set(d.document,Array(d.pages).fill(0));}
 if(p.documents[0].periodStart!==p.periodStart||end!==p.periodEnd)fail();
 const seen=new Set(),keys=new Set(),positions=new Map(),counts={};
 for(const r of p.events){
  only(r,['recordId','document','page','row','date','kind','securityId','securityName','currency','fields','absentColumns','parseIssues','category','symbol','eventKey']);
  const d=docs.get(r.document);if(!d||!Number.isInteger(r.page)||r.page<1||r.page>d.pages||!Number.isInteger(r.row)||r.row<1||r.recordId!==`toss:${d.sha256}:${r.page}:${r.row}`||seen.has(r.recordId)||!/^[a-f0-9]{64}:[1-9]\d*$/.test(r.eventKey)||keys.has(r.eventKey)||!day(r.date)||r.date<d.periodStart||r.date>d.periodEnd||!cur(r.currency)||!text(r.kind)||!text(r.category)||!Array.isArray(r.parseIssues)||r.parseIssues.length||!Array.isArray(r.absentColumns)||r.absentColumns.some(k=>k!=='trade_tax'))fail();
  if(!(r.securityId===null||/^(?:[A-Z]{2}[A-Z0-9]{9}\d|[AQ]\d{6})$/.test(r.securityId))||!(r.securityName===null||text(r.securityName))||!r.securityId&&r.securityName!==null||!(r.symbol===null||/^[A-Z0-9.-]{1,32}$/.test(r.symbol)))fail();
  const category=kinds[r.kind]||(r.kind.startsWith('환전')?'fx_transfer':r.kind.startsWith('이체')?'external_transfer':null);if(!category||r.category!==category)fail();
  only(r.fields,columns);if(Object.keys(r.fields).length!==columns.length)fail();
  for(const k of columns){const v=r.fields[k];if(['fx','qty','balance_qty'].includes(k)){if(v!==null&&!num(v))fail();}else{only(v,['krw','usd']);if(!Object.hasOwn(v,'krw')||!Object.hasOwn(v,'usd')||Object.values(v).some(x=>x!==null&&!num(x)))fail();}}
  if(r.fields.settled[r.currency.toLowerCase()]===null||r.fields.cash_balance[r.currency.toLowerCase()]===null)fail();
  if(category==='trade'){if(!r.securityId||!(Number(r.fields.qty)>0)||!(amount(r,'price')>0))fail();const fees=['fee','trade_tax','tax'].reduce((a,k)=>a+(amount(r,k)||0),0),expected=amount(r,'amount')+(r.kind==='구매'?fees:-fees);if(Math.abs(amount(r,'settled')-expected)>(r.currency==='KRW'?1.001:.0111))fail();}
  if(category==='trade'||category==='corporate_action'){const delta=Number(r.fields.qty)*(r.kind==='구매'||r.kind==='주식병합입고'?1:-1);const s=positions.get(r.securityId)||{qty:Number(r.fields.balance_qty)-delta,last:null};s.qty+=delta;s.last=Number(r.fields.balance_qty);positions.set(r.securityId,s);}
  seen.add(r.recordId);keys.add(r.eventKey);docRows.get(r.document)[r.page-1]++;counts[category]=(counts[category]||0)+1;
 }
 for(const d of p.documents)if(d.pageRowCounts.some((n,i)=>n!==docRows.get(d.document)[i]))fail();
 const held=new Set();
 for(const h of p.positions){only(h,['securityId','symbol','name','market','currency','qty','averagePrice','grossCost','costIncludingCharges','averageIncludingCharges','statementKrwGrossCost','basisVerified','averageBasis','brokerReportedAverage']);const s=positions.get(h.securityId);if(!s||held.has(h.securityId)||!text(h.name)||!cur(h.currency)||!['KR','US'].includes(h.market)||!(h.symbol===null||/^[A-Z0-9.-]{1,32}$/.test(h.symbol))||!num(h.qty)||!(Number(h.qty)>0)||Math.abs(Number(h.qty)-s.qty)>.0000001||Math.abs(Number(h.qty)-s.last)>.0000001||!h.basisVerified||h.brokerReportedAverage!==false||h.averageBasis!=='statement_moving_average_excluding_charges')fail();for(const k of ['averagePrice','grossCost','costIncludingCharges','averageIncludingCharges','statementKrwGrossCost'])if(!num(h[k])||!(Number(h[k])>0))fail();if(Math.abs(Number(h.averagePrice)*Number(h.qty)-Number(h.grossCost))>.00001||Math.abs(Number(h.averageIncludingCharges)*Number(h.qty)-Number(h.costIncludingCharges))>.00001)fail();held.add(h.securityId);}
 if([...positions].some(([id,s])=>s.qty<-.0000001||s.qty>.0000001&&!held.has(id)||Math.abs(s.qty-s.last)>.0000001))fail();
 if(!Array.isArray(p.dividends)||p.dividends.length!==(counts.dividend||0)||!Array.isArray(p.taxAdjustments)||p.taxAdjustments.length!==(counts.dividend_tax_adjustment||0))fail();
 for(const d of p.dividends){only(d,['eventKey','date','securityId','symbol','name','currency','gross','tax','net','grossDerivedFromNetAndTax','fx','kind','sourceRecordId']);if(!seen.has(d.sourceRecordId)||!keys.has(d.eventKey)||!day(d.date)||!cur(d.currency)||!num(d.gross)||!num(d.tax)||!num(d.net)||Math.abs(Number(d.gross)-Number(d.tax)-Number(d.net))>(d.currency==='KRW'?1.001:.0111))fail();}
 for(const a of p.taxAdjustments){only(a,['eventKey','date','securityId','symbol','name','currency','cash','kind','sourceRecordId']);if(!seen.has(a.sourceRecordId)||!keys.has(a.eventKey)||!day(a.date)||!cur(a.currency)||!num(a.cash))fail();}
 if(!p.checks||p.checks.dailyCashContinuity?.mismatches?.length!==0||p.checks.unresolvedCorporateBatches?.length!==0||p.checks.tradeCashIdentities?.outsideRoundingTolerance!==0||!Array.isArray(p.warnings)||p.warnings.some(x=>!text(x))||!text(p.dateBasis)||!text(p.realizedBasis))fail();
 for(const k of ['monthly','yearly','income','incomeCounts','cashBalances','checks','securityTotals'])numericTree(p[k]);
 return p;
}
export function validateStatementArchives(archives){if(archives===undefined)return;if(!Array.isArray(archives)||archives.length>100)fail();const ids=new Set();for(const a of archives){only(a,['id','digest','importedAt','package']);if(!hash.test(a.id)||!hash.test(a.digest)||ids.has(a.id)||!text(a.importedAt))fail();validateStatementPackage(a.package);ids.add(a.id);}}
export async function statementPreview(raw,db){
 const p=validateStatementPackage(raw),id=await digest(p.documents.map(d=>d.sha256)),content=await digest(p),existing=(db.statementArchives||[]).find(a=>a.id===id);
 if(existing&&existing.digest!==content)throw Error('같은 원본의 검토 결과가 바뀌었습니다. 기존 원본을 덮어쓰지 않습니다');
 if(!existing&&(db.statementArchives||[]).some(a=>a.package.periodStart<=p.periodEnd&&a.package.periodEnd>=p.periodStart))throw Error('기존 거래내역과 기간이 겹칩니다. 중복 합산을 막기 위해 저장을 중단합니다');
 const changes=p.positions.map(h=>{const matches=db.holdings.filter(x=>x.symbol===h.symbol&&x.currency===h.currency),old=matches[0];return {symbol:h.symbol,name:h.name,qty:Number(h.qty),currency:h.currency,average:Number(h.averagePrice),oldAverage:old?.avg??null,holdingId:old?.id??null,eligible:matches.length===1&&old.qty===Number(h.qty),reason:matches.length!==1?'현재 보유 종목과 단일 일치하지 않음':old.qty!==Number(h.qty)?'현재 수량과 달라 평균가 적용 제외':'수량·통화 일치'};});
 return {id,digest:content,package:structuredClone(p),duplicate:!!existing,changes,holdingsSignature:JSON.stringify(db.holdings)};
}
export async function applyStatement(plan,db,{updateAverages=false}={}){
 if(JSON.stringify(db.holdings)!==plan.holdingsSignature)throw Error('보유 현황이 바뀌었습니다. 미리보기를 다시 여세요');
 const fresh=await statementPreview(plan.package,db);if(fresh.id!==plan.id||fresh.digest!==plan.digest)fail();
 const now=new Date().toISOString();let updated=0;
 if(updateAverages)for(const row of fresh.changes.filter(x=>x.eligible)){const h=db.holdings.find(x=>x.id===row.holdingId);if(h.avg===row.average&&h.averageSource?.statementId===plan.id)continue;h.avg=row.average;h.averageSource={statementId:plan.id,date:plan.package.periodEnd,basis:'증명서 거래내역의 이동평균·비용 제외; 증권사 표시 평균가 아님'};updated++;}
 if(!fresh.duplicate){db.statementArchives??=[];db.statementArchives.push({id:plan.id,digest:plan.digest,importedAt:now,package:structuredClone(plan.package)});}
 return {added:!fresh.duplicate,updated};
}
