// Firebase 版の試験（エミュレータの本物のログイン・決まり ＋ 本物の Chrome）
//   決まり：名簿に無い人・メール未確認の人は、アプリ本体も名簿も読めない／管理者だけが名簿を直せる／締め出しが起きない
//   画面：登録 → 確認メール → 名簿に無い → 登録してもらう → 開く → 名簿から外される → 止まる／管理者が開いている画面から追加・外す／電波なし
// 使い方：node tools/fbbuild.mjs && node test/firebase.mjs   （Java と firebase-tools が要る。自分でエミュレータを起こす）
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os'; import {spawn, spawnSync} from 'node:child_process'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), SELF = fileURLToPath(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST){   // エミュレータの中で自分を流し直す
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zumen-emu-')); fs.writeFileSync(path.join(d, 'firestore.rules'), "rules_version='2';service cloud.firestore{match /databases/{d}/documents{match /{x=**}{allow read,write:if false;}}}");
  fs.writeFileSync(path.join(d, 'firebase.json'), JSON.stringify({firestore: {rules: 'firestore.rules'}, emulators: {auth: {port: 9199}, firestore: {port: 8199}, ui: {enabled: false}, hub: {port: 4499}, logging: {port: 4599}, singleProjectMode: false}}));
  const r = spawnSync(`firebase emulators:exec --only auth,firestore --project demo-zumen "node ${JSON.stringify(SELF).slice(1, -1).replace(/\\\\/g, '/')}"`, {cwd: d, shell: true, stdio: 'inherit', timeout: 280000}); process.exit(r.status ?? 1);
}
const B = await import('../tools/fbbuild.mjs'); const P = 'demo-zumen', FS = 'http://' + process.env.FIRESTORE_EMULATOR_HOST, AU = 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, OWNER = 'owner@example.com';
let bad = 0; const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; }; const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = (u, o = {}) => fetch(u, {...o, headers: {'Content-Type': 'application/json', ...(o.headers || {})}, body: o.body ? JSON.stringify(o.body) : undefined});
// ---- 決まりを入れる（公開する物と同じ型から。持ち主だけ試験用）----
const rr = await J(`${FS}/emulator/v1/projects/${P}:securityRules`, {method: 'PUT', body: {rules: {files: [{name: 'firestore.rules', content: B.rulesFor(OWNER)}]}}}); if (!rr.ok){ console.log('NG  決まりを入れられません：' + (await rr.text()).slice(0, 400)); process.exit(1); }
const DOC = `${FS}/v1/projects/${P}/databases/(default)/documents`;
const enc = o => ({fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? {integerValue: String(v)} : {stringValue: v}]))});
const admPut = (p, o) => J(`${DOC}/${p}`, {method: 'PATCH', headers: {Authorization: 'Bearer owner'}, body: enc(o)}), admDel = p => J(`${DOC}/${p}`, {method: 'DELETE', headers: {Authorization: 'Bearer owner'}});
const app = B.appDoc(); for (let i = 0; i < app.n; i++) await admPut(`app/current/parts/${app.ver}-${i}`, {t: app.parts[i]}); await admPut('app/current', {ver: app.ver, sha: app.sha, n: app.n});
await admPut('members/' + OWNER, {role: 'admin', name: '管理者', at: '2026-11-24', by: OWNER}); await admPut('members/taro@example.com', {role: 'member', name: '', at: '2026-11-24', by: OWNER});
// ---- 人 ----
const mk = async (email, verified) => { const j = await (await J(`${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=k`, {method: 'POST', body: {email, password: 'password-1', returnSecureToken: true}})).json(); if (verified) await J(`${AU}/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:update`, {method: 'POST', headers: {Authorization: 'Bearer owner'}, body: {localId: j.localId, emailVerified: true}});
  return (await (await J(`${AU}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=k`, {method: 'POST', body: {email, password: 'password-1', returnSecureToken: true}})).json()).idToken; };
const T = {owner: await mk(OWNER, true), taro: await mk('taro@example.com', true), out: await mk('stranger@example.com', true), unv: await mk('jiro@example.com', false), anon: null}; await admPut('members/jiro@example.com', {role: 'member', name: '', at: 'x', by: OWNER});
const as = t => t ? {Authorization: 'Bearer ' + t} : {};
const get = async (t, p) => (await J(`${DOC}/${p}`, {headers: as(t)})).status, put = async (t, p, o) => (await J(`${DOC}/${p}`, {method: 'PATCH', headers: as(t), body: enc(o)})).status, del = async (t, p) => (await J(`${DOC}/${p}`, {method: 'DELETE', headers: as(t)})).status;
console.log('--- 決まり ---');
for (const [n, t] of [['ログインしていない人', T.anon], ['名簿に無い人', T.out], ['メール未確認の人（名簿にはある）', T.unv]]){
  ok(await get(t, 'app/current') === 403 && await get(t, `app/current/parts/${app.ver}-0`) === 403, `${n}は、アプリ本体を読めない`);
  ok(await get(t, 'members/' + OWNER) === 403 && await get(t, 'members') === 403 && await put(t, 'members/x@example.com', {role: 'admin', at: 'x', by: 'x'}) === 403, `${n}は、名簿を読めない・足せない`); }
