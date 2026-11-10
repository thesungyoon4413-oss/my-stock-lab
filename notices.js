export const NOTICE_FORMAT='MY-STOCK-LAB-OFFICIAL-NOTICES';
const FEEDS={'dart-00258689':['KR','035900','JYP Ent.'],'dart-00111722':['KR','006800','미래에셋증권'],'dart-00126478':['KR','010140','삼성중공업'],'dart-00159193':['KR','015760','한국전력공사'],'dart-00126380':['KR','005930','삼성전자'],'dart-00164779':['KR','000660','SK하이닉스'],'dart-01515323':['KR','373220','LG에너지솔루션'],'dart-00877059':['KR','207940','삼성바이오로직스'],'nike-nke':['US','NKE','NIKE']};
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
export function isNoticeReport(r){return typeof r?.body==='string'&&r.body.length<150000&&r.body.trimStart().startsWith('{')&&r.body.includes('"'+NOTICE_FORMAT+'"');}
export function validateNotices(s,now=new Date()){
 const fail=()=>{throw Error('공식 공시 자료의 출처·기업·기준일 오류');};
 if(s?.format!==NOTICE_FORMAT||s.version!==1||!stamp(s.collectedAt)||Date.parse(s.collectedAt)>+now+300000||!Array.isArray(s.feeds)||s.feeds.length!==9||!Array.isArray(s.errors)||s.errors.length>9)fail();
 const seen=new Set();
 for(const f of s.feeds){
  const expected=FEEDS[f.id];if(!expected||seen.has(f.id)||[f.market,f.symbol,f.name].some((v,i)=>v!==expected[i]))fail();seen.add(f.id);
  const source=f.market==='KR'?'https://dart.fss.or.kr/api/companyRSS.xml?crpCd='+f.id.slice(5):'https://investors.nike.com/news-events/press-releases/rss';
  if(f.sourceURL!==source||!['available','partial','empty','failed'].includes(f.status)||!Array.isArray(f.items)||f.items.length>12||!Number.isInteger(f.availableCount)||f.availableCount<f.items.length||f.availableCount>2000||!Number.isInteger(f.rejectedRows)||f.rejectedRows<0||typeof f.truncated!=='boolean'||(['failed','empty'].includes(f.status)&&f.items.length))fail();
  const links=new Set();
  for(const i of f.items){
   if(typeof i.title!=='string'||!i.title||i.title.length>800||/[<>]/.test(i.title)||!stamp(i.publishedAt)||Date.parse(i.publishedAt)>Date.parse(s.collectedAt)+300000||links.has(i.url))fail();links.add(i.url);
   if(f.market==='KR'){if(!/^https:\/\/dart\.fss\.or\.kr\/dsaf001\/main\.do\?rcpNo=\d{14}$/.test(i.url)||i.title.replace(/^\([^)]*\)/,'').split(' - ')[0]!==f.name)fail();}
   else if(!/^https:\/\/investors\.nike\.com\/news-events\/press-releases\/detail\/\d+\/[a-zA-Z0-9%/_\-]+$/.test(i.url))fail();
  }
 }
 for(const e of s.errors)if(!FEEDS[e.id]||e.code!=='official_rss_unavailable_or_changed')fail();
 if(!s.feeds.some(f=>['available','empty'].includes(f.status)))fail();return s;
}
export function noticeOverview(db,{market=null,heldOnly=false,now=new Date()}={}){
 const snapshots=[],invalid=[];
 for(const r of db.reports||[])if(isNoticeReport(r)){try{snapshots.push({report:r,data:validateNotices(JSON.parse(r.body),now)});}catch{invalid.push(r.id);}}
 snapshots.sort((a,b)=>b.data.collectedAt.localeCompare(a.data.collectedAt));
 const feeds=Object.entries(FEEDS).filter(([_,e])=>(!market||e[0]===market)&&(!heldOnly||(db.holdings||[]).some(h=>h.market===e[0]&&h.symbol===e[1]&&h.qty>0))).map(([id,e])=>{
  const versions=snapshots.map(s=>({feed:s.data.feeds.find(f=>f.id===id),collectedAt:s.data.collectedAt})).filter(s=>s.feed);
  const latest=versions[0],good=versions.find(s=>s.feed.status!=='failed'),unique=new Map();
  for(const v of versions)for(const i of v.feed.items)if(!unique.has(i.url))unique.set(i.url,{...i,collectedAt:v.collectedAt});
  return {id,market:e[0],symbol:e[1],name:e[2],status:latest?.feed.status||'unconnected',latestCollected:latest?.collectedAt||null,goodCollected:good?.collectedAt||null,truncated:latest?.feed.truncated||false,rejectedRows:latest?.feed.rejectedRows||0,sourceURL:latest?.feed.sourceURL||'',items:[...unique.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,12)};
 });
 return {feeds,invalid,latestCollected:snapshots[0]?.data.collectedAt||null};
}
export function noticeReportSummary(r){if(!isNoticeReport(r))return null;const s=validateNotices(JSON.parse(r.body));return ['공식 RSS 수집 '+s.collectedAt,'공시·기업 발표의 제목과 원문 링크입니다. 원문 분석·매수 판단이 아니며 전체 공시의 누락 없음을 보장하지 않습니다.',...s.feeds.map(f=>`${f.name} (${f.symbol}) · ${f.status==='failed'?'조회 실패':f.status==='empty'?'RSS 반환 항목 없음':f.items.length+'건'} · ${f.sourceURL}\n${f.items.map(i=>i.publishedAt+' · '+i.title+'\n'+i.url).join('\n')}`)].join('\n\n');}
export function noticeEvidenceText(db,h,asOf,now=new Date()){
 const historical={...db,reports:(db.reports||[]).filter(r=>!isNoticeReport(r)||Date.parse(r.created)<=+now)};
 const feed=noticeOverview(historical,{market:h.market,now}).feeds.find(f=>f.symbol===h.symbol);if(!feed)return '';
 const items=feed.items.filter(i=>Date.parse(i.publishedAt)<=+now&&new Intl.DateTimeFormat('en-CA',{timeZone:h.market==='KR'?'Asia/Seoul':'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(i.publishedAt))<=asOf).slice(0,3);
 if(!items.length)return '';return '공식 RSS 확인 · '+h.symbol+'\n'+items.map(i=>i.publishedAt+' · '+i.title+'\n'+i.url).join('\n')+'\n원문 내용을 자동 해석하지 않았습니다. 수집 범위 내 자료입니다.';
}
export function createNoticeUI(c){
 const {panel,esc,button}=c;
 function view(market){const d=c.getDB(),o=noticeOverview(d,{market,heldOnly:true}),held=d.holdings.filter(h=>h.market===market&&h.qty>0),missing=held.filter(h=>!o.feeds.some(f=>f.symbol===h.symbol));
  return panel('공식 공시·기업 소식',`<p>국내 DART 공시와 나이키 IR 발표를 무료 RSS로 받습니다. 제목의 링크를 누르면 원문을 확인할 수 있습니다.</p><p class="small">최근 수집 ${esc(o.latestCollected||'아직 수신 전')} · ${market==='KR'?'회사별 최근 5영업일 RSS, 수집당 최근 12건':'나이키 IR RSS, 수집당 최근 12건'}</p><div class="financial-grid">${o.feeds.map(f=>`<article class="financial-card"><h4>${esc(f.name)} (${esc(f.symbol)})</h4><p class="small">${f.status==='failed'?'최근 조회 실패 · 이전 자료 유지':f.status==='empty'?'현재 RSS 반환 항목 없음':f.status==='unconnected'?'자동 수신 대기':'수집 자료 확인'}${f.truncated?' · 일부 항목만 표시':''}${f.rejectedRows?' · 기업·날짜가 맞지 않는 항목 제외':''}</p>${f.items.slice(0,4).map(i=>'<p><a href="'+esc(i.url)+'" target="_blank" rel="noopener noreferrer">'+esc(i.title)+'</a><small>'+esc(new Date(i.publishedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+' KST</small></p>').join('')||'<p>수집 범위에서 표시할 항목이 없습니다. 공시가 전혀 없다는 뜻은 아닙니다.</p>'}</article>`).join('')}</div>${missing.length?'<p class="small">현재 직접 연결 범위 밖: '+missing.map(h=>esc(h.name)).join(', ')+' · 기존 투자 보고서와 공식 공시 사이트에서 확인하세요.</p>':''}<div class="actions">${button('새 자료 받기','inbox-check')}</div><details><summary>출처·수집 범위</summary><p>DART 공식 회사별 RSS와 NIKE IR RSS가 제공하는 제목·발표 시각·원문 링크만 저장합니다. 정정 공시는 별도 접수번호로 보존합니다. 수집 후 금고를 열 때 암호화 수신함에서 받으며 기존 투자 보고서·투자 판단과 구분합니다. RSS는 전체 과거 공시·언론 뉴스를 포함하지 않습니다. 알파벳과 ETF 기업 소식은 이 RSS에 연결되지 않았습니다.</p></details>`);
 }
 return {view};
}
