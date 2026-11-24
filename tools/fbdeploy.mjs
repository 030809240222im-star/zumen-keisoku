// Firebase に公開する：組み立て → アプリ本体を Firestore に置く → 決まり（rules）とログイン画面（hosting）を出す → 出た物を確かめる
// 使い方：node tools/fbdeploy.mjs        （firebase login 済みであること。firebase/local.json が要る）
//         node tools/fbdeploy.mjs --check （出ている物を確かめるだけ。何も書かない）
// ログインの鍵は、firebase login 済みの firebase-tools の中の物を使う（dxf-takeoff の tools/fsrest.mjs と同じ）。鍵は表示も保存もしない
import fs from 'node:fs'; import path from 'node:path'; import {execSync, spawnSync} from 'node:child_process'; import {createRequire} from 'node:module'; import {build, localConf, headersFor, rulesFor, appDoc, OUT} from './fbbuild.mjs';
const CHECK = process.argv.includes('--check'), conf = localConf(), PJ = conf.project, SITE = `https://${PJ}.firebaseapp.com`;
const BASE = `https://firestore.googleapis.com/v1/projects/${PJ}/databases/(default)/documents`;
let tok = null;
async function token(){ if (tok) return tok; const G = path.join(execSync('npm root -g').toString().trim(), 'firebase-tools', 'lib'), auth = createRequire(path.join(G, 'x.js'))('./auth.js'); const a = auth.getGlobalDefaultAccount(); if (!a || !a.tokens || !a.tokens.refresh_token) throw new Error('firebase login してください'); tok = (await auth.getAccessToken(a.tokens.refresh_token, [])).access_token; return tok; }
async function call(method, url, body){ for (let k = 0;; k++){ let r; try{ r = await fetch(url, {method, headers: {Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined}); }catch(e){ if (k < 3){ await new Promise(z => setTimeout(z, 2000 * (k + 1))); continue; } throw e; } if (r.status === 404) return null; if (r.ok) return r.json(); const t = await r.text(); if ((r.status === 429 || r.status >= 500) && k < 3){ await new Promise(z => setTimeout(z, 2000 * (k + 1))); continue; } throw new Error(`${method} ${url.replace(BASE, '')} → ${r.status} ${t.slice(0, 200)}`); } }
const enc = o => ({fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? {integerValue: String(v)} : {stringValue: v}]))}), val = d => d && Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, v.stringValue ?? +v.integerValue]));
const get = p => call('GET', `${BASE}/${p}`), put = (p, o) => call('PATCH', `${BASE}/${p}`, enc(o)), del = p => call('DELETE', `${BASE}/${p}`);
function fb(args){ for (let k = 0; k < 3; k++){ const r = spawnSync('firebase ' + args, {cwd: OUT, shell: true, encoding: 'utf8', timeout: 240000}); if (r.status === 0) return r.stdout; if (k === 2) throw new Error('firebase ' + args + '\n' + String(r.stdout + r.stderr).slice(-600)); } }

