// Reviewed research is imported locally. No external AI or news service is called.
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const text=(v,max=20000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function sourceURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!/^(localhost|127\.|\[::1\])/.test(u.hostname)&&![...u.searchParams.keys()].some(k=>/^(api[_-]?key|service[_-]?key|access[_-]?token|token|secret|client[_-]?secret|password|authorization|key)$/i.test(k));}catch{return false;}
}
export function validateEvidence(snapshot,market,reportDate){
 if(!snapshot||!date(snapshot.reviewDate)||snapshot.reviewDate>reportDate||!Array.isArray(snapshot.entries)||snapshot.entries.length>100)throw Error('분석 근거 검토일·항목 오류');
 for(const e of snapshot.entries){
  if(e.market!==market||!text(e.symbol,40)||!text(e.name,150)||!text(e.period,150)||(e.publishedDate!==null&&(!date(e.publishedDate)||e.publishedDate>snapshot.reviewDate))||!text(e.sourceTitle,300)||!sourceURL(e.url))throw Error('분석 자료의 시장·출처·발표일을 확인하세요');
  for(const key of ['facts','positives','risks','catalysts','judgment','failure'])if(!text(e[key]))throw Error('분석 자료의 사실·위험·판단·실패 조건이 필요합니다');
 }
 return snapshot;
}
export function parseResearchPackage(raw){
 if(raw?.format!=='MY-STOCK-LAB-RESEARCH-PACKAGE'||raw.version!==1||!date(raw.date)||raw.date>today()||!Array.isArray(raw.reports)||!raw.reports.length||raw.reports.length>20)throw Error('분석 보고서 묶음 형식·기준일 오류');
 return raw.reports.map(r=>{
  if(!['KR','US'].includes(r.market)||!text(r.title,300)||!text(r.body,200000)||!text(r.source,500))throw Error('보고서 시장·제목·본문·출처 오류');
  const evidenceSnapshot=validateEvidence({reviewDate:raw.date,entries:r.entries},r.market,raw.date);
  // Select only supported fields, preserving the reviewed report as an immutable snapshot.
  return {market:r.market,date:raw.date,title:r.title,source:r.source,body:r.body,evidenceSnapshot:structuredClone(evidenceSnapshot)};
 });
}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export function reportIdentity(r){return JSON.stringify(canonical([r.market,r.date,r.title,r.source,r.body,r.evidenceSnapshot]));}
export function researchPreview(raw,existing){
 const seen=new Set(existing.filter(r=>r.evidenceSnapshot).map(reportIdentity));let duplicates=0;
 const reports=parseResearchPackage(raw).filter(r=>{const id=reportIdentity(r);if(seen.has(id)){duplicates++;return false;}seen.add(id);return true;});
 return {reports,duplicates};
}
export function reviewedEvidence(db,symbol,market,asOf){
 const reports=db.reports.filter(r=>r.market===market&&r.date<=asOf&&r.evidenceSnapshot?.reviewDate<=asOf).sort((a,b)=>b.date.localeCompare(a.date)||(b.created||'').localeCompare(a.created||''));
 for(const r of reports){const e=r.evidenceSnapshot.entries.find(e=>e.symbol===symbol&&(e.publishedDate===null||e.publishedDate<=asOf));if(e)return {...structuredClone(e),reviewDate:r.evidenceSnapshot.reviewDate,reportId:r.id};}
 return null;
}
export function evidenceText(e){return `${e.name} (${e.symbol})\n대상 기간: ${e.period} · 발표 ${e.publishedDate||'미표기'} · 검토 ${e.reviewDate}\n출처: ${e.sourceTitle}\n${e.url}\n확인 사실: ${e.facts}\n긍정 요인: ${e.positives}\n위험·반대 근거: ${e.risks}\n향후 확인할 촉매: ${e.catalysts}\n검토 당시 판단: ${e.judgment}\n판단 재검토 조건: ${e.failure}`;}