ok(await get(T.taro, 'app/current') === 200 && await get(T.taro, `app/current/parts/${app.ver}-0`) === 200, '名簿の人は、アプリ本体を読める');
ok(await get(T.taro, 'members/taro@example.com') === 200 && await get(T.taro, 'members/' + OWNER) === 403 && await get(T.taro, 'members') === 403, '名簿の人が読める名簿は、自分の分だけ');
ok(await put(T.taro, 'members/taro@example.com', {role: 'admin', name: '', at: 'x', by: 'taro@example.com'}) === 403, '使用者は、自分を管理者にできない');
ok(await put(T.taro, 'app/current', {ver: 'evil', sha: 'x', n: 1}) === 403 && await put(T.owner, 'app/current', {ver: 'evil', sha: 'x', n: 1}) === 403 && await get(T.taro, 'app/current/parts') === 403, 'アプリ本体は、だれも画面から書き換えられない（管理者も）');
const M = (o = {}) => ({role: 'member', name: '', at: '2026-11-24', by: OWNER, ...o});
ok(await put(T.owner, 'members/hana@example.com', M({name: '花子'})) === 200 && await get(T.owner, 'members') === 200, '管理者は、名簿に足せる・一覧を読める');
ok(await put(T.owner, 'members/Hana2@Example.com', M()) === 403 && await put(T.owner, 'members/notmail', M()) === 403 && await put(T.owner, 'members/a@example.com', M({role: 'root'})) === 403 && await put(T.owner, 'members/a@example.com', {...M(), x: 'y'}) === 403 && await put(T.owner, 'members/a@example.com', M({by: 'other@example.com'})) === 403, '形の悪い名簿（大文字・メールでない・知らない役割・余分な欄・他人の名前で登録）は断る');
ok(await put(T.owner, 'members/taro@example.com', M({role: 'admin'})) === 200, '管理者は、ほかの人を管理者にできる');
ok(await del(T.taro, 'members/' + OWNER) === 403 && await put(T.taro, 'members/' + OWNER, M({role: 'member'})) === 403, 'ほかの管理者でも、持ち主を外せない・使用者に落とせない');
ok(await del(T.taro, 'members/taro@example.com') === 403 && await put(T.taro, 'members/taro@example.com', M({role: 'member'})) === 403, '自分自身は外せない・落とせない（締め出しを防ぐ）');
ok(await put(T.owner, 'members/taro@example.com', M()) === 200 && await del(T.owner, 'members/hana@example.com') === 200, '管理者は、役割を戻せる・外せる');
ok(await get(T.owner, 'secret/x') === 403 && await put(T.owner, 'secret/x', {a: 'b'}) === 403, '決まりの無い場所は、管理者でも読めない・書けない');
await admDel('members/jiro@example.com');

