"""Low-frequency personal research from the issuer's public, robots-allowed pages.

Only numeric facts, dates and source links are retained. No account data, API key,
holdings, raw HTML or tax inference is published. Estimated ROC is never final tax.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,re,time,urllib.request,urllib.parse,urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

ORIGIN='https://yieldmaxetfs.com'
FUNDS={'GOOY':'GOOGL','NVDY':'NVDA','TSLY':'TSLA'}
AGENT='MY-STOCK-LAB personal noncommercial fund research'
class OfficialOnly(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if urllib.parse.urlparse(newurl).hostname not in ['yieldmaxetfs.com','www.yieldmaxetfs.com']:raise ValueError('Unapproved issuer redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def download(url):
 u=urllib.parse.urlparse(url)
 if u.scheme!='https' or u.hostname not in ['yieldmaxetfs.com','www.yieldmaxetfs.com'] or u.username or u.password or u.port not in [None,443]:raise ValueError('Unapproved issuer source')
 with urllib.request.build_opener(OfficialOnly).open(urllib.request.Request(url,headers={'User-Agent':AGENT}),timeout=30) as r:
  raw=r.read(2500001)
  if len(raw)>2500000:raise ValueError('Issuer response too large')
  return raw.decode('utf-8')
class Page(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.skip=0;self.text=[];self.tables=[];self.table=None;self.row=None;self.cell=None;self.head=None;self.heading=''
 def handle_starttag(self,tag,attrs):
  if tag in ['script','style']:self.skip+=1
  if self.skip:return
  if tag in ['h1','h2','h3']:self.head=[]
  if tag=='table':self.table={'heading':self.heading,'rows':[],'classes':dict(attrs).get('class','')}
  if tag=='tr' and self.table is not None:self.row=[]
  if tag in ['th','td'] and self.row is not None:self.cell=[]
 def handle_data(self,s):
  if self.skip:return
  self.text.append(s)
  if self.head is not None:self.head.append(s)
  if self.cell is not None:self.cell.append(s)
 def handle_endtag(self,tag):
  if tag in ['script','style']:self.skip=max(0,self.skip-1);return
  if self.skip:return
  if tag in ['h1','h2','h3'] and self.head is not None:self.heading=' '.join(' '.join(self.head).split());self.head=None
  if tag in ['th','td'] and self.cell is not None:self.row.append(' '.join(' '.join(self.cell).split()));self.cell=None
  if tag=='tr' and self.row is not None:
   if self.table is not None:self.table['rows'].append(self.row)
   self.row=None
  if tag=='table' and self.table is not None:self.tables.append(self.table);self.table=None
 def plain(self):return ' '.join(' '.join(self.text).split())
def day(raw):
 raw=raw.strip()
 for fmt in ['%m/%d/%Y','%A, %B %d, %Y','%B %d, %Y']:
  try:return dt.datetime.strptime(raw,fmt).date().isoformat()
  except ValueError:pass
 raise ValueError('Unrecognized official date')
def scalar(raw,percent=False):
 if raw.strip() in ['','—','-','N/A']:return None
 s=raw.replace('$','').replace(',','').replace('%','').strip()
 if not re.fullmatch(r'\d+(?:\.\d+)?',s):raise ValueError('Unrecognized official number')
 n=float(s)
 if not 0<=n<1000000 or (percent and n>100):raise ValueError('Official value outside expected range')
 return n
def parse_fund(raw,symbol,asof):
 if symbol not in FUNDS:raise ValueError('Unapproved fund')
 p=Page();p.feed(raw);text=p.plain()
 section=text.split('Fund Details',1)[1].split('Distributions',1)[0]
 if not re.search(r'Ticker:\s*'+symbol+r'\b',section):raise ValueError('Fund identity mismatch')
 market=section.split('Net Assets:',1)[1]
 dates=re.findall(r'As of\s+(\d{1,2}/\d{1,2}/\d{4})',market)
 if len(dates)!=1:raise ValueError('NAV date missing or ambiguous')
 nav_date=day(dates[0])
 if nav_date>asof:raise ValueError('Future NAV date')
 nav=scalar(re.search(r'\bNAV:\s*(\$[\d,.]+)',market).group(1));close=scalar(re.search(r'Closing Price:\s*(\$[\d,.]+)',market).group(1))
 if not nav or not close:raise ValueError('NAV/close must be positive')
 rate=re.search(r'([\d.]+)%\s+Distribution Rate\*?\s+([\d.]+)%\s+30-Day SEC Yield\*?\*?\s+As of:\s*(\d{1,2}/\d{1,2}/\d{4})',text)
 if not rate:raise ValueError('Distribution-rate reference date missing')
 rate_date=day(rate.group(3))
 if rate_date>asof:raise ValueError('Future distribution rate')
 sec_date_match=re.search(r'30-Day SEC Yield:\*?\s*[\d.]+%\s+As of\s+(\d{1,2}/\d{1,2}/\d{4})',section)
 if not sec_date_match:raise ValueError('SEC yield reference date missing')
 sec_date=day(sec_date_match.group(1))
 if sec_date>asof:raise ValueError('Future SEC yield date')
 distributions=[];rejected=0
 tables=[t for t in p.tables if 'distributions-table' in t['classes']]
 if len(tables)!=1:raise ValueError('Distribution table missing or ambiguous')
 if tables[0]['rows'][0]!=['DISTRIBUTION PER SHARE','DECLARED DATE','EX DATE','RECORD DATE','PAYABLE DATE','ROC']:raise ValueError('Distribution columns changed')
 for row in tables[0]['rows'][1:]:
  try:
   if len(row)!=6:raise ValueError('Distribution columns changed')
   amount=scalar(row[0]);declared,ex,record,pay=[day(v) for v in row[1:5]];roc=scalar(row[5],True)
   if amount is None or declared>asof or not declared<=ex<=record<=pay or (dt.date.fromisoformat(pay)-dt.date.fromisoformat(ex)).days>45:raise ValueError('Inconsistent declared distribution dates')
   distributions.append({'amount':amount,'declaredDate':declared,'exDate':ex,'recordDate':record,'payDate':pay,'rocPercent':roc,'rocStatus':'estimate','rocSourceURL':ORIGIN+'/TAX-Documents/'})
  except (ValueError,TypeError):rejected+=1
 if not distributions:raise ValueError('No verified distribution rows')
 distributions=sorted(distributions,key=lambda r:(r['declaredDate'],r['exDate']),reverse=True)[:8]
 return {'symbol':symbol,'underlyingSymbol':FUNDS[symbol],'currency':'USD','sourceURL':ORIGIN+'/our-etfs/'+symbol.lower()+'/',
  'nav':{'date':nav_date,'value':nav},'close':{'date':nav_date,'value':close},'distributionRate':{'date':rate_date,'value':float(rate.group(1))},
  'secYield':{'date':sec_date,'value':float(rate.group(2))},'distributions':distributions,'rejectedSourceRows':rejected}
def parse_schedule(raw,asof):
 p=Page();p.feed(raw)
 matching=[t for t in p.tables if 'Distribution Schedule for Group 2 ETFs' in t['heading']]
 if len(matching)!=1:raise ValueError('Group 2 calendar missing or ambiguous')
 # Confirm all supported symbols belong to the named group in the issuer grouping.
 grouping=[t for t in p.tables if t['rows'] and any('Group 2 ETFs' in c for c in t['rows'][0])]
 if len(grouping)!=1 or not all(any(s in row[1:-1] for row in grouping[0]['rows'][1:] if len(row)>=3) for s in FUNDS):raise ValueError('Fund group mapping not verified')
 rows=[]
 for r in matching[0]['rows'][1:]:
  if len(r)!=3:raise ValueError('Group 2 calendar columns changed')
  declared,ex,pay=[day(v) for v in r]
  if not declared<=ex<=pay:raise ValueError('Invalid planned calendar order')
  if pay>=asof:rows.append({'declaredDate':declared,'exDate':ex,'recordDate':ex,'payDate':pay,'amount':None,'status':'planned'})
 return {'sourceURL':ORIGIN+'/distribution-schedule/','group':2,'symbols':list(FUNDS),'upcoming':sorted(rows,key=lambda r:r['payDate'])[:3]}
def collect(reader=download,*,now=None,pause=time.sleep):
 now=now or dt.datetime.now(dt.timezone.utc);asof=now.astimezone(ZoneInfo('Asia/Seoul')).date().isoformat()
 robot=urllib.robotparser.RobotFileParser();robot.parse(reader(ORIGIN+'/robots.txt').splitlines());funds=[];errors=[]
 for symbol in FUNDS:
  url=ORIGIN+'/our-etfs/'+symbol.lower()+'/'
  try:
   if not robot.can_fetch(AGENT,url):raise ValueError('Robots disallow fund source')
   pause(1);funds.append(parse_fund(reader(url),symbol,asof))
  except Exception:errors.append({'symbol':symbol,'code':'official_source_unavailable_or_changed'})
 calendar=None
 try:
  url=ORIGIN+'/distribution-schedule/'
  if not robot.can_fetch(AGENT,url):raise ValueError('Robots disallow calendar')
  pause(1);calendar=parse_schedule(reader(url),asof)
 except Exception:errors.append({'symbol':'calendar','code':'official_calendar_unavailable_or_changed'})
 if not funds:raise ValueError('No validated official fund data; do not publish a report')
 return {'format':'MY-STOCK-LAB-OFFICIAL-FUNDS','version':1,'collectedAt':now.isoformat(),'funds':funds,'calendar':calendar,'errors':errors}
def payload(snapshot):
 collected=dt.datetime.fromisoformat(snapshot['collectedAt']);date=collected.astimezone(ZoneInfo('Asia/Seoul')).date().isoformat()
 identity=hashlib.sha256(json.dumps(snapshot,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return {'version':1,'deliveryId':'official-funds:'+identity,'report':{'market':'US','date':date,'title':'커버드콜 운용사 공식자료 '+date,'source':'YieldMax 운용사 공식 페이지 · 기준일별 공시 수치 · ROC는 추정치','created':collected.isoformat(),'body':json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))}}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
 try:
  data=collect();p=Path(args.output);p.write_text(json.dumps(payload(data),ensure_ascii=False));p.chmod(0o600)
  print(json.dumps({'status':'collected','funds':len(data['funds']),'sourceErrors':data['errors'],'plaintextPublic':False}))
 except Exception as error:print(json.dumps({'status':'blocked','reason':str(error)[:150]}));raise SystemExit(1)
