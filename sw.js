// 図面計測ツール Service Worker — オフライン起動用（アプリ本体と読み込むライブラリをキャッシュ）
// ※ Cloudflare Access のログイン画面（リダイレクト）はキャッシュしない
const VER='zumen-v2';
const CORE=['./','./index.html','./cmaps-ja.json','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const LIBS=['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'];
const okToCache = res => res && res.ok && !res.redirected && (res.type==='basic' || res.type==='cors');
async function put(c, key, req){ try{ const res=await fetch(req); if (okToCache(res)) await c.put(key, res); }catch(e){} }
self.addEventListener('install', e=>{ e.waitUntil(caches.open(VER).then(c=>Promise.all([
  ...CORE.map(u=>put(c, u, new Request(u,{cache:'reload', credentials:'include'}))),
  ...LIBS.map(u=>put(c, u, new Request(u,{cache:'reload', mode:'cors'})))]))); self.skipWaiting(); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VER).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  const r=e.request; if (r.method!=='GET') return; const u=new URL(r.url);
  const same=u.origin===location.origin, lib=/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(u.host);
  if (!same && !lib) return;
  if (same && u.pathname.startsWith('/cdn-cgi/')) return;            // ログイン・ログアウト等は素通し
  if (r.mode==='navigate'){
    // 画面は最新を優先。ネットに繋がらないときだけキャッシュで起動（ログイン切れのリダイレクトはそのままブラウザへ）
    e.respondWith(fetch(r).then(res=>{ if (okToCache(res)){ const c=res.clone(); caches.open(VER).then(x=>x.put('./index.html',c)); } return res; })
      .catch(()=>caches.match('./index.html').then(m=>m||caches.match('./'))));
    return; }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{ if (okToCache(res)){ const c=res.clone(); caches.open(VER).then(x=>x.put(r,c)); } return res; })));
});
