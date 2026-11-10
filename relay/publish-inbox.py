"""Publish ciphertext to the single approved repository using connected GitHub CLI auth.
No device-login flow, token persistence, plaintext reports, or private keys here.
"""
import argparse,base64,hashlib,json,os,re,subprocess,sys
from pathlib import Path
BASE='repos/thesungyoon4413-oss/my-stock-lab'
HEX=re.compile(r'^[a-f0-9]{64}$')
class NotFound(Exception):pass
def api(path,data=None,method=None):
 args=['gh','api','--hostname','github.com','--method',method or ('POST' if data is not None else 'GET'),path]
 if data is not None:args+=['--input','-']
 result=subprocess.run(args,input=json.dumps(data) if data is not None else None,text=True,capture_output=True)
 if result.returncode:
  if 'HTTP 404' in result.stderr:raise NotFound(path)
  # Do not echo CLI stderr; it can contain environment and credential diagnostics.
  raise RuntimeError('GitHub API request failed; verify the connected account and repository access')
 return json.loads(result.stdout) if result.stdout.strip() else {}
def manifest(value):
 if value.get('format')!='MY-STOCK-LAB-INBOX' or value.get('version')!=1 or not HEX.fullmatch(value.get('kid','')) or not isinstance(value.get('items'),list) or len(value['items'])>10000:raise ValueError('Invalid encrypted manifest')
 seen=set()
 for item in value['items']:
  if set(item)!={'id','sha256'} or not HEX.fullmatch(item['id']) or not HEX.fullmatch(item['sha256']) or item['id'] in seen:raise ValueError('Invalid encrypted file entry')
  seen.add(item['id'])
 return value
def recipient(value):
 if set(value)!={'format','version','kid','publicKey'} or value['format']!='MY-STOCK-LAB-RECIPIENT' or value['version']!=1:raise ValueError('Public recipient format required')
 k=value['publicKey']
 if k.get('kty')!='RSA' or k.get('e')!='AQAB' or not re.fullmatch(r'[A-Za-z0-9_-]{512}',k.get('n','')) or not set(k).issubset({'kty','n','e','alg','ext','key_ops'}):raise ValueError('Only an RSA public key can be published')
 kid=hashlib.sha256(json.dumps(['RSA',k['n'],k['e']],separators=(',',':')).encode()).hexdigest()
 if value['kid']!=kid:raise ValueError('Recipient key fingerprint mismatch')
 return value
def fetch_json(path,parent,request=api):
 try:v=request(BASE+'/contents/'+path+'?ref='+parent)
 except NotFound:return None
 if v.get('encoding')!='base64':raise ValueError('Unexpected remote file encoding')
 return json.loads(base64.b64decode(v['content']))
def publish(directory,recipient_value,request=api,*,github_actions=False):
 directory=Path(directory);public=recipient(recipient_value)
 if not directory.is_dir() or any(not p.is_file() or p.is_symlink() or (p.name!='index.json' and not re.fullmatch(r'[a-f0-9]{64}\.json',p.name)) for p in directory.iterdir()):raise ValueError('Only ciphertext files and index.json may be published')
 index=manifest(json.loads((directory/'index.json').read_text()))
 if index['kid']!=public['kid']:raise ValueError('Recipient and inbox differ')
 if github_actions:
  if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REPOSITORY')!='thesungyoon4413-oss/my-stock-lab' or os.environ.get('GITHUB_REF')!='refs/heads/main' or os.environ.get('GITHUB_EVENT_NAME') not in ['schedule','workflow_dispatch']:raise ValueError('Approved repository Actions context required')
 else:
  user=request('user')
  if user.get('login')!='thesungyoon4413-oss':raise ValueError('Wrong connected GitHub account')
 repo=request(BASE)
 if repo.get('private') or repo.get('default_branch')!='main':raise ValueError('Existing approved public Pages repository required')
 if github_actions and (repo.get('full_name')!='thesungyoon4413-oss/my-stock-lab' or str(repo.get('id'))!=os.environ.get('GITHUB_REPOSITORY_ID')):raise ValueError('Repository token identity mismatch')
 ref=request(BASE+'/git/ref/heads/main');parent=ref['object']['sha']
 old=fetch_json('inbox/index.json',parent,request);old_recipient=fetch_json('inbox/recipient.json',parent,request)
 if old_recipient and recipient(old_recipient)['kid']!=public['kid']:raise ValueError('Cannot replace a different recipient key')
 if old and manifest(old)['kid']!=public['kid']:raise ValueError('Existing inbox belongs to another recipient')
 prior={v['id']:v['sha256'] for v in (old or {}).get('items',[])};entries={v['id']:v['sha256'] for v in index['items']}
 if any(entries.get(k)!=v for k,v in prior.items()):raise ValueError('Earlier reports must not be removed or changed')
 new=[i for i in index['items'] if i['id'] not in prior];tree=[]
 for item in new:
  p=directory/(item['id']+'.json');body=p.read_text();e=json.loads(body)
  if hashlib.sha256(body.encode()).hexdigest()!=item['sha256'] or set(e)!={'format','version','kid','id','wrappedKey','iv','ciphertext'} or e['format']!='MY-STOCK-LAB-SEALED-REPORT' or e['version']!=1 or e['kid']!=public['kid'] or e['id']!=item['id']:raise ValueError('Only hash-verified ciphertext envelopes may be published')
  for field in ['wrappedKey','iv','ciphertext']:base64.b64decode(e[field],validate=True)
  tree.append({'path':'inbox/'+p.name,'mode':'100644','type':'blob','content':body})
 if not new and old_recipient:return {'added':0,'stage':'already_published'}
 tree.append({'path':'inbox/index.json','mode':'100644','type':'blob','content':json.dumps(index,indent=2)+'\n'})
 if not old_recipient:tree.append({'path':'inbox/recipient.json','mode':'100644','type':'blob','content':json.dumps(public,indent=2)+'\n'})
 commit=request(BASE+'/git/commits/'+parent);created=request(BASE+'/git/trees',{'base_tree':commit['tree']['sha'],'tree':tree})
 new_commit=request(BASE+'/git/commits',{'message':'Deliver encrypted scheduled reports','tree':created['sha'],'parents':[parent]})
 request(BASE+'/git/refs/heads/main',{'sha':new_commit['sha'],'force':False},'PATCH')
 return {'added':len(new),'stage':'source_published','commit':new_commit['sha']}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('inbox_directory');parser.add_argument('recipient_file');args=parser.parse_args()
 try:print(json.dumps(publish(args.inbox_directory,json.loads(Path(args.recipient_file).read_text()))))
 except Exception as e:print('Encrypted inbox publish blocked: '+str(e),file=sys.stderr);sys.exit(1)
