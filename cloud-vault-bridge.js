import {businessDigest} from './cloud-client.js?v=2.9.0';
import {validateDB} from './core.js?v=2.9.0';
const fail=code=>Object.assign(Error(code),{code});
// Serialize replacing a live vault with all normal edits and pending local saves.
// The host freezes new edits, waits for in-flight work, then detaches its database
// so previously started async callbacks cannot mutate the restored state.
export function createVaultBridge(c){
 let busy=false;
 async function replace(value){
  if(busy)throw fail('busy');busy=true;
  const epoch=c.epoch();let prior=null,detached=false;
  c.freeze(true);
  try{
   await c.idle();await c.flush();
   if(c.epoch()!==epoch)throw fail('vault_locked');prior=c.read();
   if(value.expectedLocalSemantic&&await businessDigest(prior.db,prior.envelope.salt)!==value.expectedLocalSemantic)throw fail('local_changed');
   if(c.epoch()!==epoch)throw fail('vault_locked');
   const restored=validateDB(structuredClone(value.db));
   c.detach();detached=true;
   const envelope=await c.write(value.envelope);c.stored(envelope);
   if(c.epoch()!==epoch)throw fail('vault_locked');
   c.assign({db:restored,key:value.key||prior.key,salt:value.salt||Uint8Array.from(atob(envelope.salt),x=>x.charCodeAt(0)),envelope});
   detached=false;return true;
  }catch(e){if(detached&&c.epoch()===epoch&&prior)c.assign(prior);throw e;}
  finally{busy=false;c.freeze(false);}
 }
 return {replace,busy:()=>busy};
}
