import {parseCSV,validDate,known} from './core.js?v=2.2.0';
const aliases={지급일:'date',종목코드:'symbol',통화:'currency',세전금액:'gross',원천징수세액:'tax',실수령액:'net',적용환율:'fx',지급상태:'status',거래번호:'payment_id',출처:'source'};
const amount=(v,label,nullable=false)=>{if(v===undefined||v===''){if(nullable)return null;throw Error(label+' 누락');}const raw=String(v);if(!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(raw))throw Error(label+' 숫자 형식 오류');const n=Number(raw.replace(/,/g,''));if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw Error(label+' 숫자 오류');return n;};
export function dividendIdentity(d){return JSON.stringify([d.date,d.symbol.toUpperCase(),d.currency,d.gross,d.tax]);}
export function importDividends(raw,existing){
 const rows=parseCSV(raw);if(!rows.length||rows.length>10000)throw Error('배당 CSV는 1~10,000행만 지원합니다');
 const seen=new Set(existing.map(dividendIdentity)),ids=new Map(existing.filter(d=>d.paymentId).map(d=>[d.paymentId,dividendIdentity(d)]));let duplicates=0;
 const dividends=[];
 for(let i=0;i<rows.length;i++){
  try{
   const r={};for(const [k,v] of Object.entries(rows[i])){const name=aliases[k]||k;if(Object.hasOwn(r,name))throw Error('동일 의미의 헤더가 중복됩니다');r[name]=v;}
   const symbol=(r.symbol||'').toUpperCase();if(!validDate(r.date)||!symbol||symbol.length>40||!['KRW','USD'].includes(r.currency))throw Error('지급일·종목코드·통화 확인 필요');
   const gross=amount(r.gross,'세전금액'),tax=amount(r.tax,'세액'),net=amount(r.net,'실수령액',true),fx=amount(r.fx,'환율',true);
   if(tax>gross||(fx!==null&&fx<=0))throw Error('세액·환율 확인 필요');
   if(net!==null&&Math.abs(net-(gross-tax))>Math.max(1e-8,Number.EPSILON*Math.max(1,gross)*4))throw Error('실수령액이 세전금액−세액과 다릅니다. 같은 통화 기준으로 확인하세요');
   const status=({수령:'paid',예정:'scheduled'})[r.status]||r.status||'paid';if(!['paid','scheduled'].includes(status))throw Error('지급상태는 paid/scheduled 또는 수령/예정입니다');
   const paymentId=r.payment_id||'',source=r.source||'';if(paymentId.length>150||source.length>1000)throw Error('거래번호·출처 길이 오류');
   const d={id:crypto.randomUUID(),date:r.date,symbol,currency:r.currency,gross,tax,fx,status,paymentId,source};
   const identity=dividendIdentity(d);
   if(paymentId&&ids.has(paymentId)){
    if(ids.get(paymentId)!==identity)throw Error('같은 거래번호의 기존 기록과 금액·일자가 다릅니다. 기존 기록을 먼저 확인·수정하세요');
    duplicates++;continue;
   }
   // Distinct, explicit payment IDs can represent two legitimately identical payments.
   if(seen.has(identity)&&(!paymentId||existing.some(x=>dividendIdentity(x)===identity&&!x.paymentId)||dividends.some(x=>dividendIdentity(x)===identity&&!x.paymentId))){duplicates++;continue;}
   seen.add(identity);if(paymentId)ids.set(paymentId,identity);dividends.push(d);
  }catch(e){throw Error(`${i+2}행: ${e.message}`);}
 }
 return {dividends,duplicates,missingFx:dividends.filter(d=>d.currency==='USD'&&!known(d.fx)).length};
}
export const DIVIDEND_TEMPLATE='\uFEFFdate,symbol,currency,gross,tax,net,fx,status,payment_id,source\n';
