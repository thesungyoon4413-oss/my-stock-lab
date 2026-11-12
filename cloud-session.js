// Device-only session storage. Never part of a backup or an HTTP payload.
const format='MY-STOCK-LAB-CLOUD-SESSION',enc=new TextEncoder(),dec=new TextDecoder();
const b64=b=>btoa(String.fromCharCode(...b));
const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function aad(binding){
 if(typeof binding?.url!=='string'||typeof binding?.device!=='string'||typeof binding?.salt!=='string')throw Error('invalid_session_binding');
 return enc.encode(JSON.stringify([format,1,binding.url,binding.device,binding.salt]));
}
function validate(value){
 if(!value||typeof value.access_token!=='string'||typeof value.refresh_token!=='string'||typeof value.userId!=='string'||!Number.isFinite(value.expiresAt))throw Error('invalid_local_session');
 if(JSON.stringify(value).length>50000)throw Error('invalid_local_session');return value;
}
export async function sealSession(session,key,binding){
 const iv=crypto.getRandomValues(new Uint8Array(12)),body=enc.encode(JSON.stringify(validate(session)));
 return {format,version:1,iv:b64(iv),ciphertext:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(binding)},key,body)))};
}
export async function openSession(value,key,binding){
 if(value?.format!==format||value.version!==1||typeof value.ciphertext!=='string'||value.ciphertext.length>70000||typeof value.iv!=='string'||value.iv.length!==16)throw Error('invalid_local_session');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(value.iv),additionalData:aad(binding)},key,un64(value.ciphertext));
 return validate(JSON.parse(dec.decode(raw)));
}
