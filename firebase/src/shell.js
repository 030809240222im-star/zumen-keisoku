// 入口：ログイン → 名簿の確認 → アプリ本体（Firestore）を受け取って開く
// ・ここ（誰でも見える所）にはアプリ本体を置かない。本体は名簿の人だけが読める（firestore.rules）
// ・図面・計測のデータは端末の中だけ。ここからも送らない
// ・電波が無いときは、前に確かめた人に限り、端末に残した本体で開く（最後に確かめてから 30 日まで）
import {initializeApp} from './fb/firebase-app.js';
import * as A from './fb/firebase-auth.js';
import * as F from './fb/firebase-firestore-lite.js';

const OFFLINE_DAYS = 30;
const $ = s => document.querySelector(s);
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const views = ['Wait', 'Login', 'Up', 'Verify', 'Deny', 'Err'];
function show(v, t){ for (const x of views) $('#v' + x).hidden = x !== v; if (v === 'Wait') $('#waitT').textContent = t || '確認しています…'; msg(''); }
function msg(t, kind){ const m = $('#msg'); m.textContent = t || ''; m.className = kind || ''; }
const ERR = {'auth/invalid-credential': 'メールアドレスかパスワードが違います。はじめての方は「はじめての方（登録）」から登録してください', 'auth/wrong-password': 'メールアドレスかパスワードが違います', 'auth/user-not-found': 'メールアドレスかパスワードが違います', 'auth/invalid-login-credentials': 'メールアドレスかパスワードが違います',
  'auth/invalid-email': 'メールアドレスの形が正しくありません', 'auth/email-already-in-use': 'このメールアドレスは登録済みです。「ログインに戻る」からログインしてください', 'auth/weak-password': 'パスワードは8文字以上にしてください', 'auth/password-does-not-meet-requirements': 'パスワードが条件に合いません。もっと長くしてください',
  'auth/too-many-requests': '何度も続いたため、しばらく止めています。時間をおいて試してください', 'auth/network-request-failed': 'つながりませんでした。電波を確かめてください', 'auth/user-disabled': 'このアカウントは止められています。管理者に連絡してください',
  'auth/operation-not-allowed': 'このログインの方法は、まだ使えるようになっていません（Firebase の Authentication で有効にします）', 'auth/configuration-not-found': 'ログインの設定がまだ終わっていません（Firebase の Authentication を有効にします）', 'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': ''};
const errMsg = e => { const c = String(e && e.code || ''); return c in ERR ? ERR[c] : 'うまくいきませんでした（' + (c || String(e && e.message || '')) + '）'; };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, ng) => setTimeout(() => ng(Object.assign(new Error('timeout'), {code: 'unavailable'})), ms))]);

// ---- 端末の控え（アプリ本体と、最後に名簿を確かめた記録）----
const DB = 'zumen-shell';
let dbp = null;
const idb = () => dbp || (dbp = new Promise(r => { try{ const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => r(q.result); q.onerror = q.onblocked = () => r(null); }catch(e){ r(null); } }));
async function kv(mode, fn){ const db = await idb(); if (!db) return undefined; return new Promise(r => { try{ const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => r(q && q.result); t.onerror = t.onabort = () => r(undefined); }catch(e){ r(undefined); } }); }
const kvGet = k => kv('readonly', s => s.get(k)), kvPut = (k, v) => kv('readwrite', s => s.put(v, k)), kvDel = k => kv('readwrite', s => s.delete(k));
const forget = async () => { await kvDel('app'); await kvDel('who'); };

// ---- Firebase ----
let auth, fs, cfg;
async function config(){
  try{ const r = await withTimeout(fetch('/__/firebase/init.json', {cache: 'no-store'}), 8000); if (!r.ok) throw new Error('config ' + r.status); const j = await r.json(); await kvPut('cfg', j); return j; }
  catch(e){ const j = await kvGet('cfg'); if (j) return j; throw e; }
}
async function boot(){
  cfg = await config(); const app = initializeApp(cfg);
  auth = A.getAuth(app); auth.languageCode = 'ja'; fs = F.getFirestore(app);
  if (LOCAL && cfg.zkEmulator){ A.connectAuthEmulator(auth, cfg.zkEmulator.auth, {disableWarnings: true}); F.connectFirestoreEmulator(fs, cfg.zkEmulator.fsHost, cfg.zkEmulator.fsPort); }   // 試験のときだけ（手元のアドレスでしか効かない）
  A.onAuthStateChanged(auth, u => { onUser(u).catch(e => fail(e)); });
}
function fail(e){ console.error(e); show('Err'); $('#eT').textContent = /unavailable|timeout|fetch|network/i.test(String(e && (e.code || e.message))) ? 'つながりませんでした。電波のある所でもう一度試してください。' : errMsg(e); }

