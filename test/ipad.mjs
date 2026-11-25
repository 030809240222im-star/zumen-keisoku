// iPad で落ちないための試験（本物の Chrome に iPad の条件を与える。図面は試験の中で作る）
//   ・線の多い図面（約35万本）でも、描き終えた命令を捨てながら開き、メモリを抱え込まない
//   ・スナップ用の線は、別に読み直した物とまったく同じ
//   ・拡大の高精細・ページ移動・連続のページ移動・縮小画像・書き出し用の読み直しが動く
//   ・区画の控え：画像・線が描き直した物と同じ／戻る・開き直すときに PDF を読み解かない／同じ名前の別の図面と混ざらない／消すと一緒に消える
//   ・開く途中で落ちた図面は、次に軽い表示で開く
// 使い方：node test/ipad.mjs   （ENGINE=webkit PW=<playwright の場所> で Safari 系のエンジンでも流せる）
import fs from 'node:fs'; import {createHash} from 'node:crypto'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os'; import {spawn} from 'node:child_process'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), req = createRequire(import.meta.url);
let bad = 0; const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; }; const sleep = ms => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zumen-ipad-'));

// ---- 試しの図面：1ページ目は線が多い、2・3ページ目は軽い ----
const LINES = +process.env.LINES || 350000;
const {PDFDocument, StandardFonts, PDFName, rgb} = req(path.join(ROOT, 'lib/pdf-lib.min.js'));
async function makePdf(name){
  const pdf = await PDFDocument.create(), f = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([1191, 842]); const a = ['0.2 w']; let x = 7;
  for (let i = 0; i < LINES; i++){ x = (x * 1103515245 + 12345) % 2147483648; const X = 20 + x % 1100, Y = 20 + (x >> 8) % 780, dx = (x >> 16) % 30 - 15, dy = (x >> 4) % 30 - 15; a.push(i % 40 === 0 ? `${X} ${Y} m ${X + dx} ${Y} ${X + dx} ${Y + dy} ${X} ${Y + dy} c S` : i % 25 === 0 ? `q 1 0 0 1 ${dx} ${dy} cm ${X} ${Y} 6 4 re S Q` : `${X} ${Y} m ${X + dx} ${Y + dy} l S`); }
  p1.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(a.join('\n'))));
  for (let n = 2; n <= 3; n++){ const p = pdf.addPage([842, 595]); p.drawText(`SD-${n}`, {x: 60, y: 500, size: 14, font: f}); p.drawText('S=1/100', {x: 400, y: 40, size: 14, font: f}); for (let i = 0; i < 200; i++) p.drawLine({start: {x: 50 + i * 3, y: 100}, end: {x: 50 + i * 3, y: 300}, thickness: .5, color: rgb(0, 0, 0)}); }
  const out = path.join(TMP, name); fs.writeFileSync(out, await pdf.save()); return out;
}
const PDF = await makePdf('重い図面.pdf'), PDF2 = await makePdf('二つ目.pdf'), PDF4 = await makePdf('落ちた図面.pdf');
// 同じ名前・同じ大きさで、中身の違う図面（改訂図のつもり）
async function revised(dir, lines){ const d = path.join(TMP, dir); fs.mkdirSync(d); const pdf = await PDFDocument.create(), p = pdf.addPage([842, 595]); for (let i = 0; i < lines; i++) p.drawLine({start: {x: 50 + i * 2, y: 100}, end: {x: 50 + i * 2, y: 300}}); const b = Buffer.from(await pdf.save()), out = path.join(d, '同じ名前.pdf'); fs.writeFileSync(out, Buffer.concat([b, Buffer.from('\n%' + ' '.repeat(60000 - b.length - 2))])); return out; }
const REV1 = await revised('改訂前', 120), REV2 = await revised('改訂後', 135); if (fs.statSync(REV1).size !== fs.statSync(REV2).size) throw new Error('試しの図面の大きさが違う');

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; if (p === '/sw.js'){ s.writeHead(404); return s.end(); } fs.readFile(path.join(ROOT, p), (e, d) => { if (e){ s.writeHead(404); return s.end(); } s.writeHead(200, {'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream'}); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}/`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Safari/605.1.15';
const INIT = "try{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});Object.defineProperty(navigator,'platform',{get:()=>'MacIntel'});}catch(e){}";

// ---- ブラウザ（Chrome は CDP、WebKit は playwright）----
async function chrome(){
  const WebSocket = createRequire((process.env.DXF_TAKEOFF_DEPS || (process.env.LOCALAPPDATA || '') + '/dxf-takeoff').replace(/\\/g, '/') + '/package.json')('ws');
  const exe = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  if (!exe){ console.log('Chrome・Edge が無いので飛ばします'); process.exit(0); }
  const DBG = 9300 + Math.floor(Math.random() * 600), br = spawn(exe, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(TMP, 'prof')}`, '--no-first-run', '--disable-gpu', 'about:blank'], {stdio: 'ignore'});
  let tg; for (let i = 0; i < 60 && !tg; i++){ await sleep(200); try{ tg = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find(t => t.type === 'page'); }catch(e){} }
  const ws = new WebSocket(tg.webSocketDebuggerUrl, {maxPayload: 1e9}); await new Promise(r => ws.on('open', r)); let n = 0; const P = new Map(), errs = [];
  ws.on('message', m => { const j = JSON.parse(m); if (j.id && P.has(j.id)){ P.get(j.id)(j); P.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') errs.push((j.params.exceptionDetails.exception || {}).description || j.params.exceptionDetails.text); });
  const send = (method, params = {}) => new Promise(r => { const id = ++n; P.set(id, r); ws.send(JSON.stringify({id, method, params})); });
  for (const d of ['Page', 'Runtime', 'DOM']) await send(d + '.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1024, height: 768, deviceScaleFactor: 2, mobile: true}); await send('Emulation.setUserAgentOverride', {userAgent: UA, platform: 'MacIntel'}); await send('Page.addScriptToEvaluateOnNewDocument', {source: INIT});
  return {name: 'Chrome', errs, ej: async e => { const r = await send('Runtime.evaluate', {expression: e, awaitPromise: true, returnByValue: true}); if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description); return r.result.result.value; },
    go: u => send('Page.navigate', {url: u}), file: async f => { const d = await send('DOM.getDocument', {depth: 1}), q = await send('DOM.querySelector', {nodeId: d.result.root.nodeId, selector: '#file'}); await send('DOM.setFileInputFiles', {nodeId: q.result.nodeId, files: [f]}); },
    heap: async () => { await send('HeapProfiler.collectGarbage'); return (await send('Runtime.getHeapUsage')).result.usedSize / 1048576; }, close: async () => { try{ ws.close(); }catch(e){} br.kill(); }};
}
async function webkit(){
  const {webkit: wk} = createRequire(process.env.PW + '/package.json')('playwright'); const c = await wk.launchPersistentContext(path.join(TMP, 'wk'), {viewport: {width: 1024, height: 768}, deviceScaleFactor: 2, hasTouch: true, userAgent: UA}); await c.addInitScript(INIT); const p = c.pages()[0] || await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); let crashed = false; p.on('crash', () => { crashed = true; errs.push('ページが落ちた'); });
  return {name: 'WebKit', errs, ej: e => p.evaluate(e), go: u => p.goto(u), file: f => p.setInputFiles('#file', f), heap: null, close: () => c.close()};
}
const B = process.env.ENGINE === 'webkit' ? await webkit() : await chrome(); console.log('--- ' + B.name + '（iPad の条件）---');
const ej = B.ej, until = async (e, ms = 90000) => { const t = Date.now(); while (Date.now() - t < ms){ try{ if (await ej(e)) return true; }catch(x){} await sleep(150); } return false; };
const start = async () => { await B.go(BASE); await until('!!window.__zk', 20000); await sleep(500); };
const open = async f => { await B.file(f); await ej("document.querySelector('#file').dispatchEvent(new Event('change'))").catch(() => {}); };

try{
  await start(); ok(await ej('__zk.LOWMEM===true'), 'iPad と判定してメモリの節約をする');
  await open(PDF); ok(await until("!!__S.preview && __S.page===1 && !!__S.geo && __S.geoPage===1"), '線の多い図面を開き、スナップ用の線が取れる');
  const g = await ej('[__S.geo.N,__S.geo.P,__S.geo.NC,__S.preview.width]'); console.log('    線分 ' + g[0].toLocaleString() + '・点 ' + g[1].toLocaleString() + '・曲線 ' + g[2].toLocaleString() + '・表示 ' + g[3] + 'px');
  ok(await ej('__S.pdfPage._zkHeavy===true && ![...__S.pdfPage._intentStates.values()].some(s=>s.operatorList)'), '描き終えた命令を抱え込まない');
  const same = await ej(`(async()=>{ const pg=__S.pdfPage, h=await __zk.pdfJob(9, ()=>__zk.extractGeometry(pg, pg.getViewport({scale:1}))), g=__S.geo; const eq=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]); let cells=0; for (let k=0;k<g.gx*g.gy;k++){ const a=g.grid.get(k), b=h.grid.get(k); if (!!a!==!!b || (a && !eq(a,b))) return 'grid '+k; if (a) cells++; } pg.cleanup(); return eq(g.segs,h.segs) && eq(g.pts,h.pts) && eq(g.curves,h.curves) && cells>100; })()`);
  ok(same === true, 'スナップ用の線・点・曲線・索引が、別に読み直した物と同じ' + (same === true ? '' : '：' + same));
  ok(await until('!!__S.markInfo && localStorage.getItem("pdfmeasure:resumeGuard")===null'), '裏の仕事（縮尺・記号の検出）まで終わり、「開いている途中」の印が消える');
  ok(await ej('__S.markInfo.n===2'), 'ほかのページの記号（SD-2・SD-3）を検出する');
  if (B.heap){ const mb = await B.heap(); ok(mb < 60, `落ち着いた後のメモリ（JS）が小さい（${mb.toFixed(0)}MB、60MB 未満）`); }
  ok(await until("document.querySelectorAll('#thList canvas').length===3"), 'ページ一覧の縮小画像が3枚出る');
  // 区画の控え
  ok(await until("!!__S.tiles && __S.preview===__S.tiles.base"), '1回描いた後は、区画の画像に切り替わる（大きな画像は手放す）');
  const px = await ej(`(async()=>{ const T=__S.tiles, pg=__S.pdfPage, vp=pg.getViewport({scale:T.scale}); const c=document.createElement('canvas'); c.width=T.W; c.height=T.H; const x=c.getContext('2d',{willReadFrequently:true}); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); await pg.render({canvasContext:x,viewport:vp}).promise; pg.cleanup(); const t=document.createElement('canvas'); t.width=t.height=512; const tx=t.getContext('2d',{willReadFrequently:true}); let diff=0,big=0,n=0; for (let i=0;i<T.blobs.length;i+=5){ const bm=await createImageBitmap(T.blobs[i]); tx.drawImage(bm,0,0); const a=tx.getImageData(0,0,512,512).data, X=(i%T.cols)*512, Y=((i/T.cols)|0)*512, w=Math.min(512,T.W-X), h=Math.min(512,T.H-Y), b=x.getImageData(X,Y,w,h).data; for (let y=0;y<h;y+=3) for (let k=0;k<w;k+=3){ const d=Math.abs(a[(y*512+k)*4]-b[(y*w+k)*4]); n++; if (d>2) diff++; if (d>90) big++; } } return JSON.stringify({n,diff,big}); })()`);
  const pj = JSON.parse(px || '{}'); ok(pj.n > 10000 && pj.big / pj.n < 0.002, '区画の画像が、描き直した画像と同じ（調べた点 ' + pj.n + '、大きく違う点 ' + pj.big + '）');
  await ej('__zk.zoomAt(5,500,380)'); const tz = Date.now(); ok(await until('__zk.tilesNeeded() && __zk.tilesReady()', 8000), '拡大すると、区画が出そろう（' + (Date.now() - tz) + 'ms）');
  ok(await ej("new Promise(r=>{ __S.px-=180; __S.py-=90; const t=performance.now(); __zk.zoomAt(1,0,0); const f=()=>__zk.tilesReady()? r(performance.now()-t<1500) : requestAnimationFrame(f); f(); })"), '動かしても、描き直しを待たない');
  // 重いページ：頼まれたときだけ高精細
  await ej('__zk.zoomAt(2.2,500,380)'); await sleep(1600); ok(await ej("!__S.hi && getComputedStyle(document.querySelector('#bSharp')).display!=='none'"), '重いページは自動では描き直さず、「ここを鮮明に」が出る');
  await ej("document.querySelector('#bSharp').click()"); ok(await until('!!__S.hi && __S.hi.canvas.width>0', 60000), '「ここを鮮明に」を押すと、高精細の表示になる');
  await ej('__S.px-=40; __zk.zoomAt(1,0,0)'); await sleep(300); ok(await ej("!!__S.hi && __S.hi.canvas.width>0 && document.querySelector('#bSharp').style.display==='block'"), '動かした後も、描いた分はずらして使う');
  // 裏の仕事は、動かしている間は始めない
  ok(await ej("new Promise(r=>{ let ran=0; __zk.pdfJob(3,()=>{ ran=performance.now(); }); const mv=setInterval(()=>{ __S.px+=.1; __zk.zoomAt(1,0,0); },60); setTimeout(()=>{ const early=ran; clearInterval(mv); setTimeout(()=>r(!early && ran>0), 2200); },900); })"), '動かしている間は裏の仕事を始めず、止まったら始める');
  // 高精細を描いている途中でページ移動
  await ej('__S.px-=30; __zk.zoomAt(1,0,0)'); await sleep(300); await ej("document.querySelector('#bSharp').click()"); await sleep(250); await ej('__zk.gotoPage(2,true)'); ok(await until("__S.page===2 && !!__S.preview && __S.geoPage===2 && __S.geo.N===200"), '描いている途中でもページ移動できる（2ページ目：線分200本）');
  ok(await until("!!__S.scales[2] && /1\\/100/.test(__S.scales[2].label)"), '2ページ目の縮尺 1/100 が自動で入る');
  ok(await until("!!__S.tiles && !document.querySelector('#busy').textContent") && await ej("document.querySelector('#bSharp').style.display!=='block'"), '軽いページでは「ここを鮮明に」は出ない');
  await ej('__zk.zoomAt(12,500,380)'); ok(await until('!!__S.hi', 8000), '軽いページは、止まると自動で高精細になる');
  // 連続のページ移動（重い→軽い→重い→軽い）
  await ej("(()=>{ __zk.gotoPage(1,true); setTimeout(()=>__zk.gotoPage(3,true),250); setTimeout(()=>__zk.gotoPage(1,true),500); setTimeout(()=>__zk.gotoPage(2,true),800); })()");
  await sleep(1200); ok(await until("__S.page===2 && __S.geoPage===2 && !!__S.geo && __S.geo.N===200 && !!__S.preview && __S.preview.width>0"), '続けてページを移っても、最後に選んだページが正しく出る');
  await ej("(()=>{ window.__ops=0; const mh=__S.doc._transport.messageHandler, o=mh.sendWithStream; mh.sendWithStream=function(n){ if (n==='GetOperatorList'||n==='GetTextContent') window.__ops++; return o.apply(this,arguments); }; })()");
  await until("!__zk.PJ.cur && !__zk.PJ.q.length"); await ej('window.__ops=0'); const tb = Date.now(); await ej('__zk.gotoPage(1,true)'); ok(await until("__S.page===1 && !!__S.tiles && !document.querySelector('#busy').textContent", 5000), '前に見たページへは、すぐ戻る（' + (Date.now() - tb) + 'ms）');
  ok(await until(`!!__S.geo && __S.geoPage===1 && __S.geo.N===${g[0]}`) && await ej('window.__ops===0'), '戻るとき、PDF を読み解かない（線の数も同じ）');
  ok(await until('!!__S.pdfPage') && await ej("(async()=>{ const pg=__S.pdfPage, h=await __zk.pdfJob(9, ()=>__zk.extractGeometry(pg, pg.getViewport({scale:1}))), g=__S.geo, eq=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]); for (let k=0;k<g.gx*g.gy;k++) for (const n of ['grid','pgrid','cgrid']){ const a=g[n].get(k), b=h[n].get(k); if (!!a!==!!b || (a && !eq(a,b))) return false; } pg.cleanup(); return eq(g.segs,h.segs) && eq(g.pts,h.pts) && eq(g.curves,h.curves) && g.cell(300,200).join()===h.cell(300,200).join(); })()"), '控えの線・点・曲線・索引が、読み直した物とまったく同じ');
  await ej('__zk.gotoPage(2,true)'); ok(await until("__S.page===2 && !!__S.tiles && !!__S.scales[2] && /1\\/100/.test(__S.scales[2].label) && !!__S.detect[2] && !!__S.detect[2].pick"), '控えから開いても、縮尺の判定が残る');
  // 回転
  await ej("document.querySelector('#bRotR').click()"); await ej('__zk.zoomAt(4,500,380)'); ok(await until('__zk.visTiles().length>0 && __zk.tilesReady()', 8000), '回転した表示でも、区画が出る'); await ej("document.querySelector('#bRotL').click()"); await ej('__zk.gotoPage(1,true)'); await until('__S.page===1 && !!__S.tiles');
  ok(await until('!__zk.PJ.cur && !__zk.PJ.q.length', 60000), '順番待ちの仕事が残らない');
  ok(await ej('__zk.readPdfBytes().then(b=>new TextDecoder().decode(new Uint8Array(b,0,5)))') === '%PDF-', '書き出し用に、元の PDF を読み直せる');
  // 同じ名前・同じ大きさの改訂図と混ざらない
  const stored = N => until("!!__S.geo && __S.geo.N===" + N + " && !!__S.tiles") ;
  const has = N => until("__zk.tget('geo',__zk.tkey(1)).then(r=>!!r && r.N===" + N + ")");
  await open(REV1); ok(await stored(120) && await has(120), '改訂前の図面を開く（線分120本・控えを置く）');
  await open(REV2); ok(await stored(135) && await has(135), '同じ名前・同じ大きさの改訂図を開いても、改訂前の控えを使わない（線分135本）');
  await open(REV1); ok(await stored(120), '改訂前に戻すと、改訂前の線になる');
  // 作っている途中で別の図面に開き替える：番号の取り違えが無い
  await ej("__zk.tilesDropFile(__S.key)"); for (const f of [REV2, PDF2, REV1, PDF2, REV2]){ await open(f); await sleep(350); } await stored(135); await has(135); await sleep(1200);
  const mix = JSON.parse(await ej("(async()=>{ const db=await new Promise(r=>{ const q=indexedDB.open('zumen-tiles'); q.onsuccess=()=>r(q.result); }); const all=s=>new Promise(r=>{ const t=db.transaction(s).objectStore(s), k=t.getAllKeys(), v=t.getAll(); v.onsuccess=()=>r(k.result.map((x,i)=>[x,v.result[i]])); }); const geo=await all('geo'), page=await all('page'); db.close(); const G=new Map(geo.map(([k,v])=>[k,v])); const h=async f=>0; return JSON.stringify({pair: page.length===geo.length && page.every(([k,p])=>G.has(k)), rev: geo.filter(([k,v])=>v.N===135||v.N===120).map(([k,v])=>[k.split('|')[0],v.N])}); })()"));
  const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex'); ok(mix.pair && mix.rev.every(([h, n]) => h === sha(n === 120 ? REV1 : REV2)) && mix.rev.some(([h, n]) => n === 135), '開き替えを続けても、控えの番号と中身が食い違わない');
  // 続けて開き替えても、端末に残すファイルの名前と中身が食い違わない（同じ名前・大きさの物は1つの名前になるので、違う名前の物で見る）
  const files = JSON.parse(await ej("(async()=>{ const db=await new Promise(r=>{ const q=indexedDB.open('pdfmeasure'); q.onsuccess=()=>r(q.result); }); const v=await new Promise(r=>{ const q=db.transaction('files').objectStore('files').getAll(); q.onsuccess=()=>r(q.result); }); db.close(); const out=[]; for (const f of v) out.push([f.key, f.name, f.blob.size]); return JSON.stringify(out); })()"));
  ok(files.length >= 2 && files.every(([k, n, z]) => k === 'pdfmeasure:' + n + ':' + z), '続けて開き替えても、端末に残すファイルの名前と中身が食い違わない');
  // 端末から消すと、控えも消える
  ok(await ej("__zk.tilesDropFile(__S.key).then(()=>__zk.tget('page',__zk.tkey(1))).then(r=>r===undefined)"), '図面を端末から消すと、その控えも消える');
  // 別の図面に切り替え
  await open(PDF2); ok(await until("__S.name==='二つ目.pdf' && !!__S.geo && !!__S.markInfo && document.querySelectorAll('#thList canvas').length===3"), '別の図面に切り替えても、線・記号・縮小画像が出る');
  // アプリを開き直す：控えから出す
  await open(PDF2); await until("__S.name==='二つ目.pdf' && !!__S.tiles && __zk.tget('geo',__zk.tkey(1)).then(r=>!!r)"); await until("localStorage.getItem('pdfmeasure:resumeGuard')===null"); await sleep(1500); await B.go('about:blank'); await B.go(BASE); ok(await until("!!window.__S && __S.name==='二つ目.pdf' && !!__S.tiles && !!__S.geo", 20000), 'アプリを開き直すと、控えからすぐ出る');
  // 開く途中で落ちたとき：印だけ残した状態で開き直す
  const key = `'pdfmeasure:落ちた図面.pdf:${fs.statSync(PDF4).size}'`;
  await sleep(1500); await B.go('about:blank'); await B.go(BASE + 'manifest.webmanifest').catch(() => {}); await ej(`localStorage.setItem('pdfmeasure:resumeGuard', JSON.stringify({key:${key}, t:Date.now()}))`);
  await start(); ok(await ej(`__zk.crashedBefore(${key}) && __S.name!=='落ちた図面.pdf'`), '開く途中で落ちた図面は、自動では開き直さない');
  await open(PDF4); ok(await until("!!__S.preview && __S.safe===true && !!__S.markInfo"), '自分で開くと、軽い表示で開く');
  ok(await ej("__S.preview.width<=2000 && !__S.geo && document.querySelectorAll('#thList canvas').length===0"), '軽い表示：スナップの線・縮小画像を作らない');
  await open(PDF); ok(await until("__S.name==='重い図面.pdf' && __S.safe===false && !!__S.geo"), 'ほかの図面は、いつもの表示で開く');
  ok(!B.errs.length, 'スクリプトのエラーが出ない' + (B.errs.length ? '：' + String(B.errs[0]).slice(0, 220) : ''));
}catch(e){ ok(false, '試験が止まった：' + e.message); }
finally{ await B.close(); srv.close(); await sleep(400); try{ fs.rmSync(TMP, {recursive: true, force: true}); }catch(e){} }
console.log(bad ? `\n${bad}件 不合格` : '\nすべて合格'); process.exit(bad ? 1 : 0);
