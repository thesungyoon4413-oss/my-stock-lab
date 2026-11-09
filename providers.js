import {today,known} from './core.js';
import {normalize,alphaQuote,fscQuotes,upsertQuote,requestBudget} from './lab.js';
export const PROVIDER_INFO={av:{name:'Alpha Vantage',url:'https://www.alphavantage.co/support/#api-key',limit:20},fsc:{name:'공공데이터포털 금융위원회',url:'https://www.data.go.kr/data/15094808/openapi.do',limit:20}};
export async function refreshQuotes(db,{persist,active,signal,fetcher=fetch}={}){
 normalize(db);const out={updated:0,skipped:0,errors:[]};
 const targets=new Map();
 for(const h of db.holdings)if(h.qty>0&&h.verified!==false)targets.set(h.symbol,{symbol:h.symbol,currency:h.currency});
 for(const r of db.recommendations){targets.set(r.symbol,{symbol:r.symbol,currency:r.currency});if(r.benchmarkSymbol)targets.set(r.benchmarkSymbol,{symbol:r.benchmarkSymbol,currency:r.currency});}
 for(const t of targets.values()){
  if(!active())break;
  const id=t.currency==='USD'?'av':'fsc',p=db.providers[id];
  if(!p.accepted||!p.key||p.fetched[t.symbol]===today()){out.skipped++;continue;}
  if((id==='av'&&!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(t.symbol))||(id==='fsc'&&!/^[A-Z0-9]{6}$/.test(t.symbol))){out.errors.push(t.symbol+': 종목코드 형식 확인 필요');continue;}
  if(requestBudget(p)>=PROVIDER_INFO[id].limit){out.errors.push(PROVIDER_INFO[id].name+': 앱의 최근 24시간 20회 안전 한도 도달');continue;}
  p.attempts=p.attempts.filter(v=>v>Date.now()-86400000);p.attempts.push(Date.now());
  await persist();if(!active())break;
  let url;
  if(id==='av'){url=new URL('https://www.alphavantage.co/query');for(const [k,v] of Object.entries({function:'GLOBAL_QUOTE',symbol:t.symbol,apikey:p.key}))url.searchParams.set(k,v);}
  else {url=new URL('https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2');const begin=new Date();begin.setUTCDate(begin.getUTCDate()-21);let key=p.key;try{key=decodeURIComponent(key);}catch{}for(const [k,v] of Object.entries({serviceKey:key,resultType:'json',numOfRows:'100',pageNo:'1',beginBasDt:begin.toISOString().slice(0,10).replaceAll('-',''),likeSrtnCd:t.symbol}))url.searchParams.set(k,v);}
  try{
   const timeout=AbortSignal.timeout(15000),joined=signal&&AbortSignal.any?AbortSignal.any([signal,timeout]):timeout;
   const res=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:joined});
   if(!res.ok)throw Error('HTTP '+res.status);
   const raw=await res.json();if(!active())break;p.lastResponse=JSON.stringify(raw).replaceAll(p.key,'[키 삭제]').replaceAll(encodeURIComponent(p.key),'[키 삭제]');
   let q;if(id==='av')q=alphaQuote(raw,t.symbol);else q=fscQuotes(raw,t.symbol)[0];
   if(!q)throw Error('조회된 거래일 시세가 없습니다');
   upsertQuote(db,q);p.fetched[t.symbol]=today();out.updated++;
   await persist();
  }catch(e){if(!active())break;out.errors.push(t.symbol+': '+(e.name==='TimeoutError'?'응답 시간 초과':e instanceof TypeError?'브라우저 연결 차단·CORS·네트워크 확인 필요':String(e.message).replaceAll(p.key,'[키 삭제]').replaceAll(encodeURIComponent(p.key),'[키 삭제]')));}
 }
 return out;
}