// 名簿：{role,…}／null＝名簿に無い。つながらないときは例外
async function roster(email){
  try{ const d = await withTimeout(F.getDoc(F.doc(fs, 'members', email)), 12000); return d.exists() ? d.data() : null; }
  catch(e){ if (e && e.code === 'permission-denied') return null; throw e; }
}
let running = false;
async function onUser(u){
  if (running) return;
  if (!u){ show('Login'); return; }
  const email = String(u.email || '').toLowerCase();
  if (!u.emailVerified){ $('#vEm').textContent = email; show('Verify'); return; }
  show('Wait', '名簿を確かめています…');
  let m, off = false;
  try{ m = await roster(email); }catch(e){ off = true; }
  if (off){
    const w = await kvGet('who'), a = await kvGet('app');
    if (w && a && w.uid === u.uid && w.email === email && Date.now() - w.at < OFFLINE_DAYS * 864e5 && Date.now() >= w.at - 864e5) return open(a.html, {email, admin: false, offline: true});
    throw Object.assign(new Error('offline'), {code: 'unavailable'});
  }
  if (!m){ await forget(); $('#dEm').textContent = email; show('Deny'); return; }
  show('Wait', 'アプリを読み込んでいます…');
  const html = await appHtml();
  await kvPut('who', {uid: u.uid, email, at: Date.now()});
  return open(html, {email, admin: m.role === 'admin', offline: false});
}
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async t => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
// アプリ本体：版が同じなら端末の控え、違えば受け取って中身を確かめてから控える
async function appHtml(){
  const have = await kvGet('app');
  const c = await withTimeout(F.getDoc(F.doc(fs, 'app', 'current')), 15000); if (!c.exists()) throw new Error('アプリ本体がまだ置かれていません');
  const v = c.data(); if (have && have.ver === v.ver && have.html) return have.html;
  const parts = await Promise.all(Array.from({length: v.n}, (_, i) => withTimeout(F.getDoc(F.doc(fs, 'app', 'current', 'parts', v.ver + '-' + i)), 60000)));
  if (!parts.every(p => p.exists())) throw new Error('アプリ本体が欠けています');
  const html = parts.map(p => p.data().t).join(''); if (await sha(html) !== v.sha) throw new Error('アプリ本体が壊れています');
  await kvPut('app', {ver: v.ver, html}); return html;
}

