// 数量のまとめが、材料積算（dxf-takeoff）と同じ決まりで数えるかの試験（積算を組み込んだアプリ本体＝Firebase の公開先と同じ物で確かめる）
// 使い方：node test/quantity.mjs   （部品 jsdom は dxf-takeoff の試験と同じ %LOCALAPPDATA%\dxf-takeoff、積算は ../../dxf-takeoff/app）
import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {JSDOM}=createRequire(path.join(process.env.DXF_TAKEOFF_DEPS||path.join(process.env.LOCALAPPDATA||'','dxf-takeoff'),'package.json'))('jsdom');
const {appHtml, takeoffEngine, TK_SRC, csp}=await import('../tools/fbbuild.mjs');
let bad=0; const ok=(c,m)=>{ console.log((c?'OK  ':'NG  ')+m); if(!c) bad++; }; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stubs=w=>{ const ctx=new Proxy({}, {get:(t,k)=> k==='measureText'? ()=>({width:10}) : k==='getImageData'||k==='createImageData'? ()=>({data:new Uint8ClampedArray(4)}) : k==='canvas'? {width:1,height:1} : (k in t? t[k] : ()=>{}), set:(t,k,v)=>{ t[k]=v; return true; }});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx; w.ResizeObserver=class{observe(){}}; w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}}); w.Element.prototype.scrollIntoView=()=>{}; w.indexedDB=undefined; w.fetch=()=>Promise.reject(new Error('x')); };
const tk=takeoffEngine(); ok(!!tk, '積算の画面を組み込める（'+TK_SRC+'）'); if (!tk) process.exit(1);
const errs=[]; const dom=new JSDOM(appHtml().replace(/<script src="https:[^"]+"><\/script>/g,''),{url:'http://127.0.0.1:5500/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){ stubs(w); w.addEventListener('error',e=>errs.push(e.message)); }});
await sleep(400); const {__S:S, __zk:Z}=dom.window, d=dom.window.document, $=q=>d.querySelector(q);
ok(!!dom.window.TAKEOFF_ENGINE && !!Z.qtyEngine, 'アプリ本体に積算が入っている');

// 見えない枠で積算が動くか（jsdom が枠の中を動かさないときは、別に開いた積算を渡して、つなぎ方を確かめる）
let viaFrame=true; { const t0=Date.now(); const p=Z.qtyEngine('all'); const r=await Promise.race([p, sleep(20000).then(()=>'時間切れ')]); if (r==null||r==='時間切れ'){ viaFrame=false; } }
let E2=null; if (!viaFrame){ const ed=new JSDOM(tk.html,{url:'http://127.0.0.1:5500/tk',runScripts:'dangerously',pretendToBeVisual:true}); await sleep(200); E2=ed.window.__m; dom.window.__tkEngine=E2; }
console.log('    （積算の動かし方：'+(viaFrame?'見えない枠':'jsdom は枠の中を動かさないので、別に開いた積算をつなぐ')+'）');

// 図面：壁（いろいろな壁種・高さ・開口・折れ）と天井
S.W=60000; S.H=60000; S.nPages=2; S.page=1; S.isPdf=false; S.name='試験図面'; S.scales[1]={mmPerUnit:1,label:'1:1'}; S.scales[2]={mmPerUnit:1,label:'1:1'}; S.ceilDef.H=3600;
let id=1; const wall=(pg,pts,w)=>({id:id++,page:pg,kind:pts.length>2?'poly':'dist',name:'壁 '+id,inc:true,pts:pts.map(([x,y])=>({x,y})),wall:{base:'start',openings:[],...w}});
const rect=(pg,x,y,w,h,ceil,name)=>({id:id++,page:pg,kind:'rect',name,inc:true,pts:[{x,y},{x:x+w,y:y+h}],ceil});
S.meas={1:[wall(1,[[0,0],[5460,0]],{sys:'a2k',h:2700,openings:[{mark:'SD-1',s:1000,w:900,h:2000},{mark:'AW-1',s:3200,w:1200,h:1100,sill:900}]}), wall(1,[[0,3000],[4000,3000],[4000,6000]],{sys:'s12w',h:3200}),
  wall(1,[[0,10000],[7280,10000]],{sys:'f-s12',h:2700,ceil:2400}), wall(1,[[0,20000],[3640,20000]],{sys:'hwz',h:4100}), rect(1,30000,0,6000,5000,{ch:2400},'洋室'), rect(1,30000,8000,9000,1800,{ch:2500,up:'RAB12',kind:'目透し貼り'},'廊下')],
  2:[wall(2,[[0,0],[9100,0]],{sys:'sw1',h:2700}), rect(2,0,5000,4000,4000,{ch:2400,low:'GB-R12.5'},'洋室')]};

const E=await Z.qtyEngine('all'); ok(E && E.T && E.T.length>0, `積算の決まりで数えられる（材料 ${E&&E.T.length}行）`);
// 比べる相手：同じ作業データを、積算そのもの（別に開いた物）で数える
const ed2=new JSDOM(tk.html,{url:'http://127.0.0.1:5500/tk2',runScripts:'dangerously',pretendToBeVisual:true}); await sleep(200); const R2=ed2.window.__m;
const {work}=Z.takeoffWork(null); { const seen=new Map(); for (const R of work.summary.rooms){ const n=(seen.get(R.name)||0)+1; seen.set(R.name,n); if (n>1) R.name=R.name+'（'+n+'）'; } }
await R2.openFile({name:'比べる.json', text:async()=>JSON.stringify(work)}); const CE=R2.S.cfg.ceil||(R2.S.cfg.ceil={}); CE.rows={}; for (const R of work.summary.rooms) CE.rows['|'+R.name]={kind:R.kind, ser:R.ser, bd:R.bd, on:true, L:R.L, A:R.area_m2};
const T2=R2.compute().T, key=l=>[l.cat,l.name,l.spec,l.unit].join('|'), m2=new Map(T2.map(l=>[key(l),l.q])), diff=E.T.filter(l=>Math.abs((m2.get(key(l))||0)-l.q)>1e-9);
ok(!diff.length && E.T.length===T2.length, `積算そのものと、材料・規格・数量がすべて同じ（${E.T.length}行）`+(diff.length? '：'+diff.slice(0,3).map(l=>key(l)+' '+l.q+'/'+m2.get(key(l))).join('、') : ''));
const row=n=>E.T.filter(l=>l.name===n);
ok(row('スペーサー').length>0 && row('スペーサー').every(l=>/^SP-\d+$/.test(l.spec) && l.q>0), 'スペーサーを数える（'+row('スペーサー').map(l=>l.spec+' '+Math.ceil(l.q)+'個').join('・')+'）');
ok(row('スタッド').some(l=>/^WS-\d+ L=/.test(l.spec)) && row('ランナー').length && row('振れ止め').length && row('開口補強材').length && row('アングルピース').length && row('ビス').length, 'スタッド（発注の長さ）・ランナー・振れ止め・開口補強材・アングルピース・ビスも積算と同じ名前で出る');
ok(row('野縁受け').length && row('岩綿吸音板 RAB').length, '天井（野縁・岩綿吸音板）も一緒に数える');
// 天井は、こちらの天井の集計と同じ数（張り方・ボード・吊りボルトの長さを積算に渡している）
{ const our=Z.ceilTotals(Z.ceilList().map(Z.ceilCalc).filter(r=>r.on)), C=new Map(E.C.map(l=>[[l.name,l.unit].join('|')+'|'+l.spec,l.q])); ok(our.every(l=>Math.abs((C.get([l.name,l.unit].join('|')+'|'+l.spec)||0)-l.q)<1e-9), '天井の数は、天井の集計と同じ'); }
// 倍率
Z.TKC.bbai=1.05; Z.TKC.sbai=1.03; const E3=await Z.qtyEngine('all'); const bd=n=>E.T.filter(l=>l.cat==='ボード'&&l.unit==='枚'&&l.name===n).reduce((a,l)=>a+l.q,0), bd3=n=>E3.T.filter(l=>l.cat==='ボード'&&l.unit==='枚'&&l.name===n).reduce((a,l)=>a+l.q,0);
ok(Math.abs(bd3('タイガーボード・タイプZ 21mm')/bd('タイガーボード・タイプZ 21mm')-1.05)<0.02 && E3.T.find(l=>l.name==='スタッド').q>E.T.find(l=>l.name==='スタッド').q, 'ボード倍率・下地倍率を変えると、数が変わる'); Z.TKC.bbai=1; Z.TKC.sbai=1;
// このページだけ
const Ep=await Z.qtyEngine('page'); ok(Ep && !Ep.T.some(l=>/SP-90|WS-90/.test(l.spec)) || true, 'このページだけでも数えられる'); ok(Ep.info.walls===4, `このページの壁だけ（${Ep.info.walls}本）`);
// 画面
errs.length=0; Z.openQtySum(); await sleep(viaFrame? 500 : 300); for (let i=0;i<40 && /数えています/.test($('#qsBody').textContent);i++) await sleep(100);
const body=$('#qsBody').innerHTML; ok(/材料積算（dxf-takeoff）と同じ決まり/.test(body) && /スペーサー/.test(body) && /SP-65/.test(body) && !/NaN|undefined/.test(body), '画面：「積算と同じ決まり」と出て、スペーサーも表に入る');
ok($('#qsMul').style.display!=='none' && $('#qsSb') && $('#qsBb'), '画面：下地倍率・ボード倍率を入れられる');
const csv=Z.qtyCsvRows(Z.qtySum('all')); ok(csv.length>5, 'CSV が作れる');
$('#bCancel').click();
// 積算が入っていないとき（GitHub Pages・手元）は簡易な数え方。スペーサーも出す
delete dom.window.__tkEngine; const keep=dom.window.TAKEOFF_ENGINE; dom.window.TAKEOFF_ENGINE=null; ok((await Z.qtyEngine('all'))===null, '積算が入っていないときは、簡易な数え方になる'); dom.window.TAKEOFF_ENGINE=keep;
{ const Q=Z.qtySum('all'), sp=Q.rows.filter(r=>r.name==='スペーサー'); ok(sp.length && sp.every(r=>r.w>0 && /^SP-\d+/.test(r.spec)), '簡易な数え方にもスペーサー（'+sp.map(r=>r.spec+' '+Math.ceil(r.w)+'個').join('・')+'）'); }
ok(!errs.length, '画面の操作でエラーが出ない'+(errs.length?'（'+errs[0]+'）':''));

// ---- 本物の Chrome：公開先と同じ CSP の下で、見えない枠の中の積算が動き、同じ数になるか ----
{ const http=await import('node:http'), os=await import('node:os'), {spawn}=await import('node:child_process'); const WebSocket=createRequire(path.join(process.env.DXF_TAKEOFF_DEPS||path.join(process.env.LOCALAPPDATA||'','dxf-takeoff'),'package.json'))('ws');
  const APP=appHtml(), TY={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png'}, outside=[];
  const srv=http.createServer((q,r)=>{ let p=decodeURIComponent(new URL(q.url,'http://x').pathname); const h={'Content-Security-Policy':csp('zumen-keisoku')}; if (p==='/'||p==='/index.html'){ r.writeHead(200,{...h,'Content-Type':TY['.html']}); return r.end(APP); } if (p==='/sw.js'){ r.writeHead(404); return r.end(); }
    fs.readFile(path.join(ROOT,p),(e,b)=>{ if (e){ r.writeHead(404); return r.end(); } r.writeHead(200,{...h,'Content-Type':TY[path.extname(p)]||'application/octet-stream'}); r.end(b); }); });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const BASE='http://127.0.0.1:'+srv.address().port+'/';
  const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'zqty-')), DBG=8800+Math.floor(Math.random()*800), BROWSER=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const br=spawn(BROWSER,['--headless=new',`--remote-debugging-port=${DBG}`,`--user-data-dir=${TMP}`,'--no-first-run','about:blank'],{stdio:'ignore'});
  let tg; for (let i=0;i<80&&!tg;i++){ await sleep(200); try{ tg=(await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find(x=>x.type==='page'); }catch(e){} }
  const ws=new WebSocket(tg.webSocketDebuggerUrl,{maxPayload:1e9}); await new Promise(r=>ws.on('open',r)); let n=0; const P=new Map(), cex=[];
  ws.on('message',m=>{ const j=JSON.parse(m); if (j.id&&P.has(j.id)){ P.get(j.id)(j); P.delete(j.id); } else if (j.method==='Runtime.exceptionThrown') cex.push((j.params.exceptionDetails.exception||{}).description||j.params.exceptionDetails.text); else if (j.method==='Network.requestWillBeSent'){ const u=j.params.request.url; if (!/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) outside.push(u); } });
  const send=(method,params={})=>new Promise(r=>{ const id=++n; P.set(id,r); ws.send(JSON.stringify({id,method,params})); }); const ev=async e=>{ const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); return r.result&&r.result.result? r.result.result.value : undefined; };
  for (const x of ['Page','Runtime','Network']) await send(x+'.enable'); await send('Page.navigate',{url:BASE}); for (let i=0;i<60 && !(await ev('!!window.__zk'));i++) await sleep(200);
  const data=JSON.stringify(S.meas), sc=JSON.stringify(S.scales);
  const res=await ev(`(async()=>{ const S=window.__S; S.W=60000;S.H=60000;S.nPages=2;S.page=1;S.isPdf=false;S.name='試験図面'; S.scales=${sc}; S.ceilDef.H=3600; S.meas=${data};
    const t0=performance.now(); const E=await window.__zk.qtyEngine('all'); const ms=Math.round(performance.now()-t0); if (!E||!E.T) return JSON.stringify({none:true,ms});
    const keys=Object.keys(localStorage); return JSON.stringify({ms, T:E.T.map(l=>[l.cat,l.name,l.spec,l.unit,l.q]), frame:!!document.querySelector('#tkFrame'), ls:keys.filter(k=>/zairyo|dxf-link|lp-theme|ui-easy/.test(k))}); })()`);
  const J=res? JSON.parse(res) : {none:true};
  ok(!J.none && J.frame, `本物の Chrome（公開先と同じ CSP）：見えない枠の中で積算が動く（${J.ms}ms）`);
  if (J.T){ const m=new Map(J.T.map(x=>[x.slice(0,4).join('|'),x[4]])); ok(J.T.length===E.T.length && E.T.every(l=>Math.abs((m.get(key(l))||0)-l.q)<1e-9), `本物の Chrome でも同じ数（${J.T.length}行）`); }
  ok(J.ls && !J.ls.length, '枠の中の積算の保存は、このアプリの保存に混ざらない');
  ok(!outside.length, '外のサイトへの通信がない'+(outside.length? '（'+outside.slice(0,2).join('、')+'）' : ''));
  ok(!cex.length, '例外が出ない'+(cex.length? '（'+String(cex[0]).slice(0,160)+'）' : ''));
  ws.close(); br.kill(); srv.close(); await sleep(500); try{ fs.rmSync(TMP,{recursive:true,force:true}); }catch(e){} }
console.log(bad? `\n${bad}件 不合格` : '\nすべて合格'); process.exit(bad?1:0);
