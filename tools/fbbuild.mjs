// Firebase に出す物を組み立てる → firebase/out/（git に入れない）
//   out/public … 誰でも見える所に置く物（ログイン画面・ライブラリ・アイコン）。アプリ本体（index.html）は入れない
//   out/app.json … アプリ本体（Firestore に置き、名簿の人にだけ渡す）
//   out/firestore.rules・out/firebase.json
// 使い方：node tools/fbbuild.mjs   （firebase/local.json に {"owner":"管理者のメール","project":"zumen-keisoku"}。公開リポジトリに入れない）
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import {fileURLToPath, pathToFileURL} from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), FB = path.join(ROOT, 'firebase'), OUT = path.join(FB, 'out');
export const PART = 200000;   // 1つの文書は 1MB まで（日本語は1字3バイト）
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

export function localConf(){
  const f = path.join(FB, 'local.json'); if (!fs.existsSync(f)) throw new Error('firebase/local.json がありません（{"owner":"管理者のメール","project":"zumen-keisoku"}）');
  const c = JSON.parse(fs.readFileSync(f, 'utf8')); c.owner = String(c.owner || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(c.owner)) throw new Error('local.json の owner（管理者のメール）の形が正しくありません'); if (!/^[a-z0-9-]{4,40}$/.test(c.project || '')) throw new Error('local.json の project が正しくありません');
  return c;
}
export const rulesFor = owner => fs.readFileSync(path.join(FB, 'firestore.rules.tpl'), 'utf8').replace(/\r\n/g, '\n').split('__OWNER__').join(owner);
export function appDoc(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n'), h = sha(html), ver = h.slice(0, 16), parts = [];
  // サロゲートペア（絵文字など）の間では切らない
  for (let i = 0; i < html.length;){ let e = Math.min(html.length, i + PART); const c = html.charCodeAt(e - 1); if (e < html.length && c >= 0xd800 && c <= 0xdbff) e--; parts.push(html.slice(i, e)); i = e; }
  return {ver, sha: h, n: parts.length, parts};
}
export function csp(project, extra = ''){
  return ["default-src 'self'", "script-src 'self' 'unsafe-inline' https://apis.google.com", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com${extra}`,
    `frame-src 'self' https://${project}.firebaseapp.com`, "worker-src 'self' blob:", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"].join('; ');
}
export const headersFor = project => ({
  'Content-Security-Policy': csp(project), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN', 'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Cache-Control': 'no-cache',
});
export function build(){
  const c = localConf(), pub = path.join(OUT, 'public'); fs.rmSync(OUT, {recursive: true, force: true}); fs.mkdirSync(pub, {recursive: true});
  const put = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(pub, to || from), {recursive: true});
  for (const f of ['lib', 'cmaps-ja.json', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) put(f);
  put('firebase/src/index.html', 'index.html'); put('firebase/src/shell.js', 'shell.js'); put('firebase/fb', 'fb');
  // Service Worker：入口の部品も端末に残す（電波が無くても入口が開く）。中身が変われば版が変わる
  let sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/\r\n/g, '\n'); const add = ['shell.js', 'fb/firebase-app.js', 'fb/firebase-auth.js', 'fb/firebase-firestore-lite.js'];
  const stamp = sha(['index.html', ...add].map(f => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n')).slice(0, 8);
  const rep = (a, b) => { if (sw.split(a).length !== 2) throw new Error('sw.js：' + a); sw = sw.replace(a, () => b); };
  sw = sw.replace(/const VER='(zumen-v\d+)';/, (_, v) => `const VER='${v}-${stamp}';`); if (!sw.includes(stamp)) throw new Error('sw.js：VER');
  rep("'./lib/pdf-lib.min.js'].map(", "'./lib/pdf-lib.min.js'," + add.map(f => `'./${f}'`).join(',') + '].map(');
  fs.writeFileSync(path.join(pub, 'sw.js'), sw);
  const app = appDoc(); fs.writeFileSync(path.join(OUT, 'app.json'), JSON.stringify(app));
  fs.writeFileSync(path.join(OUT, 'firestore.rules'), rulesFor(c.owner));
  fs.writeFileSync(path.join(OUT, 'firebase.json'), JSON.stringify({firestore: {rules: 'firestore.rules'}, hosting: {site: c.project, public: 'public', ignore: ['firebase.json', '**/.*'], headers: [{source: '**', headers: Object.entries(headersFor(c.project)).map(([key, value]) => ({key, value}))}]}}, null, 1));
  // アプリ本体が誰でも見える所に紛れていないか
  const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(pub)) if (/\.(html|js)$/.test(f)){ const t = fs.readFileSync(f, 'utf8'); if (/W_ROWS|computeWall0|optimizeLayer/.test(t) || t.includes(c.owner)) throw new Error('誰でも見える所に、アプリ本体か管理者のメールが入っています：' + f); }
  return {conf: c, app, pub};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){ try{ const r = build(); console.log(`組み立てた：アプリ本体 版 ${r.app.ver}（${r.app.n}つに分割）→ firebase/out/`); }catch(e){ console.error('止まりました：' + e.message); process.exit(1); } }
