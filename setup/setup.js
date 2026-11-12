'use strict';
const result=document.querySelector('#result');
const codes=new Map();
document.querySelectorAll('[data-copy]').forEach(button=>{button.disabled=true;});
for(const file of ['schema.sql','register-owner.sql']){
 fetch(file,{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'}).then(async response=>{
  if(!response.ok)throw Error();const text=await response.text();if(text.length>40000)throw Error();
  codes.set(file,text);document.querySelector('[data-copy="'+file+'"]').disabled=false;
 }).catch(()=>{result.textContent='설정 코드를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';});
}
function setProject(){
const ref=location.hash.slice(1),valid=/^[a-z0-9]{20}$/.test(ref);
if(valid){
 const base='https://supabase.com/dashboard/project/'+ref;
 document.querySelector('#project').textContent='선택한 프로젝트: '+ref;
 document.querySelectorAll('.sql-link').forEach(a=>a.href=base+'/sql/new');
 document.querySelector('#auth-link').href=base+'/auth/users';
 document.querySelector('#keys-link').href=base+'/settings/api-keys';
 document.querySelectorAll('a:not(.brand)').forEach(a=>a.removeAttribute('aria-disabled'));
}else{
 document.querySelector('#project').textContent='연결할 프로젝트가 지정되지 않았습니다. 안내받은 전체 링크로 열어주세요.';
 document.querySelectorAll('a:not(.brand)').forEach(a=>{a.removeAttribute('href');a.setAttribute('aria-disabled','true');});
}
}
setProject();window.addEventListener('hashchange',setProject);
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-copy]');if(!button)return;
 const file=button.dataset.copy;if(!['schema.sql','register-owner.sql'].includes(file))return;
 button.disabled=true;
 try{
  const text=codes.get(file);if(!text)throw Error('설정 코드를 불러오는 중입니다. 잠시 후 다시 시도하세요.');
  try{await navigator.clipboard.writeText(text);result.textContent='코드 복사 완료. SQL 편집기에 붙여넣고 Run을 누르세요. 현재는 복사만 완료됐습니다.';}
  catch{const area=document.querySelector('#fallback');area.hidden=false;area.value=text;area.focus();area.select();result.textContent='코드 영역을 전체 선택해 복사한 뒤 SQL 편집기에 붙여넣어 주세요.';}
 }catch(error){result.textContent=error.message;}
 finally{button.disabled=false;}
});
