"""Public, synthetic browser check. Never loads any owner's vault or API keys."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,os,socket,subprocess,tempfile,time
ROOT=Path(__file__).resolve().parents[1]
def main():
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 server=subprocess.Popen(['python3','-m','http.server',str(port),'--bind','127.0.0.1','--directory',str(ROOT)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  with sync_playwright() as p,tempfile.TemporaryDirectory(prefix='msl-webkit-qa-') as folder:
   browser=p.webkit.launch(headless=True);context=browser.new_context(viewport={'width':390,'height':844},service_workers='block');page=context.new_page();errors=[];external=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def guard(route):
    if route.request.url.startswith('http://127.0.0.1:'):route.continue_()
    else:external.append(route.request.url.split('?')[0]);route.abort()
   page.route('**/*',guard)
   for attempt in range(20):
    try:page.goto(f'http://127.0.0.1:{port}/',wait_until='networkidle');break
    except Exception:
     if attempt==19:raise
     time.sleep(.2)
   version=page.evaluate("async()=>(await import('./lab.js?v=2.8.0')).RELEASE")
   page.evaluate("""async()=>{const {empty,derive,encrypt}=await import('./core.js?v=2.8.0');const {normalize}=await import('./lab.js?v=2.8.0');const {writeEnvelope}=await import('./vault-store.js?v=2.8.0');const db=normalize(empty());db.cash=1;db.holdings=[{id:'synthetic',name:'QA 합성 기업 · 실제 투자 아님',symbol:'QATEST',market:'US',currency:'USD',qty:1,avg:10,verified:false}];db.recommendations=[{id:'qa-webkit-rec',name:'QA synthetic paper pick',symbol:'QAREC',date:'2026-01-31',priceDate:'2026-01-30',price:100,currency:'USD',benchmark:null,source:'QA unadjusted prices',horizon:'중기',reason:'QA original',created:'2026-01-30T23:00:00Z',revisions:[],observations:[{date:'2026-02-07',price:55,benchmark:null,source:'QA raw close'}]}];const {createActionReview,appendActionReview}=await import('./action-returns.js?v=2.8.0');appendActionReview(db,createActionReview(db,'qa-webkit-rec',{through:'2026-02-28',coverageSource:'https://issuer.example/qa',rawPricesConfirmed:true,completeConfirmed:true},[{symbol:'QAREC',type:'SPLIT',date:'2026-02-02',newShares:2,oldShares:1,source:'https://issuer.example/qa'},{symbol:'QAREC',type:'DIVIDEND',date:'2026-02-03',currency:'USD',amount:1,payDate:'2026-02-10',source:'https://issuer.example/qa'}]));const salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive('synthetic-webkit-test-password',salt);await writeEnvelope(await encrypt(db,key,salt));}""")
   page.reload();page.locator('#unlock [name=password]').fill('synthetic-webkit-test-password');page.locator('#unlock button[type=submit]').click();page.locator('main h1').wait_for()
   page.locator('nav [data-page=ideas]').click();assert '세전 가상 총수익률' in page.locator('main').inner_text();page.locator('nav [data-page=settings]').click();page.locator('[data-act=cash]').click();page.locator('dialog [name=cash]').fill('2');page.locator('dialog button[type=submit]').click();page.locator('dialog').wait_for(state='hidden')
   result=page.evaluate("""async()=>{const {readEnvelope}=await import('./vault-store.js?v=2.8.0');const {decrypt}=await import('./core.js?v=2.8.0');const {listRecoveries}=await import('./recovery.js?v=2.8.0');return {cash:(await decrypt(await readEnvelope(),'synthetic-webkit-test-password')).db.cash,recoveries:(await listRecoveries()).length};}""");assert result['cash']==2 and result['recoveries']>=2
   page.get_by_role('button',name='기기 내 자동 복구점',exact=True).click()
   with page.expect_download() as saved:page.locator('dialog [data-act^="recovery-export:"]').first.click()
   target=Path(folder)/'recovery.encrypted.json';saved.value.save_as(str(target));assert json.loads(target.read_text())['format']=='MY-STOCK-LAB-AES256';assert page.locator('dialog').is_visible();page.locator('dialog [data-act=close]').first.click()
   with page.expect_download() as saved:page.get_by_role('button',name='암호화 백업 내보내기',exact=True).click()
   target=Path(folder)/'backup.encrypted.json';saved.value.save_as(str(target));assert json.loads(target.read_text())['format']=='MY-STOCK-LAB-AES256'
   screens=0
   for width,height in [(320,640),(390,844),(466,678),(626,890),(890,626),(1280,800)]:
    page.set_viewport_size({'width':width,'height':height})
    for tab in ['dashboard','holdings','kr','us','ideas','settings']:
     page.locator('nav [data-page='+tab+']').click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,tab);screens+=1
   assert not errors,errors;assert not external,external;browser.close();print(json.dumps({'status':'pass','engine':'WebKit on Linux, not physical iPhone','appVersion':version,'responsiveScreens':screens,'encryptedVault':True,'automaticRecovery':True,'verifiedBackup':True,'reviewedActionReturns':True,'ownerDataUsed':False,'externalRequests':len(external),'jsErrors':errors}))
 finally:server.terminate();server.wait(timeout=10)
if __name__=='__main__':main()
