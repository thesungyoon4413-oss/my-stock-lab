import {today} from './core.js?v=2.7.0';
import {normalize,requestBudget,alphaQuote,upsertQuote} from './lab.js?v=2.7.0';
import {alphaLimit,withProviderLock} from './providers.js?v=2.7.0';
import {initialFinancialState,financialSymbol,FINANCIAL_KINDS,parseFinancialResponse} from './financial-data.js?v=2.7.0';
export function normalizeFinancials(db){db.financials??=initialFinancialState();return db.financials;}
const excluded=new Set(['GOOY','NVDY','TSLY','SOXL','SPCX']);
export function financialTargets(db){
 const state=normalizeFinancials(db),held=db.holdings.filter(h=>h.currency==='USD'&&h.qty>0&&h.verified!==false&&!excluded.has(h.symbol)&&financialSymbol(h.symbol)).map(h=>h.symbol);
 return [...new Set([...held,...state.watchlist])].filter(s=>!excluded.has(s)).sort((a,b)=>(state.checked[a]||'').localeCompare(state.checked[b]||'')||held.includes(b)-held.includes(a)||a.localeCompare(b));
}
export async function refreshFinancials(db,{persist,active,signal,fetcher=fetch,clock=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms)),automatic=false}={}){
 return withProviderLock(db,async()=>{
  normalize(db);const state=normalizeFinancials(db),p=db.providers.av,out={updated:0,quotes:0,symbols:0,skipped:0,errors:[]};const day=today();
  if(!p.accepted||!p.key){out.skipped++;return out;}
  const requestKey=p.key,permitted=()=>active()&&p.accepted&&p.key===requestKey;
  if(automatic&&state.lastAutoDate===day){out.skipped++;return out;}
  if(automatic){state.lastAutoDate=day;await persist();if(!permitted())return out;}
  const recentQuote=s=>db.quotes.some(q=>q.symbol===s&&q.currency==='USD'&&q.date<=day&&clock()-Date.parse(q.date+'T00:00:00Z')>=0&&clock()-Date.parse(q.date+'T00:00:00Z')<=7*86400000);
  const targets=financialTargets(db).filter(s=>(!automatic||state.checked[s]!==day)&&(FINANCIAL_KINDS.some(kind=>!state.records.some(r=>r.symbol===s&&r.kind===kind&&clock()-Date.parse(r.collected)>=0&&clock()-Date.parse(r.collected)<7*86400000))||!recentQuote(s))).slice(0,2);
  let stopped=false;
  for(const symbol of targets){
   if(!permitted()||signal?.aborted||stopped)break;
   const missing=FINANCIAL_KINDS.filter(kind=>!state.records.some(r=>r.symbol===symbol&&r.kind===kind&&clock()-Date.parse(r.collected)>=0&&clock()-Date.parse(r.collected)<7*86400000));
   if(!recentQuote(symbol))missing.push('GLOBAL_QUOTE');
   if(requestBudget(p,clock())+missing.length>20){out.errors.push('재무 조회 대기: 시세와 공유하는 최근 24시간 20회 안전 한도');break;}
   if(p.cooldownUntil>clock()){out.errors.push('재무 조회 대기: 제공자 호출 제한 중');break;}
   state.checked[symbol]=day;out.symbols++;await persist();
   for(const kind of missing){
    if(!permitted()||signal?.aborted||stopped)break;
    const last=p.attempts.length?Math.max(...p.attempts):0,remaining=Math.max(0,last+2000-clock());
    try{if(remaining)await wait(remaining,signal);}catch{stopped=true;break;}
    if(!permitted()||signal?.aborted)break;
    // Persist the attempt before connecting, including failures and rate limits.
    p.attempts=p.attempts.filter(t=>t>clock()-86400000);p.attempts.push(clock());await persist();if(!permitted())break;
    const url=new URL('https://www.alphavantage.co/query');for(const [k,v] of Object.entries({function:kind,symbol,apikey:requestKey}))url.searchParams.set(k,v);
    const redact=s=>String(s).replaceAll(requestKey,'[키 삭제]').replaceAll(encodeURIComponent(requestKey),'[키 삭제]');
    try{
     const timeout=AbortSignal.timeout(15000),joined=signal&&AbortSignal.any?AbortSignal.any([signal,timeout]):timeout;
     const response=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:joined});
     if(!response.ok){if(response.status===429){p.cooldownUntil=clock()+Math.max(65000,(Number(response.headers?.get('Retry-After'))||0)*1000);stopped=true;}throw Error('재무 HTTP '+response.status);}
     const raw=await response.json();if(!permitted())break;p.lastResponse=redact(JSON.stringify(raw));
     const limit=alphaLimit(raw);if(limit){p.cooldownUntil=clock()+limit.delay;stopped=true;throw Error(limit.message);}
     if(/premium|subscribe|subscription/i.test(String(raw.Information||raw.Note||''))){stopped=true;throw Error('해당 재무 자료가 유료로 제한되어 조회를 중지했습니다. 유료 가입 없이 기존 자료를 유지합니다.');}
     if(kind==='GLOBAL_QUOTE'){upsertQuote(db,alphaQuote(raw,symbol));p.fetched[symbol]=day;out.quotes++;}
     else{const record=parseFinancialResponse(raw,symbol,kind,new Date(clock()).toISOString());state.records=state.records.filter(r=>r.symbol!==symbol||r.kind!==kind);state.records.push(record);state.records=state.records.slice(-200);out.updated++;}
     await persist();
    }catch(e){if(!permitted())break;out.errors.push(symbol+' '+kind+': '+redact(e instanceof TypeError?'브라우저 연결·CORS·네트워크 확인 필요':e.message));await persist();}
   }
  }
  return out;
 });
}
