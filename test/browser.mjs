// 本物のブラウザ（Chrome の headless）での確認：公開先と同じ安全のヘッダー（CSP）で、
//   ・lib/ の pdf.js と worker で PDF を開ける（アプリの「ファイルを開く」から）
//   ・PDF の書き出しに使う pdf-lib を lib/ から読める
//   ・管理の画面が動く
//   ・CSP に止められたもの（違反）が無い
// 使い方：node test/browser.mjs   （Chrome か Edge が要る。ws は dxf-takeoff の試験の部品を使う）
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os'; import {spawn} from 'node:child_process'; import {createRequire} from 'node:module'; import {fileURLToPath, pathToFileURL} from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const H = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/http.js')).href);
const DEPS = (process.env.DXF_TAKEOFF_DEPS || (process.env.LOCALAPPDATA || '') + '/dxf-takeoff').replace(/\\/g, '/');
const WebSocket = createRequire(DEPS + '/package.json')('ws');
let bad = 0; const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BROWSER = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
if (!BROWSER){ console.log('Chrome・Edge が見つからないので飛ばします'); process.exit(0); }

// ---- 試しの PDF（線と文字）を pdf-lib で作る ----
const {PDFDocument, StandardFonts, rgb} = createRequire(import.meta.url)(path.join(ROOT, 'lib/pdf-lib.min.js'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zumen-browser-'));
{ const pdf = await PDFDocument.create(); const pg = pdf.addPage([842, 595]); const f = await pdf.embedFont(StandardFonts.Helvetica);
  pg.drawText('SD-1  W=900 H=2000  S=1/100', {x: 60, y: 520, size: 14, font: f}); pg.drawLine({start: {x: 60, y: 300}, end: {x: 600, y: 300}, thickness: 1.5, color: rgb(0, 0, 0)});
  pg.drawRectangle({x: 100, y: 100, width: 200, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 1});
  fs.writeFileSync(path.join(TMP, 'test-plan.pdf'), await pdf.save()); }

// ---- 公開先と同じヘッダー・同じ「配ってよいファイル」で配る ----
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.bcmap': 'application/octet-stream'};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = H.normPath(u.pathname);
  const hdr = {...H.SECURITY_HEADERS, 'Content-Security-Policy': H.CSP_APP}; delete hdr['Strict-Transport-Security'];
  if (p === '/api/admin/members'){ res.writeHead(200, {...hdr, 'Content-Type': 'application/json', 'Content-Security-Policy': H.CSP_API});
    return res.end(JSON.stringify({me: 'admin@example.com', appUrl: 'http://127.0.0.1/', group: 'g', members: [{email: 'admin@example.com', admin: true, memo: '', addedAt: '', addedBy: ''}], admins: ['admin@example.com'], other: 0, kv: false, log: [], max: 1000})); }
  if (!H.isAllowedPath(p)){ res.writeHead(404, hdr); return res.end('not found'); }
  if (p === '/') p = '/index.html'; if (p === '/admin') p = '/admin.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e){ res.writeHead(404, hdr); return res.end(); } res.writeHead(200, {...hdr, 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream'}); res.end(d); });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const PORT = srv.address().port, BASE = `http://127.0.0.1:${PORT}`;

// ---- ブラウザを開き、CDP で動かす ----
const DBG = 9300 + Math.floor(Math.random() * 500);
const br = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(TMP, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], {stdio: 'ignore'});
let target = null; for (let i = 0; i < 50 && !target; i++){ await sleep(200); try{ const L = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); target = L.find(t => t.type === 'page'); }catch(e){} }
if (!target){ console.log('NG  ブラウザを動かせませんでした'); br.kill(); srv.close(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.on('open', r));
let seq = 0; const pend = new Map(), events = [];
ws.on('message', m => { const j = JSON.parse(m); if (j.id && pend.has(j.id)){ pend.get(j.id)(j); pend.delete(j.id); } else events.push(j); });
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({id, method, params})); });
const evalJs = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); return r.result && r.result.result ? r.result.result.value : undefined; };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {source: "window.__csp=[]; document.addEventListener('securitypolicyviolation', e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));"});
const waitFor = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms){ if (await evalJs(expr)) return true; await sleep(200); } return false; };

try{
  await send('Page.navigate', {url: BASE + '/'});
  ok(await waitFor('!!window.__S && !!window.pdfjsLib'), 'アプリが開き、lib/ の pdf.js が読まれる');
  ok(/\/lib\/pdf\.worker\.min\.js$/.test(await evalJs('pdfjsLib.GlobalWorkerOptions.workerSrc')), 'worker の場所は lib/');
  // アプリの「ファイルを開く」に PDF を渡す
  const doc = await send('DOM.getDocument', {depth: -1}); const q = await send('DOM.querySelector', {nodeId: doc.result.root.nodeId, selector: '#file'});
  await send('DOM.setFileInputFiles', {nodeId: q.result.nodeId, files: [path.join(TMP, 'test-plan.pdf')]});
  await evalJs("document.querySelector('#file').dispatchEvent(new Event('change'))");
  ok(await waitFor('window.__S && window.__S.isPdf && window.__S.nPages===1 && !!window.__S.W', 20000), 'PDF を開ける（worker が CSP の下で動く）');
  ok(await waitFor("(()=>{ const t=window.__S.stexts||window.__S.texts; return !!t && JSON.stringify(t).includes('SD'); })()", 15000), 'PDF の文字を読める');
  const libOk = await evalJs("new Promise(r=>{ const s=document.createElement('script'); s.src='lib/pdf-lib.min.js'; s.onload=()=>r(!!window.PDFLib); s.onerror=()=>r(false); document.head.appendChild(s); })");
  ok(libOk, '書き出し用の pdf-lib を lib/ から読める');
  const ext = await evalJs("new Promise(r=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'; s.onload=()=>r('loaded'); s.onerror=()=>r('blocked'); document.head.appendChild(s); })");
  ok(ext === 'blocked', '外のサイトのスクリプトは CSP で止まる（公開先では CDN を使わない）');
  const exf = await evalJs("fetch('https://example.com/x',{method:'POST',body:'drawing'}).then(()=>'sent',()=>'blocked')");
  ok(exf === 'blocked', '図面のデータを外へ送る通信は CSP で止まる');
  const csp = (await evalJs('window.__csp')) || [];
  const unexpected = csp.filter(v => !/example\.com|cdn\.jsdelivr\.net/.test(v));
  ok(!unexpected.length, 'アプリ自身の動きで CSP に止められたものは無い' + (unexpected.length ? '：' + unexpected.join(' / ') : ''));
  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || e.params.exceptionDetails.text);
  ok(!errs.length, 'スクリプトのエラーが出ない' + (errs.length ? '：' + String(errs[0]).slice(0, 200) : ''));
  // 管理の画面
  events.length = 0; await send('Page.navigate', {url: BASE + '/admin'});
  ok(await waitFor("document.querySelectorAll('#tb tr').length===1 && document.querySelector('#me').textContent.includes('admin@example.com')"), '管理の画面が CSP の下で動く');
  const csp2 = ((await evalJs('window.__csp')) || []); ok(!csp2.length, '管理の画面で CSP に止められたものは無い' + (csp2.length ? '：' + csp2.join(' / ') : ''));
}finally{
  try{ ws.close(); }catch(e){} br.kill(); srv.close(); await sleep(300); try{ fs.rmSync(TMP, {recursive: true, force: true}); }catch(e){}
}
console.log(bad ? `\n${bad}件 不合格` : '\nすべて合格');
process.exit(bad ? 1 : 0);
