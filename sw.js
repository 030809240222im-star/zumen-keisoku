// 図面計測ツール Service Worker — オフライン起動用（アプリ本体と読み込むライブラリをキャッシュ）
const VER='zumen-v1';
const CORE=['./','./index.html','./cmaps-ja.json','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(VER).then(c=>Promise.all(CORE.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{}))))); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VER).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  const r=e.request; if (r.method!=='GET') return; const u=new URL(r.url);
  const same=u.origin===location.origin, lib=/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(u.host);
  if (!same && !lib) return;
  // 画面(HTML)は最新を優先し、オフライン時はキャッシュ。ライブラリ等はキャッシュ優先。
  if (r.mode==='navigate' || (same && /\/(index\.html)?$/.test(u.pathname))){
    e.respondWith(fetch(r).then(res=>{ const c=res.clone(); caches.open(VER).then(x=>x.put('./index.html',c)); return res; }).catch(()=>caches.match('./index.html').then(m=>m||caches.match('./'))));
    return; }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{ if (res.ok||res.type==='opaque'){ const c=res.clone(); caches.open(VER).then(x=>x.put(r,c)); } return res; })));
});