// ---- 画面 ----
console.log('--- 画面（Chrome）---');
const PUB = path.join(B.OUT, 'public'), TY = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const [fh, fp] = process.env.FIRESTORE_EMULATOR_HOST.split(':'); const HD = {...B.headersFor(P), 'Content-Security-Policy': B.csp(P, ' ' + AU + ' ' + FS)};
const srv = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/__/firebase/init.json'){ s.writeHead(200, {'Content-Type': 'application/json'}); return s.end(JSON.stringify({apiKey: 'k', projectId: P, authDomain: P + '.firebaseapp.com', zkEmulator: {auth: AU, fsHost: fh, fsPort: +fp}})); } if (p === '/') p = '/index.html';
  fs.readFile(path.join(PUB, p), (e, d) => { if (e){ s.writeHead(404, HD); return s.end('not found'); } s.writeHead(200, {...HD, 'Content-Type': TY[path.extname(p)] || 'application/octet-stream'}); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}/`;
const WebSocket = createRequire((process.env.DXF_TAKEOFF_DEPS || (process.env.LOCALAPPDATA || '') + '/dxf-takeoff').replace(/\\/g, '/') + '/package.json')('ws');
const EXE = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p)); const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zumen-fb-')), DBG = 9400 + Math.floor(Math.random() * 500);
const br = spawn(EXE, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${TMP}`, '--no-first-run', '--disable-gpu', 'about:blank'], {stdio: 'ignore'});
let tg; for (let i = 0; i < 60 && !tg; i++){ await sleep(200); try{ tg = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find(t => t.type === 'page'); }catch(e){} }
const ws = new WebSocket(tg.webSocketDebuggerUrl, {maxPayload: 1e9}); await new Promise(r => ws.on('open', r)); let n = 0; const PD = new Map(), errs = [], csp = [];
ws.on('message', m => { const j = JSON.parse(m); if (j.id && PD.has(j.id)){ PD.get(j.id)(j); PD.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') errs.push((j.params.exceptionDetails.exception || {}).description || j.params.exceptionDetails.text); else if (j.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', {accept: true}); else if (j.method === 'Log.entryAdded' && /Content Security Policy/i.test(j.params.entry.text)) csp.push(j.params.entry.text.slice(0, 200)); });
const send = (method, params = {}) => new Promise(r => { const id = ++n; PD.set(id, r); ws.send(JSON.stringify({id, method, params})); });
const ej = async e => { const r = await send('Runtime.evaluate', {expression: e, awaitPromise: true, returnByValue: true}); if (!r.result || r.result.exceptionDetails) return undefined; return r.result.result.value; };
for (const d of ['Page', 'Runtime', 'Log', 'Network']) await send(d + '.enable'); await send('Emulation.setDeviceMetricsOverride', {width: 1024, height: 768, deviceScaleFactor: 1, mobile: false});
const until = async (e, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms){ if (await ej(e)) return true; await sleep(150); } return false; };
const vis = v => `!!document.querySelector('#v${v}') && !document.querySelector('#v${v}').hidden`, APP = '!!window.__S && !!window.zumenAuth';
const go = () => send('Page.navigate', {url: BASE}); const set = (s, v) => ej(`(()=>{const e=document.querySelector('${s}'); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input'));})()`), click = s => ej(`document.querySelector('${s}').click()`);
const login = async (e, pw = 'password-1') => { await set('#em', e); await set('#pw', pw); await ej("document.querySelector('#fIn').requestSubmit()"); };
try{
  await go(); ok(await until(vis('Login')), 'はじめはログインの画面'); ok(!(await ej('!!window.__S')) && !/W_ROWS|computeWall0/.test(await (await fetch(BASE)).text()), '誰でも見える所に、アプリ本体は無い');
  for (const p of ['app.json', '../app.json', 'firestore.rules', 'firebase/local.json', 'CLAUDE.md', 'admin.html']) if ((await fetch(BASE + p)).status !== 404) ok(false, '配ってはいけない物が見える：' + p);
  await login('taro@example.com', 'wrong-pass'); ok(await until("/違います/.test(document.querySelector('#msg').textContent)"), 'パスワード違いは、日本語で知らせる');
  // 新しい人：登録 → 確認メール → 名簿に無い
  await click('#toUp'); await set('#em2', 'New@Example.com'); await set('#pw2', 'password-1'); await ej("document.querySelector('#fUp').requestSubmit()"); ok(await until(vis('Verify')), '登録すると、確認メールの案内');
  const oob = (await (await J(`${AU}/emulator/v1/projects/${P}/oobCodes`)).json()).oobCodes.filter(o => o.email === 'new@example.com').pop(); ok(!!oob && oob.requestType === 'VERIFY_EMAIL', '確認メールが送られる');
  await click('#bChk'); ok(await until("/まだ確認できていません/.test(document.querySelector('#msg').textContent)"), 'リンクを開く前は進めない');
  await fetch(oob.oobLink); await click('#bChk'); ok(await until(vis('Deny')), '確認しても、名簿に無ければ使えない');
  // 管理者が開いている画面から追加
  await ej("document.querySelector('#vDeny [data-out]').click()"); await sleep(600); await until(vis('Login')); await login(OWNER); ok(await until(APP), '管理者がログインすると、アプリが開く');
  ok(await until("getComputedStyle(document.querySelector('#bRoster')).display!=='none'") && await ej('zumenAuth.admin===true'), '管理者の画面に「名簿」が出る');
  await click('#bRoster'); ok(await until("document.querySelectorAll('#roTbl tr[data-i]').length===2"), '名簿の一覧が出る');
  await set('#roEm', 'New@Example.com, two@example.com\\nだめなメール'.replace('\\n', '\n')); await click('#roAdd'); ok(await until("document.querySelectorAll('#roTbl tr[data-i]').length===4") && /new@example\.com、two@example\.com/.test(await ej("document.querySelector('#roMsg').textContent")) && /だめなメール/.test(await ej("document.querySelector('#roMsg').textContent")), '開いている画面から、まとめて追加できる（形の悪いものは知らせる）');
  await set('#roEm', 'two@example.com'); await click('#roAdd'); ok(await until("/登録済み：two@example.com/.test(document.querySelector('#roMsg').textContent)"), '登録済みの人は二重にならない');
  await ej(`(()=>{const tr=[...document.querySelectorAll('#roTbl tr[data-i]')].find(t=>t.textContent.includes('two@example.com')); const i=tr.querySelector('[data-nm]'); i.value='<img src=x onerror="window.__pwn=1">'; i.onchange();})()`); await sleep(700);
  await click('#bCancel'); await click('#bRoster'); await until("document.querySelectorAll('#roTbl tr[data-i]').length===4"); ok(!(await ej('window.__pwn')) && await ej(`[...document.querySelectorAll('#roTbl [data-nm]')].some(i=>i.value.startsWith('<img'))`), '名前に HTML を入れられても動かない');
  ok(await ej(`(()=>{const tr=[...document.querySelectorAll('#roTbl tr[data-i]')].find(t=>t.textContent.includes('${OWNER}')); return tr.querySelector('[data-rl]').disabled && !tr.querySelector('[data-rm]');})()`), '自分の行は、役割を変えられない・外せない');
  await ej(`[...document.querySelectorAll('#roTbl tr[data-i]')].find(t=>t.textContent.includes('two@example.com')).querySelector('[data-rm]').click()`); ok(await until("document.querySelectorAll('#roTbl tr[data-i]').length===3"), '外せる');
  // 図面を開いても動くか（アプリ本体が入口の中で正しく動く）
  await click('#bCancel'); ok(await ej("__zk.PJ && typeof pdfjsLib==='object' && /lib\\/pdf\\.worker/.test(pdfjsLib.GlobalWorkerOptions.workerSrc)"), 'アプリの部品（PDF）が使える');
  await click('#bAcct'); await until("!!document.querySelector('#acOut')"); await click('#acOut'); await sleep(800); ok(await until(vis('Login')), 'ログアウトすると、ログインの画面に戻る');
  // 追加してもらった人
  await login('new@example.com'); ok(await until(APP), '追加された人は、アプリを開ける'); ok(await ej("zumenAuth.admin===false && document.querySelector('#bRoster').style.display==='none'"), '使用者には「名簿」が出ない');
  ok(await ej("zumenAuth.add('x@example.com').then(()=>false,e=>/できません/.test(e.message))"), '使用者が無理に呼んでも、名簿は直せない');
  ok(await ej('zumenAuth.check()') === 'ok', '使える間は ok');
  // 電波なし：入口も本体も端末の控えで開く
  await until('navigator.serviceWorker.getRegistration().then(r=>!!(r&&r.active))', 15000); await sleep(1500);
  await send('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0}); for (const t of (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json())) void t;
  srv.closeAllConnections && srv.closeAllConnections(); await new Promise(r => srv.close(r)); await send('Page.reload'); ok(await until(APP, 45000) && await ej('zumenAuth.offline===true'), '電波が無くても、前に確かめた人は開ける');
  await new Promise(r => srv.listen(+BASE.match(/:(\d+)/)[1], '127.0.0.1', r)); await send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  await go(); await sleep(500); await until(APP); ok(await ej('zumenAuth.offline===false'), '電波が戻れば、ふつうに確かめて開く');
  // 外される
  await admDel('members/new@example.com'); ok(await ej('zumenAuth.check()') === 'out', '外されると、確かめた時に分かる'); await ej("document.dispatchEvent(new Event('visibilitychange'))"); ok(await until("!!document.querySelector('#accessLock')"), '外された人の画面は止まる');
  await go(); await sleep(500); ok(await until(vis('Deny')), '開き直しても使えない'); ok(await ej("new Promise(r=>{const q=indexedDB.open('zumen-shell');q.onsuccess=()=>{const g=q.result.transaction('kv').objectStore('kv').get('app');g.onsuccess=()=>r(g.result===undefined)}})"), '端末に残したアプリ本体も消える');
  // 端末のデータを消してログアウト
  await admPut('members/new@example.com', M()); await go(); await sleep(500); await until(APP); await ej("localStorage.setItem('pdfmeasure:test','x')"); await click('#bAcct'); await until("!!document.querySelector('#acErase')"); await click('#acErase'); await sleep(2500); ok(await until(vis('Login')) && await ej("localStorage.getItem('pdfmeasure:test')===null"), '「ログアウトして、この端末のデータを消す」が働く');
  const bugs = errs.filter(e => !/Failed to fetch|network|ERR_INTERNET|offline/i.test(e)); ok(!bugs.length, 'スクリプトのエラーが出ない' + (bugs.length ? '：' + bugs[0].slice(0, 250) : '')); ok(!csp.length, 'CSP に止められたものは無い' + (csp.length ? '：' + csp[0] : ''));
}catch(e){ ok(false, '試験が止まった：' + e.message); }
finally{ try{ ws.close(); }catch(e){} br.kill(); srv.close(); await sleep(400); try{ fs.rmSync(TMP, {recursive: true, force: true}); }catch(e){} }
console.log(bad ? `\n${bad}件 不合格` : '\nすべて合格'); process.exit(bad ? 1 : 0);