// ---- アプリに渡す窓口（名簿・ログアウト）----
const EMAIL = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;
function api(ctx){
  const me = ctx.email, col = () => F.collection(fs, 'members'), ref = e => F.doc(fs, 'members', e);
  const wrap = async p => { try{ return await withTimeout(p, 15000); }catch(e){ throw new Error(e && e.code === 'permission-denied' ? 'この操作はできません（管理者ではないか、外せない人です）' : 'つながりませんでした。電波を確かめてください'); } };
  return Object.freeze({
    email: me, admin: ctx.admin, offline: ctx.offline, appUrl: location.origin + '/',
    // いまも使えるか：ok／out（外された・ログインが切れた）／offline
    async check(){ const u = auth.currentUser; if (!u) return 'out'; try{ const m = await roster(me); if (m) { await kvPut('who', {uid: u.uid, email: me, at: Date.now()}); return 'ok'; } await forget(); return 'out'; }catch(e){ return 'offline'; } },
    async signOut(){ await forget(); await A.signOut(auth); location.reload(); },
    async erase(){ await forget(); try{ (await idb()).close(); indexedDB.deleteDatabase(DB); }catch(e){} await A.signOut(auth); },
    async list(){ const s = await wrap(F.getDocs(col())); return s.docs.map(d => ({email: d.id, ...d.data()})).sort((a, b) => a.email.localeCompare(b.email)); },
    async add(email, {role = 'member', name = ''} = {}){ const e = String(email).trim().toLowerCase(); if (!EMAIL.test(e) || e.length > 254) throw new Error('メールアドレスの形が正しくありません：' + e);
      const d = await wrap(F.getDoc(ref(e))); if (d.exists()) return 'already'; await wrap(F.setDoc(ref(e), {role: role === 'admin' ? 'admin' : 'member', name: String(name).trim().slice(0, 60), at: new Date().toISOString(), by: me})); return 'added'; },
    async update(email, patch){ const d = await wrap(F.getDoc(ref(email))); if (!d.exists()) throw new Error('名簿にありません'); const o = d.data(); await wrap(F.setDoc(ref(email), {role: patch.role || o.role, name: patch.name != null ? String(patch.name).trim().slice(0, 60) : o.name || '', at: o.at, by: o.by})); },
    async remove(email){ await wrap(F.deleteDoc(ref(email))); },
  });
}
function open(html, ctx){
  running = true; window.zumenAuth = api(ctx);
  document.open(); document.write(html); document.close();   // 同じ画面のまま、アプリ本体に入れ替える
}

// ---- ボタン ----
const busy = async (btn, fn) => { btn.disabled = true; msg(''); try{ await fn(); }catch(e){ const t = errMsg(e); if (t) msg(t, 'bad'); }finally{ btn.disabled = false; } };
$('#bGoogle').onclick = e => busy(e.currentTarget, async () => {
  const p = new A.GoogleAuthProvider(); p.setCustomParameters({prompt: 'select_account'});
  if (navigator.standalone) return A.signInWithRedirect(auth, p);   // ホーム画面から開いた iPad・iPhone
  try{ await A.signInWithPopup(auth, p); }catch(x){ if (/popup-blocked|operation-not-supported/.test(x.code || '')) return A.signInWithRedirect(auth, p); throw x; } });
$('#fIn').onsubmit = e => { e.preventDefault(); busy(e.submitter || e.target.querySelector('button'), () => A.signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value)); };
const sendVerify = u => A.sendEmailVerification(u, {url: location.origin + '/'}).catch(e => { if (/continue-uri/.test(e.code || '')) return A.sendEmailVerification(u); throw e; });
$('#fUp').onsubmit = e => { e.preventDefault(); busy(e.submitter || e.target.querySelector('button'), async () => { if ($('#pw2').value.length < 8) throw {code: 'auth/weak-password'}; const c = await A.createUserWithEmailAndPassword(auth, $('#em2').value.trim(), $('#pw2').value); await sendVerify(c.user); }); };
$('#toUp').onclick = () => { $('#em2').value = $('#em').value; show('Up'); };
$('#toIn').onclick = () => { $('#em').value = $('#em2').value; show('Login'); };
$('#bReset').onclick = e => busy(e.currentTarget, async () => { const m = $('#em').value.trim(); if (!m){ msg('メールアドレスを入れてから押してください', 'bad'); return; } try{ await A.sendPasswordResetEmail(auth, m); }catch(x){ if (!/user-not-found/.test(x.code || '')) throw x; } msg('登録があれば、パスワードを設定し直すメールを送りました。迷惑メールのフォルダも見てください', 'ok'); });
$('#bSend').onclick = e => busy(e.currentTarget, async () => { await sendVerify(auth.currentUser); msg('確認メールを送りました', 'ok'); });
$('#bChk').onclick = e => busy(e.currentTarget, async () => { await auth.currentUser.reload(); if (auth.currentUser.emailVerified){ await auth.currentUser.getIdToken(true); location.reload(); } else msg('まだ確認できていません。メールの中のリンクを開いてから押してください', 'bad'); });
$('#bAgain').onclick = $('#bRetry').onclick = () => location.reload();
document.querySelectorAll('[data-out]').forEach(b => { b.onclick = async () => { await forget(); try{ await A.signOut(auth); }catch(e){} location.reload(); }; });

if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
boot().catch(fail);
