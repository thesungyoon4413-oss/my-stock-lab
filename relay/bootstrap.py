"""Stateless report relay. Fetch pinned public helpers; keep inputs and plaintext private.

Requires an already connected GitHub CLI. Never starts device login, saves a token,
generates a recipient, changes app files, or changes the two source automations.
"""
from __future__ import annotations
import argparse,base64,hashlib,importlib.util,json,re,subprocess,tempfile,time,urllib.request
from pathlib import Path
OWNER='thesungyoon4413-oss';REPO='my-stock-lab';BASE=f'repos/{OWNER}/{REPO}'
RELEASE='522893a346a73220b8ac91e98630de70dc78c40e'
SOURCE=f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{RELEASE}/'
SITE=f'https://{OWNER}.github.io/{REPO}/'
HELPERS={
 'delivery.js':'9be2a18c5db65f5d6417766f739c1fe8ebe87974bdcd14285a79d9df05527db0',
 'relay/recorded-report.mjs':'2a45b409a7a359fbb8fc01991312ec4b908ef7623976890b8a7361b6243c408c',
 'relay/seal-report.mjs':'714a58c4bdfa254e6ed8168bfb2642cbfa5c8c13b777bfaf4f4817ef2c902cb0',
 'relay/publish-inbox.py':'2a731b4189e6c72e6071c67f3434ec9b53555bf039d66fce03dbbec557fc136c'}
class MissingFile(Exception):pass
class ConnectedAccessError(RuntimeError):
 def __init__(self,status,write):
  self.status=status;self.write=write
  if status==403 and write:message='GitHub repository write permission missing (HTTP 403); authorize only the approved repository'
  elif status==401:message='Connected GitHub account authorization unavailable (HTTP 401)'
  else:message='Connected GitHub access failed'+(f' (HTTP {status})' if status else '')
  super().__init__(message+'; no login or credential fallback attempted')
def read_url(url):
 if not (url.startswith(SOURCE) or url.startswith(SITE)):raise ValueError('Unapproved download destination')
 req=urllib.request.Request(url,headers={'User-Agent':'MY-STOCK-LAB-stateless-relay','Cache-Control':'no-cache'})
 with urllib.request.urlopen(req,timeout=20) as response:
  if response.status!=200:raise RuntimeError('Public helper or ciphertext unavailable')
  data=response.read(2000001)
  if len(data)>2000000:raise ValueError('Download size limit')
  return data
def gh(path,data=None,method=None):
 if path!='user' and path!=BASE and not path.startswith(BASE+'/'):raise ValueError('Unapproved repository')
 args=['gh','api','--hostname','github.com','--method',method or ('POST' if data is not None else 'GET'),path]
 if data is not None:args+=['--input','-']
 r=subprocess.run(args,input=json.dumps(data) if data is not None else None,text=True,capture_output=True)
 if r.returncode:
  if 'HTTP 404' in r.stderr and '/contents/inbox/' in path:raise MissingFile(path)
  status=re.search(r'HTTP (\d{3})',r.stderr)
  raise ConnectedAccessError(int(status.group(1)) if status else None,data is not None or method not in (None,'GET'))
 return json.loads(r.stdout) if r.stdout.strip() else {}
