// 応答に付ける安全のためのヘッダー・公開してよいパス・メールの確かめ方（_middleware.js と api/ で共通）
// ※ _headers（Functions を使わないときの予備）も同じ中身にする。test/security.mjs で一致を確かめる。

// アプリの画面：外への通信は一切させない（connect-src 'self'）。図面のデータを端末の外へ出さない決まりを、ブラウザにも守らせる
export const CSP_APP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self' blob:",
  "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
// API の応答：何も読み込ませない
export const CSP_API = "default-src 'none'; frame-ancestors 'none'";

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Strict-Transport-Security': 'max-age=31536000',
};

// 配ってよいファイル（これ以外の test/・tools/・docs/・CLAUDE.md などは 404）
const ALLOW = [
  /^\/$/, /^\/index\.html$/, /^\/admin(\.html)?\/?$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/cmaps-ja\.json$/,
  /^\/(icon-192|icon-512|apple-touch-icon)\.png$/, /^\/favicon\.ico$/,
  /^\/lib\/(pdf\.min|pdf\.worker\.min|pdf-lib\.min)\.js$/, /^\/lib\/cmaps\/[A-Za-z0-9][A-Za-z0-9_+-]{0,63}\.bcmap$/,
  /^\/api\/admin\/members$/,
];
export function normPath(pathname){ let p = pathname; try{ p = decodeURIComponent(pathname); }catch(e){ return null; } return p; }
export const isAllowedPath = p => p != null && ALLOW.some(r => r.test(p));
export const isAdminPath = p => p != null && (/^\/admin(\.html)?\/?$/i.test(p) || /^\/api\/admin(\/|$)/i.test(p));

export function withSecurityHeaders(res, kind = 'app'){
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  r.headers.set('Content-Security-Policy', kind === 'api' ? CSP_API : CSP_APP);
  if (kind === 'api') r.headers.set('Cache-Control', 'no-store');
  return r;
}
export function json(obj, status = 200){
  return withSecurityHeaders(new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json; charset=utf-8'}}), 'api');
}
export function page(status, title, msg){
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font-family:system-ui,sans-serif;background:#14171c;color:#e6e9ef;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">
<div style="max-width:440px;line-height:1.7"><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(msg)}</p></div></body></html>`;
  return withSecurityHeaders(new Response(html, {status, headers: {'Content-Type': 'text/html; charset=utf-8'}}), 'app');
}

// メールアドレス（小文字にそろえる）
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const normEmail = s => String(s == null ? '' : s).trim().toLowerCase();
export const isEmail = s => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s) && !s.includes('..');
export const adminEmails = env => String(env.ADMIN_EMAILS || '').split(/[,\s]+/).map(normEmail).filter(isEmail);
