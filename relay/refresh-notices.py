"""Collect public official RSS notices, encrypt them, preserve the inbox, verify live Pages.
Uses connected CLI normally, or the repository's short-lived Actions token.
"""
from __future__ import annotations
import argparse,base64,hashlib,importlib.util,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE='repos/thesungyoon4413-oss/my-stock-lab';SITE='https://thesungyoon4413-oss.github.io/my-stock-lab/'
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def live(path):
 if not (path=='index.json' or len(path)==69 and path.endswith('.json') and all(c in '0123456789abcdef' for c in path[:-5])):raise ValueError('Unapproved live file')
 req=urllib.request.Request(SITE+'inbox/'+path,headers={'Cache-Control':'no-cache','User-Agent':'MY-STOCK-LAB encrypted delivery verifier'})
 with urllib.request.urlopen(req,timeout=20) as r:
  raw=r.read(2000001)
  if len(raw)>2000000:raise ValueError('Live file size limit')
  return raw
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--github-actions',action='store_true');args=parser.parse_args()
 publisher=module('notices_publisher','publish-inbox.py');collector=module('official_notice_collector','collect-notices.py')
 if args.github_actions:
  if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REPOSITORY')!='thesungyoon4413-oss/my-stock-lab' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise ValueError('Approved Actions environment required')
  repo=publisher.api(BASE)
  if repo.get('private'):raise ValueError('Stop: free public-repository runner required')
 data=collector.collect();payload=collector.payload(data)
 with tempfile.TemporaryDirectory(prefix='msl-official-notices-') as folder:
  root=Path(folder);plain=root/'payload.json';plain.write_text(json.dumps(payload,ensure_ascii=False));plain.chmod(0o600)
  published=None;prepared=None
  for attempt in range(3):
   parent=publisher.api(BASE+'/git/ref/heads/main')['object']['sha'];public=publisher.recipient(publisher.fetch_json('inbox/recipient.json',parent));index=publisher.manifest(publisher.fetch_json('inbox/index.json',parent))
   if public['kid']!=index['kid'] or public['kid']!='5d9fa528747a0633d2d0647481125e082cf236ebbcda7c83264de1009a0ea72a':raise ValueError('Recipient fingerprint differs from the existing inbox')
   inbox=root/'inbox';inbox.mkdir(exist_ok=True);(inbox/'index.json').write_text(json.dumps(index));(root/'recipient.json').write_text(json.dumps(public))
   result=subprocess.run(['node',str(HERE/'seal-report.mjs'),str(root/'recipient.json'),str(plain),str(inbox)],capture_output=True,text=True)
   if result.returncode:raise RuntimeError('Official snapshot encryption failed; plaintext was not published')
   prepared=json.loads(result.stdout)
   try:published=publisher.publish(inbox,public,github_actions=args.github_actions);break
   except Exception:
    if attempt==2:raise
    time.sleep(2)
  plain.unlink(missing_ok=True)
  if published['stage']=='source_published' and args.github_actions:
   # GITHUB_TOKEN pushes do not trigger branch-source Pages builds by themselves.
   publisher.api(BASE+'/pages/builds',{},'POST')
  expected=next(i for i in json.loads((inbox/'index.json').read_text())['items'] if i['id']==prepared['id'])
  verified=False
  for _ in range(30):
   try:
    remote=publisher.manifest(json.loads(live('index.json')))
    if remote['kid']!=public['kid']:raise ValueError('Live recipient mismatch')
    if any(i==expected for i in remote['items']):
     if hashlib.sha256(live(expected['id']+'.json')).hexdigest()!=expected['sha256']:raise ValueError('Live ciphertext hash mismatch')
     verified=True;break
   except (OSError,ValueError):pass
   time.sleep(10)
  if not verified:raise RuntimeError('Published but live Pages verification is pending or failed')
  print(json.dumps({'status':'verified','feeds':len(data['feeds']),'items':sum(len(f['items']) for f in data['feeds']),'sourceErrors':data['errors'],'published':published['stage']=='source_published','commit':published.get('commit'),'liveVerified':True,'plaintextPublic':False}))
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'status':'blocked','reason':str(e)[:200],'plaintextPublic':False}));raise SystemExit(1)
