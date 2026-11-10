// Validate recorded scheduler output before it can enter the encrypted inbox.
export function recordedPayload(task,allowedTasks){
 const market=allowedTasks&&Object.hasOwn(allowedTasks,task?.id)?allowedTasks[task.id]:null,run=task?.run_details?.last_run,result=task?.run_details?.latest_result;
 if(!['KR','US'].includes(market)||!task.is_enabled)throw Error('허용된 기존 투자 보고서가 아닙니다');
 if(run?.recorded_status!=='completed'||!result||run.id!==result.run_id||result.content_truncated||result.is_failure_message||result.requires_user_action)throw Error('완료된 같은 실행의 전체 보고서가 필요합니다');
 const start=Date.parse(run.started_at),created=Date.parse(result.created_at),scheduled=Date.parse(run.scheduled_for);
 if(![start,created,scheduled].every(Number.isFinite)||created<start||Date.parse(result.scheduled_for)!==scheduled)throw Error('보고서 실행·생성 시각 대조 실패');
 if(typeof result.content_text!=='string'||!result.content_text.trim()||result.content_text.length>200000)throw Error('전체 보고서 본문 오류');
 const chat=result.chat_ref,originalChatUrl=chat?.type==='chatgpt'&&/^[a-f0-9-]{36}$/.test(chat.id)?'https://chatgpt.com/c/'+chat.id:null;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(scheduled));
 return {version:1,deliveryId:task.id+':'+run.id,report:{...(originalChatUrl?{originalChatUrl}:{}),market,date,title:`${market==='KR'?'국내':'미국'}주식 ${date} 예약 보고서`,body:result.content_text,source:'기존 ChatGPT 예약 보고서 원문 · 인용은 원본 채팅 기준',created:new Date(created).toISOString()}};
}
