"""Official RSS titles, dates and links only; no article bodies or portfolio data."""
from __future__ import annotations
import datetime as dt,email.utils,hashlib,json,re,time,urllib.parse,urllib.request,urllib.robotparser,xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

AGENT='MY-STOCK-LAB personal noncommercial RSS reader'
FORMAT='MY-STOCK-LAB-OFFICIAL-NOTICES'
# Public research coverage, independent of the user's quantities or account.
FEEDS=[
 {'id':'dart-00258689','market':'KR','symbol':'035900','name':'JYP Ent.','code':'00258689'},
 {'id':'dart-00111722','market':'KR','symbol':'006800','name':'미래에셋증권','code':'00111722'},
 {'id':'dart-00126478','market':'KR','symbol':'010140','name':'삼성중공업','code':'00126478'},
 {'id':'dart-00159193','market':'KR','symbol':'015760','name':'한국전력공사','code':'00159193'},
 {'id':'dart-00126380','market':'KR','symbol':'005930','name':'삼성전자','code':'00126380'},
 {'id':'dart-00164779','market':'KR','symbol':'000660','name':'SK하이닉스','code':'00164779'},
 {'id':'dart-01515323','market':'KR','symbol':'373220','name':'LG에너지솔루션','code':'01515323'},
 {'id':'dart-00877059','market':'KR','symbol':'207940','name':'삼성바이오로직스','code':'00877059'},
 {'id':'nike-nke','market':'US','symbol':'NKE','name':'NIKE','url':'https://investors.nike.com/news-events/press-releases/rss'},
]
for f in FEEDS:f['url']=f.get('url','https://dart.fss.or.kr/api/companyRSS.xml?crpCd='+f.get('code',''))
HOSTS={'dart.fss.or.kr','investors.nike.com'}
class OfficialRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if not allowed_source(newurl):raise ValueError('Unapproved RSS redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def allowed_source(url):
 u=urllib.parse.urlparse(url)
 return u.scheme=='https' and u.hostname in HOSTS and not u.username and not u.password and u.port in [None,443] and (u.path=='/robots.txt' or url in [f['url'] for f in FEEDS])
def download(url):
 if not allowed_source(url):raise ValueError('Unapproved RSS source')
 with urllib.request.build_opener(OfficialRedirect).open(urllib.request.Request(url,headers={'User-Agent':AGENT}),timeout=25) as r:
  raw=r.read(1500001)
  if len(raw)>1500000:raise ValueError('RSS size limit')
  return raw.decode('utf-8-sig')
def parsed_time(raw):
 value=email.utils.parsedate_to_datetime(raw or '')
 if not value.tzinfo:raise ValueError('RSS timezone missing')
 return value.astimezone(dt.timezone.utc)
def canonical_link(raw,feed):
 u=urllib.parse.urlparse(raw or '')
 if u.scheme!='https' or u.username or u.password or u.port not in [None,443] or u.fragment:raise ValueError('Unsafe official item link')
 if feed['market']=='KR':
  query=urllib.parse.parse_qs(u.query)
  if u.hostname!='dart.fss.or.kr' or u.path!='/api/link.jsp' or set(query)!={'rcpNo'} or len(query['rcpNo'])!=1 or not re.fullmatch(r'\d{14}',query['rcpNo'][0]):raise ValueError('DART receipt link mismatch')
  return 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+query['rcpNo'][0]
 if u.hostname!='investors.nike.com' or not re.fullmatch(r'/news-events/press-releases/detail/\d+/[a-zA-Z0-9%/_\-]+',u.path) or u.query:raise ValueError('NIKE release link mismatch')
 return raw
def parse_feed(raw,feed,now):
 if re.search(r'<!\s*(?:DOCTYPE|ENTITY)',raw,re.I):raise ValueError('RSS entity declarations rejected')
 root=ET.fromstring(raw);channel=root.find('channel')
 if root.tag!='rss' or channel is None:raise ValueError('RSS channel missing')
 title=channel.findtext('title') or ''
 expected='DART : (' if feed['market']=='KR' else 'NIKE'
 if expected not in title or (feed['market']=='KR' and feed['name']+'의 공시' not in title) or (feed['market']=='US' and '(NKE)' not in title):raise ValueError('Official channel company mismatch')
 entries=channel.findall('item')
 if len(entries)>2000:raise ValueError('RSS item limit')
 result=[];rejected=0;seen=set()
 for item in entries:
  try:
   text=' '.join((item.findtext('title') or '').split())
   if not text or len(text)>800 or '<' in text or '>' in text:raise ValueError('Unsafe item title')
   if feed['market']=='KR':
    company=re.sub(r'^\([^)]*\)','',text).split(' - ',1)[0]
    if company!=feed['name']:raise ValueError('Related issuer is not the selected issuer')
   stamp=parsed_time(item.findtext('pubDate'))
   if stamp>now+dt.timedelta(minutes=5):raise ValueError('Future RSS item')
   url=canonical_link(item.findtext('link'),feed)
   if url in seen:continue
   seen.add(url);result.append({'title':text,'url':url,'publishedAt':stamp.isoformat()})
  except (ValueError,TypeError,IndexError):rejected+=1
 result.sort(key=lambda r:r['publishedAt'],reverse=True)
 return {'id':feed['id'],'market':feed['market'],'symbol':feed['symbol'],'name':feed['name'],'sourceURL':feed['url'],'status':'partial' if rejected else 'available' if result else 'empty','availableCount':len(result),'truncated':len(result)>12,'rejectedRows':rejected,'items':result[:12]}
def collect(reader=download,pause=time.sleep,now=None):
 now=now or dt.datetime.now(dt.timezone.utc);robots={};feeds=[];errors=[]
 for feed in FEEDS:
  try:
   origin='https://'+urllib.parse.urlparse(feed['url']).hostname
   if origin not in robots:
    robot=urllib.robotparser.RobotFileParser();robot.parse(reader(origin+'/robots.txt').splitlines());robots[origin]=robot
   if not robots[origin].can_fetch(AGENT,feed['url']):raise ValueError('RSS robots disallow')
   pause(1);feeds.append(parse_feed(reader(feed['url']),feed,now))
  except Exception:
   errors.append({'id':feed['id'],'code':'official_rss_unavailable_or_changed'})
   feeds.append({'id':feed['id'],'market':feed['market'],'symbol':feed['symbol'],'name':feed['name'],'sourceURL':feed['url'],'status':'failed','availableCount':0,'truncated':False,'rejectedRows':0,'items':[]})
 if not any(f['status'] in ['available','empty'] for f in feeds):raise ValueError('No completely validated official RSS feed')
 return {'format':FORMAT,'version':1,'collectedAt':now.isoformat(),'feeds':feeds,'errors':errors}
def payload(snapshot):
 collected=dt.datetime.fromisoformat(snapshot['collectedAt']);date=collected.astimezone(ZoneInfo('Asia/Seoul')).date().isoformat();identity=hashlib.sha256(json.dumps(snapshot,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return {'version':1,'deliveryId':'official-notices:'+identity,'report':{'market':'KR','date':date,'title':'공식 공시·기업 소식 '+date,'source':'DART 회사별 RSS · NIKE IR RSS · 제목과 원문 링크, 투자 보고서와 별도','created':collected.isoformat(),'body':json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))}}