async function deploy(){
  const {app} = build();
  const own = await get('members/' + conf.owner); if (!own){ await put('members/' + conf.owner, {role: 'admin', name: '管理者', at: new Date().toISOString(), by: conf.owner}); console.log('名簿に管理者を入れた'); }
  fb(`deploy --only firestore:rules --project ${PJ}`); console.log('決まり（rules）を出した');
  const old = val(await get('app/current'));
  if (!old || old.ver !== app.ver){
    for (let i = 0; i < app.n; i++) await put(`app/current/parts/${app.ver}-${i}`, {t: app.parts[i]});
    await put('app/current', {ver: app.ver, sha: app.sha, n: app.n, at: new Date().toISOString()}); console.log(`アプリ本体を置いた：版 ${app.ver}`);
    // 1つ前の版は、読み込み途中の人のために残す。それより前を消す
    const L = await call('GET', `${BASE}/app/current/parts?pageSize=300&mask.fieldPaths=x`); for (const d of (L && L.documents) || []){ const id = d.name.split('/').pop(); if (!id.startsWith(app.ver + '-') && !(old && id.startsWith(old.ver + '-'))) await del('app/current/parts/' + id); }
  } else console.log('アプリ本体は同じ版なので、そのまま');
  fb(`deploy --only hosting --project ${PJ}`); console.log('ログイン画面（hosting）を出した');
}
async function check(){
  let bad = 0; const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };
  const app = appDoc(), cur = val(await get('app/current')); ok(cur && cur.ver === app.ver && cur.sha === app.sha, `アプリ本体は手元と同じ版（${cur ? cur.ver : '無し'}）`);
  const r = await fetch(SITE + '/?c=' + Date.now()), html = await r.text(), hd = headersFor(PJ); ok(r.ok && /図面計測 — ログイン/.test(html) && !/computeWall0/.test(html), 'ログイン画面が出ている（アプリ本体は入っていない）');
  ok(Object.entries(hd).filter(([k]) => k !== 'Cache-Control').every(([k, v]) => r.headers.get(k) === v), '安全のヘッダー（CSP など）が付いている');
  const sh = await (await fetch(SITE + '/shell.js?c=' + Date.now())).text(); ok(sh.replace(/\r\n/g, '\n') === fs.readFileSync(path.join(OUT, 'public', 'shell.js'), 'utf8').replace(/\r\n/g, '\n'), '入口（shell.js）は手元と同じ');
  for (const p of ['app.json', 'firestore.rules', 'firebase.json', 'local.json', 'CLAUDE.md', 'admin.html']) ok((await fetch(`${SITE}/${p}?c=${Date.now()}`)).status === 404, `配らない物は出ていない：${p}`);
  const c = await fetch(SITE + '/__/firebase/init.json'), cfg = c.ok ? await c.json() : {}; ok(cfg.projectId === PJ && !!cfg.apiKey, '接続の設定（init.json）が出ている');
  for (const p of ['app/current', `app/current/parts/${app.ver}-0`, 'members', 'members/' + conf.owner]) ok([401, 403].includes((await fetch(`${BASE}/${p}`)).status), `ログインしていない人は読めない：${p.replace(conf.owner, '管理者')}`);
  const rules = await (async () => { const rel = await call('GET', `https://firebaserules.googleapis.com/v1/projects/${PJ}/releases/cloud.firestore`); const rs = rel && await call('GET', 'https://firebaserules.googleapis.com/v1/' + rel.rulesetName); return rs ? rs.source.files.map(f => f.content).join('\n') : ''; })(); ok(rules.replace(/\r/g, '').trim() === rulesFor(conf.owner).trim(), '出ている決まりは手元と同じ');
  if (cfg.apiKey){ const id = async (m, b) => (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${m}?key=${cfg.apiKey}`, {method: 'POST', headers: {'Content-Type': 'application/json', Referer: SITE + '/'}, body: JSON.stringify(b)})).json());
    const pw = JSON.stringify(await id('signInWithPassword', {email: 'nobody@example.com', password: 'not-a-password', returnSecureToken: true})); ok(/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(pw), 'メール／パスワードのログインが有効' + (/INVALID_LOGIN|EMAIL_NOT/.test(pw) ? '' : '：' + pw.slice(0, 140)));
    const g = await id('createAuthUri', {providerId: 'google.com', continueUri: SITE + '/__/auth/handler'}); ok(!!g.authUri, 'Google のログインが有効' + (g.authUri ? '' : '：' + JSON.stringify(g).slice(0, 140))); }
  console.log(bad ? `\n${bad}件 NG` : '\nすべて OK'); return bad;
}
try{ if (!CHECK) await deploy(); process.exit(await check() ? 1 : 0); }catch(e){ console.error('止まりました：' + e.message); process.exit(1); }
