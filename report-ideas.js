// Conservative extraction of explicit new-candidate sections; report text is never code.
const reject=new Set(['AI','API','USD','KRW','ETF','NAV','ROC','ROE','PER','PBR','SEC','EPS','CPI','FOMC','GDP','KST','NYSE','NASDAQ','YTD','TTM','BUY','SELL','HOLD']);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const previousDay=d=>new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10);
export function candidatePriceCutoff(draft){
 const stamp=Date.parse(draft.reportCreated),instant=new Date(stamp),kst=Number.isFinite(stamp)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant):null;
 if(kst!==draft.reportDate)return draft.currency==='USD'?previousDay(draft.reportDate):draft.reportDate;
 const zone=draft.currency==='USD'?'America/New_York':'Asia/Seoul',parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
 const localDay=parts.year+'-'+parts.month+'-'+parts.day,minute=(Number(parts.hour)%24)*60+Number(parts.minute),close=draft.currency==='USD'?16*60:16*60+30;
 // Use conservative close cutoffs. Earlier special-session closes can remain
 // unconfirmed; a later price must never create retrospective performance.
 return minute>=close?localDay:previousDay(localDay);
}
const clean=s=>s.replace(/\*\*|__|`|^\s*#{1,6}\s*/g,'').trim();
const heading=s=>/^\s*(#{1,6})\s+/.exec(s)?.[1].length||(/^\s*\*\*[^*]+\*\*\s*$/.test(s)?2:0);
const starts=s=>/신규\s*(?:매수\s*)?(?:추천|투자\s*(?:후보|기회)|후보)|새로운?\s*(?:투자\s*)?(?:추천|후보)|new\s+(?:stock\s+)?(?:recommendations?|candidates?)/i.test(s);
function ticker(line,market){const explicit=market==='KR'?[...line.matchAll(/[（(]([0-9]{6})[)）]/g)].map(x=>x[1]):[...line.matchAll(/[（(]([A-Z][A-Z0-9]{0,5}(?:[.\-][A-Z])?)[)）]/g)].map(x=>x[1]).filter(x=>!reject.has(x));if(explicit.length)return [...new Set(explicit)];const matches=market==='KR'?[...line.matchAll(/(?:^|[\s|])([0-9]{6})(?=$|[\s|])/g)].map(x=>x[1]):[...line.matchAll(/(?:^|[\s|:：])([A-Z][A-Z0-9]{0,5}(?:[.\-][A-Z])?)(?=$|[\s|:：])/g)].map(x=>x[1]).filter(x=>!reject.has(x));return [...new Set(matches)];}
function label(line,symbol){if(line.includes('|')){const cells=line.split('|').map(clean).filter(Boolean),names=cells.filter(s=>s!==symbol&&!/[\d$%]|(?:매수|매도|추천|종가|현재가|USD|KRW)/i.test(s)&&s.length>1&&s.length<100);return names[0]||symbol;}let s=clean(line).replace(/^\s*[-*\d.)]+\s*/,'').replaceAll(symbol,'').replace(/[()（）]/g,' ').replace(/(?:현재가|종가|추천|종목코드|기업명|ticker|price|\$|USD|KRW|[\d,.]+원|\d{4}-\d{2}-\d{2})/gi,' ').replace(/\s+/g,' ').trim();return s.length>1&&s.length<=100?s:symbol;}
function explicitPrice(lines){
 for(const line of lines){const m=clean(line).match(/(?:현재\s*(?:주가|가격)|현재가|기준가|종가|추천\s*당시\s*(?:주가|가격))\s*[:：]?\s*(?:USD\s*|KRW\s*|\$\s*|₩\s*)?([\d,]+(?:\.\d+)?)\s*(?:원|달러|USD|KRW)?/i);const d=line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(m&&d&&date(d[1]))return {price:Number(m[1].replaceAll(',','')),priceDate:d[1],priceSource:'원본 추천 구간의 명시된 가격·기준일'};}
 return {price:null,priceDate:null,priceSource:null};
}
export function reportCandidateDrafts(db){
 const reports=(db.reports||[]).filter(r=>date(r.date)&&r.date<=today()&&['KR','US'].includes(r.market)&&typeof r.body==='string'&&r.body.length<=200000&&!/규칙형/.test(r.source)&&!r.body.includes('"MY-STOCK-LAB-OFFICIAL-FUNDS"')).sort((a,b)=>b.date.localeCompare(a.date)||(b.created||'').localeCompare(a.created||''));
 const output=[];
 for(const market of ['KR','US']){
  // The latest report with an explicit section controls the day. An explicit 'none'
  // must not resurrect a candidate from an older report.
  const report=reports.find(r=>r.market===market&&r.body.split('\n').some(starts));if(!report)continue;
  const lines=report.body.split('\n'),sections=[];let block=null,level=0;
  for(const raw of lines){const h=heading(raw),line=clean(raw);
   if(starts(line)){if(block)sections.push(block);block=[raw];level=h||2;continue;}
   if(block&&h&&h<=level&&!ticker(line,market).length){sections.push(block);block=null;}
   if(block&&block.length<80)block.push(raw);
  }
  if(block)sections.push(block);
  if(sections.some(b=>b.slice(0,3).some(l=>/신규\s*(?:매수\s*)?추천\s*(?:종목)?\s*[:：-]?\s*없음|오늘은.*추천.*없음|no\s+(?:new\s+)?recommendation/i.test(clean(l)))))continue;
  const held=new Set((db.holdings||[]).filter(h=>h.qty>0).map(h=>h.symbol)),seen=new Set();
  for(const section of sections){
   for(let i=0;i<section.length;i++){
    const line=clean(section[i]);if(/매수\s*추천\s*아님|추천\s*제외|비추천|매수\s*보류/.test(line))continue;
    const symbols=ticker(line,market);if(symbols.length!==1)continue;const symbol=symbols[0];
    if(held.has(symbol)||seen.has(symbol)||(db.recommendations||[]).some(r=>r.symbol===symbol&&r.date===report.date))continue;
    // A code in a narrative paragraph is not enough: require a heading, list,
    // table row, or the normal 'company (ticker)' notation.
    if(!heading(section[i])&&!/^\s*[-*\d.)]+\s|\|/.test(section[i])&&!/[（(][A-Z0-9.\-]+[)）]/.test(line))continue;
    let end=i+1;while(end<section.length&&end<i+16&&ticker(clean(section[end]),market).length===0)end++;
    const excerpt=section.slice(i,end).join('\n'),price=explicitPrice(section.slice(i,end));
    output.push({id:report.id+'|'+symbol,reportId:report.id,reportDate:report.date,reportCreated:report.created,reportTitle:report.title,market,currency:market==='KR'?'KRW':'USD',symbol,name:label(line,symbol),excerpt,source:report.source,originalChatUrl:report.originalChatUrl||null,...price});seen.add(symbol);if(seen.size===2)break;
   }
   if(seen.size===2)break;
  }
 }
 return output;
}
export function candidateBaseline(db,draft){
 const cutoff=candidatePriceCutoff(draft);
 if(Number.isFinite(draft.price)&&draft.price>0&&date(draft.priceDate)&&draft.priceDate<=cutoff)return {price:draft.price,priceDate:draft.priceDate,source:draft.priceSource};
 const low=new Date(draft.reportDate+'T00:00:00Z');low.setUTCDate(low.getUTCDate()-7);
 const q=(db.quotes||[]).filter(q=>q.symbol===draft.symbol&&q.currency===draft.currency&&q.date<=cutoff&&q.date>=low.toISOString().slice(0,10)&&q.price>0).sort((a,b)=>b.date.localeCompare(a.date)||(b.updated||'').localeCompare(a.updated||''))[0];
 return q?{price:q.price,priceDate:q.date,source:q.source}:null;
}
export function freezeReportCandidate(db,draft,{price,priceDate,priceSource,horizon='중기'}){
 const current=reportCandidateDrafts(db).find(d=>d.id===draft.id);
 if(!current||!['단기','중기','장기'].includes(horizon)||!Number.isFinite(price)||price<=0||!date(priceDate)||priceDate>candidatePriceCutoff(current)||typeof priceSource!=='string'||!priceSource.trim())throw Error('원본 후보·추천 시점 전에 확정된 종가·거래일·출처를 확인하세요');
 if((db.recommendations||[]).filter(r=>r.date===current.reportDate&&r.currency===current.currency).length>=2)throw Error('시장별 같은 날 추천 기록은 최대 2개입니다');
 return {id:crypto.randomUUID(),name:current.name,symbol:current.symbol,date:current.reportDate,price,priceDate,currency:current.currency,benchmark:null,benchmarkSymbol:'',horizon,source:current.source+' · 원본 보고서 '+current.reportDate,reason:'원본 보고서 추천 구간 (자동 추출 후 사용자 확인)\n'+current.excerpt+'\n\n기준 가격 출처: '+priceSource+' · '+priceDate+'\n\n원본의 위험·실패 조건·재무 수치가 부족하면 원문에서 추가 확인해야 합니다.',observations:[],revisions:[],originReportId:current.reportId,created:new Date().toISOString()};
}
