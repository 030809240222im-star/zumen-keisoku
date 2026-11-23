// 安全まわりの試験：Access のログインの証明・入口（_middleware）・利用者の管理 API・管理の画面・初期設定の台本・アプリ本体の直し
// 使い方：node test/security.mjs  （Cloudflare には接続しない。にせの Cloudflare で動かす）
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import {createRequire} from 'node:module'; import {fileURLToPath, pathToFileURL} from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const {verifyAccessJwt, _resetKeyCache} = await imp('functions/_lib/access.js');
const H = await imp('functions/_lib/http.js');
const {onRequest: middleware} = await imp('functions/_middleware.js');
const {onRequest: members} = await imp('functions/api/admin/members.js');
const {setup, NAMES} = await imp('tools/setup-cloudflare.mjs');

// ---- にせの Access（鍵と JWT）----
const TEAM = 'zumen-test.cloudflareaccess.com', AUD = 'a'.repeat(64);
const kp = await crypto.webcrypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const other = await crypto.webcrypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const pub = {...(await crypto.webcrypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig'};
const b64u = b => Buffer.from(b).toString('base64url');
async function jwt(claims = {}, {kid = 'k1', alg = 'RS256', key = kp.privateKey} = {}){
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({alg, kid, typ: 'JWT'})), p = b64u(JSON.stringify({aud: [AUD], email: 'user@example.com', exp: now + 3600, iat: now, nbf: now - 5, iss: `https://${TEAM}`, sub: 'u1', type: 'app', ...claims}));
  const s = await crypto.webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(s)}`;
}
let certCalls = 0;
const certFetch = async url => { certCalls++; if (url === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({keys: [pub]}), {headers: {'Content-Type': 'application/json'}}); return new Response('no', {status: 404}); };
const V = (t, o = {}) => verifyAccessJwt(t, {teamDomain: TEAM, aud: AUD, fetchFn: certFetch, ...o});
const rejects = async (p) => { try{ await p; return false; }catch(e){ return e.message; } };

console.log('--- ログインの証明（JWT）---');
ok((await V(await jwt())).email === 'user@example.com', '正しい証明は通る（メールは小文字）');
ok((await V(await jwt({email: 'Tanaka@Example.co.jp'}))).email === 'tanaka@example.co.jp', 'メールは小文字にそろえる');
ok(await rejects(V(await jwt({aud: ['b'.repeat(64)]}))) === 'aud', '別のアプリの証明は通らない（aud）');
ok(await rejects(V(await jwt({iss: 'https://evil.cloudflareaccess.com'}))) === 'iss', '別のチームの証明は通らない（iss）');
ok(await rejects(V(await jwt({exp: Math.floor(Date.now() / 1000) - 120}))) === 'expired', '期限切れは通らない');
ok(await rejects(V(await jwt({nbf: Math.floor(Date.now() / 1000) + 600}))) === 'not-yet', 'まだ有効でない証明は通らない');
ok(await rejects(V(await jwt({}, {key: other.privateKey}))) === 'signature', '別の鍵で作った偽物は通らない（署名）');
{ const t = (await jwt()).split('.'); const p = JSON.parse(Buffer.from(t[1], 'base64url')); p.email = 'admin@example.com'; t[1] = b64u(JSON.stringify(p));
  ok(await rejects(V(t.join('.'))) === 'signature', '中身を書き換えた証明は通らない'); }
ok(await rejects(V(await jwt({}, {alg: 'none'}))) === 'alg', 'alg:none は通らない');
ok(await rejects(V(await jwt({}, {kid: 'zz'}))) === 'kid', '知らない鍵番号は通らない');
ok(await rejects(V(await jwt({email: ''}))) === 'email', 'メールの無い証明（サービストークン）は通らない');
ok(await rejects(V(null)) === 'no-token' && await rejects(V('abc.def')) === 'no-token', '証明が無い・短いものは通らない');
ok(await rejects(V(await jwt(), {teamDomain: 'evil.example.com'})) === 'team', 'チームの名前は cloudflareaccess.com だけ');
_resetKeyCache(); certCalls = 0; for (let i = 0; i < 5; i++) await rejects(V(await jwt({}, {kid: 'x' + i})));
ok(certCalls <= 2, `知らない鍵番号を何度送られても、鍵の取り直しは5分に1回まで（取りに行った回数 ${certCalls}）`);

// ---- 入口（_middleware）----
console.log('--- 入口（すべての要求）---');
const realFetch = globalThis.fetch;
globalThis.fetch = certFetch; _resetKeyCache();
const ENV = {ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: 'admin@example.com, boss@example.com'};
async function mw(url, {token, env = ENV, method = 'GET'} = {}){
  const headers = new Headers(); if (token) headers.set('Cf-Access-Jwt-Assertion', token);
  const data = {}; let nexted = false;
  const res = await middleware({request: new Request(url, {method, headers}), env, data, next: async () => { nexted = true; return new Response('<!doctype html>ok', {headers: {'Content-Type': 'text/html'}}); }});
  return {res, data, nexted};
}
const U = 'https://zumen-keisoku.pages.dev';
const tUser = await jwt(), tAdmin = await jwt({email: 'admin@example.com'});
{ const r = await mw(U + '/', {env: {}}); ok(r.res.status === 503 && !r.nexted, '設定（ACCESS_TEAM_DOMAIN・ACCESS_AUD）が無ければ 503 で止める'); }
{ const r = await mw(U + '/'); ok(r.res.status === 403 && !r.nexted, 'ログインの証明が無ければ 403'); }
{ const r = await mw(U + '/', {token: await jwt({}, {key: other.privateKey})}); ok(r.res.status === 403 && !r.nexted, '偽物の証明は 403'); }
{ const r = await mw(U + '/', {token: tUser}); const h = r.res.headers;
  ok(r.res.status === 200 && r.nexted && r.data.user.email === 'user@example.com' && !r.data.isAdmin, '登録した人はアプリを開ける（管理者ではない）');
  ok(h.get('Content-Security-Policy') === H.CSP_APP && /connect-src 'self'/.test(h.get('Content-Security-Policy')) && h.get('X-Frame-Options') === 'DENY' && h.get('X-Content-Type-Options') === 'nosniff' && h.get('Referrer-Policy') === 'no-referrer', '安全のためのヘッダー（外への通信を止める CSP・埋め込み禁止など）が付く'); }
for (const p of ['/test/security.mjs', '/tools/setup-cloudflare.mjs', '/CLAUDE.md', '/functions/_middleware.js', '/docs/x.md', '/.vscode/settings.json', '/lib/cmaps/../../CLAUDE.md'])
  { const r = await mw(U + p, {token: tUser}); ok(r.res.status === 404 && !r.nexted, `配らないファイルは 404：${p}`); }
for (const p of ['/lib/pdf.min.js', '/lib/pdf.worker.min.js', '/lib/pdf-lib.min.js', '/lib/cmaps/GBK-EUC-H.bcmap', '/sw.js', '/cmaps-ja.json', '/manifest.webmanifest', '/icon-192.png'])
  { const r = await mw(U + p, {token: tUser}); ok(r.res.status === 200 && r.nexted, `アプリのファイルは配る：${p}`); }
for (const p of ['/admin', '/admin.html', '/%61dmin.html', '/ADMIN.html'])
  { const r = await mw(U + p, {token: tUser}); ok((r.res.status === 403 || r.res.status === 404) && !r.nexted, `管理の画面は管理者だけ（止める）：${p} → ${r.res.status}`); }
{ const r = await mw(U + '/admin', {token: tAdmin}); ok(r.res.status === 200 && r.nexted && r.data.isAdmin, '管理者は管理の画面を開ける'); }
{ const r = await mw(U + '/api/admin/members', {token: tUser}); ok(r.res.status === 403 && /json/.test(r.res.headers.get('Content-Type')) && !r.nexted, '管理の API は管理者だけ（JSON で 403）'); }
{ const r = await mw(U + '/', {env: {...ENV, DEV_NO_AUTH: '1'}}); ok(r.res.status === 403, 'DEV_NO_AUTH は公開先では効かない'); }
{ const r = await mw('http://localhost:8788/', {env: {DEV_NO_AUTH: '1', ADMIN_EMAILS: 'dev@localhost.test'}}); ok(r.res.status === 200 && r.data.isAdmin, 'DEV_NO_AUTH は手元（localhost）だけで効く'); }

// ---- 利用者の管理 API（にせの Cloudflare API）----
console.log('--- 利用者の管理 API ---');
const ACC = 'f'.repeat(32), GID = '0b5a0c1e-1111-4222-8333-444455556666';
const CF = {group: {id: GID, name: NAMES.group, include: [{email: {email: 'admin@example.com'}}, {email_domain: {domain: 'partner.co.jp'}}], exclude: [], require: []}, revoked: [], fail: false, auth: []};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); CF.auth.push((init.headers || {})['Authorization']);
  if (CF.fail) return new Response(JSON.stringify({success: false, errors: [{message: 'Authentication error'}]}), {status: 403});
  const base = `/client/v4/accounts/${ACC}`;
  if (u.pathname === `${base}/access/groups/${GID}` && (init.method || 'GET') === 'GET') return Response.json({success: true, result: CF.group});
  if (u.pathname === `${base}/access/groups/${GID}` && init.method === 'PUT'){ const b = JSON.parse(init.body); CF.group = {...CF.group, ...b}; return Response.json({success: true, result: CF.group}); }
  if (u.pathname === `${base}/access/organizations/revoke_user` && init.method === 'POST'){ CF.revoked.push(JSON.parse(init.body).email); return Response.json({success: true, result: true}); }
  return new Response(JSON.stringify({success: false, errors: [{message: 'not found ' + u.pathname}]}), {status: 404});
};
const KV = new Map(); const kv = {get: async k => KV.has(k) ? KV.get(k) : null, put: async (k, v) => { KV.set(k, v); }, delete: async k => { KV.delete(k); }};
const MENV = {...ENV, CF_API_TOKEN: 'runtime-token', CF_ACCOUNT_ID: ACC, CF_ACCESS_GROUP_ID: GID, ZUMEN_KV: kv};
async function api(method, body, {admin = true, env = MENV, headers = {}} = {}){
  const h = new Headers({'X-Zumen-Admin': '1', 'Origin': U, ...headers}); if (body !== undefined) h.set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) if (v === null) h.delete(k);
  const res = await members({request: new Request(U + '/api/admin/members', {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)}), env, data: {user: {email: admin ? 'admin@example.com' : 'user@example.com'}, isAdmin: admin}});
  return {status: res.status, j: await res.json(), res};
}
const emails = () => CF.group.include.map(r => r.email && r.email.email).filter(Boolean);
{ const r = await api('GET', undefined, {admin: false}); ok(r.status === 403, '管理者でなければ 403（API の中でも確かめる）'); }
{ const r = await api('GET', undefined, {env: {...MENV, CF_API_TOKEN: ''}}); ok(r.status === 503 && /CF_API_TOKEN/.test(r.j.error), '設定が足りなければ 503（足りない名前を出す）'); }
{ const r = await api('GET'); ok(r.status === 200 && r.j.members.length === 1 && r.j.members[0].admin && r.j.other === 1 && r.j.appUrl === U + '/', '一覧：管理者に印・メール以外の条件の数・アプリのアドレス');
  ok(r.res.headers.get('Cache-Control') === 'no-store' && r.res.headers.get('Content-Security-Policy') === H.CSP_API, 'API の応答は保存させない・何も読み込ませない');
  ok(CF.auth.every(a => a === 'Bearer runtime-token'), 'Cloudflare にはトークンを Bearer で送る'); }
{ const r = await api('POST', {text: 'a@example.com'}, {headers: {'X-Zumen-Admin': null}}); ok(r.status === 403, '決まった印の無い要求は 403（よそのサイトからの操作を止める）'); }
{ const r = await api('POST', {text: 'a@example.com'}, {headers: {'Origin': 'https://evil.example'}}); ok(r.status === 403, '別のサイト（Origin）からの要求は 403'); }
{ const r = await api('POST', {text: 'a@example.com'}, {headers: {'Origin': null}}); ok(r.status === 403, 'Origin の無い要求は 403'); }
{ const r = await api('POST', {text: 'A@Example.com, b@example.com\n bad@@x  c@example.com', memo: '<img src=x onerror=alert(1)> 田中工業'});
  ok(r.status === 200 && r.j.added.join() === 'a@example.com,b@example.com,c@example.com' && r.j.invalid.join() === 'bad@@x', 'まとめて登録：小文字にそろえ、形の悪いものは外す');
  ok(emails().join() === 'admin@example.com,a@example.com,b@example.com,c@example.com' && CF.group.include.some(x => x.email_domain), 'Access のグループに入り、メール以外の条件は消さない');
  ok(r.j.members.find(m => m.email === 'b@example.com').memo === '<img src=x onerror=alert(1)> 田中工業' && r.j.members.find(m => m.email === 'b@example.com').addedBy === 'admin@example.com', 'メモ・登録した人を残す（画面では文字として出す）'); }
{ const r = await api('POST', {text: 'a@example.com'}); ok(r.status === 200 && !r.j.added.length && r.j.already.join() === 'a@example.com', '登録済みは二重に入れない'); }
{ const r = await api('POST', {emails: Array.from({length: 201}, (_, i) => `u${i}@example.com`)}); ok(r.status === 400, '一度に 201 件以上は断る'); }
{ const r = await api('POST', {text: 'x@example.com'}, {env: {...MENV, MAX_MEMBERS: '4'}}); ok(r.status === 400 && emails().length === 4, '上限の人数を超える登録は断る'); }
{ const r = await api('POST', {text: 'nope'}); ok(r.status === 400, '形の正しいメールが無ければ 400'); }
{ const res = await members({request: new Request(U + '/api/admin/members', {method: 'POST', headers: {'X-Zumen-Admin': '1', Origin: U, 'Content-Type': 'text/plain'}, body: 'a'}), env: MENV, data: {user: {email: 'admin@example.com'}, isAdmin: true}}); ok(res.status === 415, 'JSON 以外は断る'); }
{ const r = await api('PATCH', {email: 'b@example.com', memo: '更新\u0007'}); ok(r.status === 200 && r.j.members.find(m => m.email === 'b@example.com').memo === '更新', 'メモを変えられる（制御文字は消す）'); }
{ const r = await api('DELETE', {email: 'admin@example.com'}); ok(r.status === 400 && emails().includes('admin@example.com'), '管理者は削除できない'); }
{ const r = await api('DELETE', {email: 'B@example.com'}); ok(r.status === 200 && r.j.removed === 'b@example.com' && !emails().includes('b@example.com') && CF.revoked.join() === 'b@example.com' && r.j.revoked, '削除：グループから外し、ログイン中のセッションも切る');
  ok(!KV.has('m:b@example.com') && JSON.parse(KV.get('log'))[0].act === '削除', '削除した人のメモは消し、操作の記録を残す'); }
{ const r = await api('DELETE', {email: 'zzz@example.com'}); ok(r.status === 404, '登録されていない人の削除は 404'); }
{ CF.fail = true; const r = await api('GET'); CF.fail = false; ok(r.status === 502 && /権限が足りません/.test(r.j.error) && !/runtime-token/.test(JSON.stringify(r.j)), 'Cloudflare が断ったときは 502（トークンは画面に出さない）'); }
{ const r = await api('GET', undefined, {env: {...MENV, ZUMEN_KV: undefined}}); ok(r.status === 200 && r.j.kv === false && !r.j.log.length, 'KV が無くても登録・削除は使える（メモ・記録なし）'); }

// ---- 管理の画面（admin.html）----
console.log('--- 管理の画面 ---');
const DEPS = (process.env.DXF_TAKEOFF_DEPS || (process.env.LOCALAPPDATA || '') + '/dxf-takeoff').replace(/\\/g, '/');
const {JSDOM} = createRequire(DEPS + '/package.json')('jsdom');
{
  const calls = []; let state = {me: 'admin@example.com', appUrl: U + '/', group: 'g', members: [{email: 'admin@example.com', admin: true, memo: '', addedAt: '', addedBy: ''}, {email: 'b@example.com', admin: false, memo: '<img src=x onerror="window.__pwn=1">', addedAt: '2026-11-24T00:00:00Z', addedBy: 'admin@example.com'}], admins: ['admin@example.com'], other: 0, kv: true, log: [{t: '2026-11-24T00:00:00Z', by: 'admin@example.com', act: '登録', email: '<b>x</b>@example.com'}], max: 1000};
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8'), {url: U + '/admin', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w){
    w.fetch = async (u, o = {}) => { calls.push({u, o}); if (o.method === 'POST'){ const b = JSON.parse(o.body); state = {...state, added: ['n@example.com'], already: [], invalid: [], members: [...state.members, {email: 'n@example.com', admin: false, memo: b.memo, addedAt: '', addedBy: 'admin@example.com'}]}; }
      return {ok: true, status: 200, json: async () => state}; };
    w.confirm = () => true; }});
  await sleep(50); const d = dom.window.document;
  ok(d.querySelectorAll('#tb tr').length === 2 && d.querySelector('#me').textContent.includes('admin@example.com'), '一覧が出る');
  ok(!d.querySelector('#tb img') && !d.querySelector('#log b') && dom.window.__pwn !== 1 && d.querySelector('#tb input').value === '' , 'メモ・記録に HTML を入れられても、文字として出す（動かない）');
  ok([...d.querySelectorAll('#tb button.dng')][0].disabled === true, '管理者の行は削除できない');
  d.querySelector('#emails').value = 'n@example.com'; d.querySelector('#memo').value = 'メモ'; d.querySelector('#add').click(); await sleep(30);
  const post = calls.find(c => c.o.method === 'POST');
  ok(post && post.u === '/api/admin/members' && post.o.headers['X-Zumen-Admin'] === '1' && post.o.headers['Content-Type'] === 'application/json' && JSON.parse(post.o.body).text === 'n@example.com', '登録は印と JSON を付けて API に送る');
  ok(d.querySelectorAll('#tb tr').length === 3 && /1人を登録しました/.test(d.querySelector('#addMsg').textContent), '登録すると一覧が増え、結果が出る');
}

// ---- 初期設定の台本（にせの Cloudflare API）----
console.log('--- 初期設定の台本 ---');
function fakeCf({org = true, reusable = true} = {}){
  const S = {idps: [], groups: [], policies: [], apps: [], appPolicies: {}, pages: {'zumen-keisoku': {name: 'zumen-keisoku'}}, writes: []}; let n = 0; const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const ok = r => Response.json({success: true, result: r}), ng = (s, m) => new Response(JSON.stringify({success: false, errors: [{message: m}]}), {status: s});
  const f = async (url, init = {}) => {
    const u = new URL(url), m = (init.method || 'GET').toUpperCase(), p = u.pathname.replace(`/client/v4/accounts/${'e'.repeat(32)}`, ''), b = init.body ? JSON.parse(init.body) : null;
    if (m !== 'GET') S.writes.push(`${m} ${p}`);
    if (p === '/access/organizations') return org ? ok({auth_domain: 'zumen-test.cloudflareaccess.com'}) : ng(404, 'not found');
    if (p === '/access/identity_providers') return m === 'GET' ? ok(S.idps) : ok((S.idps.push({id: id(), ...b}), S.idps.at(-1)));
    if (p === '/access/groups') return m === 'GET' ? ok(S.groups) : ok((S.groups.push({id: id(), ...b}), S.groups.at(-1)));
    if (p.startsWith('/access/groups/')){ const g = S.groups.find(x => x.id === p.split('/')[3]); Object.assign(g, b); return ok(g); }
    if (p === '/access/policies'){ if (!reusable) return ng(404, 'no'); return m === 'GET' ? ok(S.policies) : ok((S.policies.push({id: id(), ...b}), S.policies.at(-1))); }
    if (p === '/access/apps') return m === 'GET' ? ok(S.apps) : ok((S.apps.push({id: id(), aud: 'aud-' + n, ...b}), S.apps.at(-1)));
    const ap = p.match(/^\/access\/apps\/([^/]+)(\/policies)?$/);
    if (ap && ap[2]){ const L = S.appPolicies[ap[1]] ||= []; return m === 'GET' ? ok(L) : ok((L.push({id: id(), ...b}), L.at(-1))); }
    if (ap){ const a = S.apps.find(x => x.id === ap[1]); Object.assign(a, b); return ok(a); }
    const pg = p.match(/^\/pages\/projects\/([^/]+)$/);
    if (pg){ const pr = S.pages[pg[1]]; if (!pr) return ng(404, 'project'); if (m === 'PATCH') pr.deployment_configs = b.deployment_configs; return ok(pr); }
    return ng(404, 'unknown ' + p);
  };
  return {S, f};
}
const SO = {token: 'setup', runtimeToken: 'rt-secret', account: 'e'.repeat(32), project: 'zumen-keisoku', admins: ['Admin@Example.com'], log: () => {}};
{ const {S, f} = fakeCf(); const r = await setup(SO, f);
  const app = S.apps[0], ev = S.pages['zumen-keisoku'].deployment_configs.production.env_vars;
  ok(S.idps.length === 1 && S.idps[0].type === 'onetimepin', 'ログインの方法（ワンタイムPIN）を作る');
  ok(S.groups.length === 1 && S.groups[0].include[0].email.email === 'admin@example.com', '利用者のグループを作り、管理者を入れる');
  ok(S.policies.length === 1 && S.policies[0].include[0].group.id === S.groups[0].id && S.policies[0].decision === 'allow', 'グループの人だけ通すポリシー');
  ok(app && app.self_hosted_domains.join() === 'zumen-keisoku.pages.dev,*.zumen-keisoku.pages.dev' && app.policies[0].id === S.policies[0].id && app.allowed_idps[0] === S.idps[0].id && app.session_duration === '24h', 'Access のアプリ：本番とプレビューのアドレスを守る');
  ok(ev.ACCESS_AUD.value === app.aud && ev.ACCESS_TEAM_DOMAIN.value === 'zumen-test.cloudflareaccess.com' && ev.CF_ACCESS_GROUP_ID.value === S.groups[0].id && ev.ADMIN_EMAILS.value === 'admin@example.com' && ev.CF_API_TOKEN.type === 'secret_text' && ev.CF_API_TOKEN.value === 'rt-secret', 'Pages の環境変数（トークンは秘密の値）');
  const w1 = S.writes.length; await setup(SO, f);
  ok(S.idps.length === 1 && S.groups.length === 1 && S.policies.length === 1 && S.apps.length === 1 && !S.writes.slice(w1).some(w => w.startsWith('POST')), '2回流しても二重に作らない');
  const w2 = S.writes.length; const dr = await setup({...SO, dryRun: true}, f);
  ok(S.writes.length === w2 && dr.writes.length > 0, '--dry-run は何も変えない（予定だけ出す）'); }
{ const {S, f} = fakeCf({reusable: false}); await setup(SO, f); const aid = S.apps[0].id;
  ok(!S.apps[0].policies && (S.appPolicies[aid] || []).length === 1 && S.appPolicies[aid][0].include[0].group.id === S.groups[0].id, '古い仕組みのアカウントでは、アプリに直接ポリシーを付ける'); }
{ const {f} = fakeCf({org: false}); ok(/Zero Trust の初期設定/.test(await rejects(setup(SO, f))), 'Zero Trust のチームが無いときは、何をすればよいかを出して止まる'); }
ok(/アカウントID/.test(await rejects(setup({...SO, account: 'x'}, async () => {}))) && /管理者/.test(await rejects(setup({...SO, admins: ['bad']}, async () => {}))), '入力の誤りは Cloudflare に送る前に止める');
globalThis.fetch = realFetch;

// ---- アプリ本体・配るファイル ----
console.log('--- アプリ本体 ---');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
ok(!/<script[^>]+src="https?:/i.test(idx) && /<script src="lib\/pdf\.min\.js"><\/script>/.test(idx), '外の CDN から直接スクリプトを読まない（lib/ を使う）');
const sri = f => 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(ROOT, 'lib', f))).digest('base64');
for (const [k, f] of [['pdfjs', 'pdf.min.js'], ['worker', 'pdf.worker.min.js'], ['pdflib', 'pdf-lib.min.js']]){
  const m = idx.match(new RegExp(`${k}:\\{local:'lib/${f.replace(/\./g, '\\.')}', cdn:'([^']+)', sri:'([^']+)'\\}`));
  ok(m && m[2] === sri(f) && m[1].endsWith('/' + f), `予備の CDN の改ざん検査（SRI）が lib/${f} と一致`); }
ok(/isEvalSupported:false/.test(idx) && /enableXfa:false/.test(idx), 'PDF の中のスクリプトを動かさない（pdf.js の CVE-2024-4367 対策）');
ok(/\/\^\[A-Za-z0-9\]\[A-Za-z0-9_\+-\]\{0,63\}\$\/\.test\(String\(name\)\)/.test(idx), 'PDF から来る CMap の名前は決まった文字だけ');
ok(['lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js'].every(f => sw.includes(`'./${f}'`)) && /searchParams\.has\('fresh'\)/.test(sw), 'Service Worker：lib/ を保存し、ログインし直しのときは保存版を使わない');
{ const hd = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'); const got = Object.fromEntries(hd.split(/\r?\n/).filter(l => /^\s{2}\S/.test(l)).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  ok(got['Content-Security-Policy'] === H.CSP_APP && Object.entries(H.SECURITY_HEADERS).every(([k, v]) => got[k] === v), '_headers と functions/_lib/http.js のヘッダーが同じ'); }
{ // jsdom でアプリを開き、lib/ の pdf.js が読まれ、esc が ' も直すか
  const errs = [];
  const dom = new JSDOM(idx, {url: pathToFileURL(path.join(ROOT, 'index.html')).href, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(w){
    const ctx = new Proxy({}, {get: (t, k) => k === 'measureText' ? () => ({width: 10}) : k === 'getImageData' ? () => ({data: new Uint8ClampedArray(4)}) : (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; }});
    w.HTMLCanvasElement.prototype.getContext = () => ctx; w.ResizeObserver = class { observe(){} }; w.matchMedia = () => ({matches: false, addEventListener(){}, addListener(){}});
    w.Element.prototype.scrollIntoView = () => {}; w.indexedDB = undefined; w.fetch = () => Promise.reject(new Error('offline')); w.addEventListener('error', e => errs.push(e.message)); }});
  for (let i = 0; i < 40 && !dom.window.__S; i++) await sleep(100);
  const w = dom.window;
  ok(w.pdfjsLib && w.pdfjsLib.version === '3.11.174', 'アプリと同じ場所の pdf.js（3.11.174）を読む');
  ok(w.pdfjsLib && /\/lib\/pdf\.worker\.min\.js$/.test(w.pdfjsLib.GlobalWorkerOptions.workerSrc), 'PDF の処理（worker）も lib/ から');
  ok(!!w.__S && !errs.length, 'アプリが起動する' + (errs.length ? '（' + errs[0] + '）' : ''));
}

{ // Access で守ったサイト（https）として開く：ログイン中の表示・ログアウトで端末のデータを消す・期限切れのときの画面
  async function openApp(identity, {seen = false} = {}){
    const errs = [];
    const dom = new JSDOM(idx.replace(/<script src="lib\/pdf\.min\.js"><\/script>/, ''), {url: U + '/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w){
      const ctx = new Proxy({}, {get: (t, k) => k === 'measureText' ? () => ({width: 10}) : k === 'getImageData' ? () => ({data: new Uint8ClampedArray(4)}) : (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; }});
      w.HTMLCanvasElement.prototype.getContext = () => ctx; w.ResizeObserver = class { observe(){} }; w.matchMedia = () => ({matches: false, addEventListener(){}, addListener(){}});
      w.Element.prototype.scrollIntoView = () => {}; w.indexedDB = undefined; w.confirm = () => true;
      w.localStorage.setItem('pdfmeasure:test', 'x'); w.localStorage.setItem('other:keep', 'y'); if (seen) w.localStorage.setItem('pdfmeasure:access', '1');
      w.fetch = async (u) => { if (String(u).includes('/cdn-cgi/access/get-identity')) return identity(); throw new Error('offline'); };
      w.addEventListener('error', e => errs.push(e.message)); }});
    for (let i = 0; i < 30 && !dom.window.__S; i++) await sleep(50); await sleep(80);
    return {w: dom.window, d: dom.window.document, errs};
  }
  const idOk = () => ({ok: true, status: 200, type: 'basic', json: async () => ({email: 'user@example.com'})});
  const idOut = () => ({ok: false, status: 0, type: 'opaqueredirect', json: async () => null});
  { const {w, d, errs} = await openApp(idOk);
    ok(d.querySelector('#who') && d.querySelector('#who').textContent === '👤 user@example.com' && w.localStorage.getItem('pdfmeasure:access') === '1', 'ログイン中のメールを出す');
    d.querySelector('#who').click(); await sleep(20);
    ok(d.querySelector('#acOut') && d.querySelector('#acErase'), 'ログアウト／ログアウトして端末のデータを消す を選べる');
    d.querySelector('#acErase').click(); await sleep(80);
    ok(w.localStorage.getItem('pdfmeasure:test') === null && w.localStorage.getItem('pdfmeasure:access') === null && w.localStorage.getItem('other:keep') === 'y', '「データを消す」でこのアプリの保存だけを消す（ほかのサイトの分は残す）');
    ok(!errs.length, '画面の操作でエラーが出ない' + (errs.length ? '（' + errs[0] + '）' : '')); }
  { const {d} = await openApp(idOut, {seen: true});
    ok(d.querySelector('#accessLock') && d.querySelector('#accessRe'), 'ログインが切れた・登録を外されたら「もう一度ログイン」の画面で止める'); }
  { const {d} = await openApp(idOut, {seen: false});
    ok(!d.querySelector('#accessLock'), 'Access でログインしたことのないサイトでは止めない（GitHub Pages など）'); }
  { const {d} = await openApp(() => ({ok: false, status: 404, type: 'basic', json: async () => null}), {seen: true});
    ok(!d.querySelector('#accessLock'), 'ログインの確かめ先が無い（404）だけでは止めない'); }
}

console.log(bad ? `\n${bad}件 不合格` : '\nすべて合格');
process.exit(bad ? 1 : 0);
