// Broker-reported snapshots never supply quote dates, FX, average cost or trades.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const integer=n=>Number.isSafeInteger(n);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const text=(v,max=300)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateBrokerSnapshot(raw){
 if(raw?.format!=='MY-STOCK-LAB-BROKER-SNAPSHOT'||raw.version!==1)throw Error('지원하지 않는 증권사 현황 파일입니다');
 if(!text(raw.source)||!date(raw.captureDate)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.captureTime))throw Error('촬영일·시간·출처를 확인하세요');
 const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(raw.captureDate>now)throw Error('촬영일이 미래입니다');
 if(!Array.isArray(raw.markets)||raw.markets.length<1||raw.markets.length>2)throw Error('국내·미국 현황 구분을 확인하세요');
 for(const k of ['includesDividends','includesRealizedPnl'])if(raw[k]!==null&&typeof raw[k]!=='boolean')throw Error('총수익 포함 범위 확인 필요');
 const seen=new Set();const markets=raw.markets.map(m=>{
  if(!['KR','US'].includes(m.market)||seen.has(m.market))throw Error('시장 구분 오류·중복');seen.add(m.market);
  for(const k of ['valueKrw','principalKrw','profitKrw'])if(!integer(m[k])||(k!=='profitKrw'&&m[k]<0))throw Error('시장 합계 금액 오류');
  if(!finite(m.profitRatePercent)||!Array.isArray(m.rows)||m.rows.length>1000)throw Error('시장 수익률·종목 오류');
  const symbols=new Set();const rows=m.rows.map(r=>{
   if(!text(r.symbol,30)||!text(r.name)||symbols.has(r.symbol))throw Error('종목명·코드 누락 또는 중복');symbols.add(r.symbol);
   if(!finite(r.qty)||r.qty<0||!integer(r.valueKrw)||r.valueKrw<0||!integer(r.profitKrw)||!finite(r.profitRatePercent))throw Error('종목 수량·금액·수익률 오류');
   return {symbol:r.symbol,name:r.name,qty:r.qty,valueKrw:r.valueKrw,profitKrw:r.profitKrw,profitRatePercent:r.profitRatePercent};
  });
  return {market:m.market,valueKrw:m.valueKrw,principalKrw:m.principalKrw,profitKrw:m.profitKrw,profitRatePercent:m.profitRatePercent,rows};
 });
 return {format:raw.format,version:1,source:raw.source,captureDate:raw.captureDate,captureTime:raw.captureTime,dateConfirmedByUser:raw.dateConfirmedByUser===true,quoteDate:null,exchangeRate:null,includesDividends:raw.includesDividends,includesRealizedPnl:raw.includesRealizedPnl,markets};
}
export function brokerSummary(input){
 const s=validateBrokerSnapshot(input);const sums={valueKrw:0,principalKrw:0,profitKrw:0,count:0};const differences=[];
 for(const m of s.markets){
  for(const k of ['valueKrw','principalKrw','profitKrw'])sums[k]+=m[k];sums.count+=m.rows.length;
  const rowValue=m.rows.reduce((s,r)=>s+r.valueKrw,0),rowProfit=m.rows.reduce((s,r)=>s+r.profitKrw,0);
  if(rowValue!==m.valueKrw)differences.push({market:m.market,field:'평가액: 상단−종목 합계',difference:m.valueKrw-rowValue});
  if(rowProfit!==m.profitKrw)differences.push({market:m.market,field:'총수익: 상단−종목 합계',difference:m.profitKrw-rowProfit});
  if(m.profitKrw!==m.valueKrw-m.principalKrw)differences.push({market:m.market,field:'총수익−(평가액−원금)',difference:m.profitKrw-(m.valueKrw-m.principalKrw)});
 }
 return {...sums,calculatedRatePercent:sums.principalKrw>0?sums.profitKrw/sums.principalKrw*100:null,differences};
}
export async function brokerFingerprint(snapshot){
 const s=validateBrokerSnapshot(snapshot);s.markets.sort((a,b)=>a.market.localeCompare(b.market));for(const m of s.markets)m.rows.sort((a,b)=>a.symbol.localeCompare(b.symbol));
 const data=new TextEncoder().encode(JSON.stringify(s));return 'broker-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function storeBrokerSnapshot(db,input){
 const s=validateBrokerSnapshot(input),id=await brokerFingerprint(s);db.brokerSnapshots??=[];
 if(db.brokerSnapshots.some(x=>x.id===id))return {added:false,id};
 db.brokerSnapshots.push({...s,id,importedAt:new Date().toISOString()});return {added:true,id};
}
export function validateBrokerHistory(history){
 if(history===undefined)return;
 if(!Array.isArray(history)||history.length>2000)throw Error('증권사 현황 이력 구조 오류');
 const ids=new Set();for(const s of history){validateBrokerSnapshot(s);if(!/^broker-[0-9a-f]{64}$/.test(s.id)||ids.has(s.id)||!text(s.importedAt))throw Error('증권사 현황 이력 식별자 오류');ids.add(s.id);}
}
export function brokerCsv(input){
 const s=validateBrokerSnapshot(input);const rows=[['capture_date','capture_time','market','symbol','name','qty','reported_value_krw','reported_profit_krw','reported_profit_rate_percent','source']];
 for(const m of s.markets)for(const r of m.rows)rows.push([s.captureDate,s.captureTime,m.market,r.symbol,r.name,r.qty,r.valueKrw,r.profitKrw,r.profitRatePercent,s.source]);
 const cell=v=>{let text=String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
