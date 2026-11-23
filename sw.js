// 図面計測ツール Service Worker — オフライン起動用
// ・保存するのはアプリ本体と決まったファイルだけ（他の画面や画像をアプリとして保存しない）
// ・電波が弱いときは 3.5 秒で保存済みのアプリから起動し、裏で最新版を取り込む
// ・Cloudflare Access のログイン画面（リダイレクト）は保存しない
const VER='zumen-v5';
const SCOPE=new URL('./', self.location).href;
const CORE=['./','./index.html','./cmaps-ja.json','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'].map(u=>new URL(u, SCOPE).href);
const LIBS=['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'];
const APP_URLS=new Set([SCOPE, SCOPE+'index.html']);
const okToCache = res => res && res.ok && !res.redirected && (res.type==='basic' || res.type==='cors');
const isHtml = res => /text\/html/i.test(res.headers.get('content-type')||'');
async function put(c, key, req){ try{ const res=await fetch(req); if (okToCache(res)) await c.put(key, res); }catch(e){} }
self.addEventListener('install', e=>{ e.waitUntil(caches.open(VER).then(c=>Promise.all([
  ...CORE.map(u=>put(c, u, new Request(u,{cache:'reload', credentials:'include'}))),
  ...LIBS.map(u=>put(c, u, new Request(u,{cache:'reload', mode:'cors'})))]))); self.skipWaiting(); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('zumen-') && k!==VER).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
function timeout(ms){ return new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms)); }
self.addEventListener('fetch', e=>{
  const r=e.request; if (r.method!=='GET') return; const u=new URL(r.url); u.hash='';
  const lib=LIBS.includes(u.href);
  if (u.origin===location.origin && u.pathname.includes('/cdn-cgi/')) return;      // ログイン・ログアウト等は素通し
  if (r.mode==='navigate'){
    const path=u.origin+u.pathname;
    if (!APP_URLS.has(path)) return;                                                   // アプリ以外の画面には関与しない
    const net=fetch(r).then(res=>{ if (okToCache(res) && isHtml(res)){ const c=res.clone(); caches.open(VER).then(x=>x.put(SCOPE+'index.html',c)); } return res; });
    e.respondWith(caches.match(SCOPE+'index.html').then(cached=>{
      if (!cached) return net;
      e.waitUntil(net.catch(()=>{}));
      return Promise.race([net, timeout(3500)]).catch(()=>cached);                     // 弱い電波でも待たせない
    }));
    return; }
  const same=u.origin===location.origin && CORE.includes(u.origin+u.pathname);
  if (!same && !lib) return;                                                           // 決まったファイル以外は保存しない
  e.respondWith(caches.match(u.href).then(m=>m||fetch(r).then(res=>{ if (okToCache(res)){ const c=res.clone(); caches.open(VER).then(x=>x.put(u.href,c)); } return res; })));
});