def helpers(directory,reader=read_url):
 for name,expected in HELPERS.items():
  data=reader(SOURCE+name)
  if hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Public helper integrity check failed')
  p=directory/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o600)
 (directory/'package.json').write_text('{"type":"module"}')
 spec=importlib.util.spec_from_file_location('pinned_inbox_publisher',directory/'relay/publish-inbox.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def content(path,parent,request):
 try:r=request(BASE+'/contents/'+path+'?ref='+parent)
 except MissingFile:return None
 if r.get('encoding')!='base64':raise ValueError('Unexpected remote file encoding')
 return json.loads(base64.b64decode(r['content'],validate=False))
def identity(request):
 if request('user').get('login')!=OWNER:raise ValueError('Wrong connected GitHub account')
 repo=request(BASE)
 if repo.get('private') or repo.get('default_branch')!='main':raise ValueError('Approved public repository/main required')
 return request(BASE+'/git/ref/heads/main')['object']['sha']
def verify_write(request,parent):
 tree=request(BASE+'/git/commits/'+parent)['tree']['sha']
 recipient=request(BASE+'/contents/inbox/recipient.json?ref='+parent)
 blob=recipient.get('sha')
 if not isinstance(blob,str) or len(blob)!=40 or any(c not in '0123456789abcdef' for c in blob):raise ValueError('Recipient blob identity missing')
 # Submit the exact existing file object, with no content or branch change.
 result=request(BASE+'/git/trees',{'base_tree':tree,'tree':[{'path':'inbox/recipient.json','mode':'100644','type':'blob','sha':blob}]})
 if result.get('sha')!=tree:raise RuntimeError('Unexpected result from non-publishing write-permission check')
 return True
def run(task_file,bindings_file,kid,*,publish=False,check_write=False,request=gh,reader=read_url,wait_for_build=True):
 if len(kid)!=64 or any(c not in '0123456789abcdef' for c in kid):raise ValueError('Recipient fingerprint required')
 # The caller supplies private source snapshots and bindings; credentials are never inputs.
 with tempfile.TemporaryDirectory(prefix='my-stock-lab-relay-') as folder:
  directory=Path(folder);m=helpers(directory,reader);parent=identity(request)
  public=content('inbox/recipient.json',parent,request)
  if public is None:raise ValueError('Verified public recipient has not been registered')
  public=m.recipient(public)
  if public['kid']!=kid:raise ValueError('Recipient differs from the verified user vault')
  index=content('inbox/index.json',parent,request)
  if index is None:raise ValueError('Published inbox manifest is missing')
  index=m.manifest(index)
  if index['kid']!=kid:raise ValueError('Inbox belongs to another recipient')
  if check_write:verify_write(request,parent)
  inbox=directory/'inbox';inbox.mkdir();(inbox/'index.json').write_text(json.dumps(index))
  (directory/'recipient.json').write_text(json.dumps(public))
  program="""import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';
globalThis.crypto??=(await import('node:crypto')).webcrypto;
const [folder,source,bindings]=process.argv.slice(1);
const {recordedPayload}=await import(pathToFileURL(folder+'/relay/recorded-report.mjs'));
const {prepareCiphertext}=await import(pathToFileURL(folder+'/relay/seal-report.mjs'));
const task=JSON.parse(await fs.readFile(source,'utf8')),allowed=JSON.parse(await fs.readFile(bindings,'utf8'));
const payload=recordedPayload(task,allowed),recipient=JSON.parse(await fs.readFile(folder+'/recipient.json','utf8'));
const result=await prepareCiphertext(recipient,payload,folder+'/inbox');
console.log(JSON.stringify({...result,date:payload.report.date,market:payload.report.market}));"""
  result=subprocess.run(['node','--input-type=module','-e',program,str(directory),str(Path(task_file).resolve()),str(Path(bindings_file).resolve())],text=True,capture_output=True)
  if result.returncode:raise ValueError('Completed source validation/encryption failed; no report published')
  prepared=json.loads(result.stdout);summary={'market':prepared['market'],'date':prepared['date'],'kid':kid,'sourceValidated':True,'writeVerified':check_write,'alreadyPresent':not prepared['added'],'published':False}
  if not publish or not prepared['added']:return summary
  def api(path,data=None,method=None):
   try:return request(path,data,method)
   except MissingFile:raise m.NotFound(path) from None
  published=m.publish(inbox,public,api);summary.update(published=published.get('stage')=='source_published',commit=published.get('commit'))
  if wait_for_build and summary['published']:
   built=False
   for _ in range(24):
    build=next((b for b in request(BASE+'/pages/builds') if b.get('commit')==summary['commit']),None)
    if build and build.get('status')=='built':built=True;break
    if build and build.get('status')=='errored':raise RuntimeError('Pages build failed; publication is not delivery confirmation')
    time.sleep(10)
   if not built:raise RuntimeError('Pages build still pending; delivery not confirmed')
   output=json.loads((inbox/'index.json').read_text())
   live=reader(SITE+'inbox/index.json')
   if json.loads(live)!=output:raise RuntimeError('Published live manifest differs; delivery not confirmed')
   entry=next(x for x in output['items'] if x['id']==prepared['id'])
   body=reader(SITE+'inbox/'+entry['id']+'.json')
   if hashlib.sha256(body).hexdigest()!=entry['sha256']:raise RuntimeError('Live ciphertext hash mismatch')
   summary['liveVerified']=True
  return summary
def main():
 p=argparse.ArgumentParser();p.add_argument('--task-json',required=True);p.add_argument('--bindings-json',required=True);p.add_argument('--recipient-kid',required=True);p.add_argument('--publish',action='store_true');p.add_argument('--check-write',action='store_true');args=p.parse_args()
 try:print(json.dumps(run(args.task_json,args.bindings_json,args.recipient_kid,publish=args.publish,check_write=args.check_write)))
 except Exception as e:print(json.dumps({'status':'blocked','reason':str(e)[:250],'published':False}));raise SystemExit(1)
if __name__=='__main__':main()
