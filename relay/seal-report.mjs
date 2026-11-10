// Produces ciphertext only. No password or decryption key is accepted.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {readRecipient,sealReport,digest,validateManifest} from '../delivery.js';
export async function prepareCiphertext(recipientValue,payload,directory){
 const recipient=await readRecipient(recipientValue),envelope=await sealReport(recipient,payload),body=JSON.stringify(envelope)+'\n';
 await mkdir(directory,{recursive:true});const path=join(directory,'index.json');let index;
 try{index=validateManifest(JSON.parse(await readFile(path,'utf8')),recipient.kid);}catch(e){if(e.code!=='ENOENT')throw e;index={format:'MY-STOCK-LAB-INBOX',version:1,kid:recipient.kid,items:[]};}
 if(index.items.some(x=>x.id===envelope.id))return {added:false,id:envelope.id};
 if(index.items.length>=10000)throw Error('수신함 10,000건 도달 · 기존 기록을 지우지 않고 발행을 중지합니다');
 await writeFile(join(directory,envelope.id+'.json'),body,{mode:0o600});index.items.push({id:envelope.id,sha256:await digest(body)});await writeFile(path,JSON.stringify(index,null,2)+'\n',{mode:0o600});
 return {added:true,id:envelope.id,kid:recipient.kid};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [recipientFile,payloadFile,outputDirectory]=process.argv.slice(2);if(!outputDirectory){process.stderr.write('Usage: node scripts/seal-report.mjs RECIPIENT_FILE PAYLOAD_JSON OUT_INBOX_DIR\n');process.exitCode=1;}
 else try{const result=await prepareCiphertext(await readFile(recipientFile,'utf8'),JSON.parse(await readFile(payloadFile,'utf8')),outputDirectory);process.stdout.write(JSON.stringify(result)+'\n');}catch(e){process.stderr.write('Ciphertext preparation failed: '+e.message+'\n');process.exitCode=1;}
}
