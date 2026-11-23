// Cloudflare Access が付ける「ログインの証明」（Cf-Access-Jwt-Assertion の JWT）を確かめる。
// Access の設定が漏れていても（例：pages.dev の別の名前）、証明の無い・偽物の要求は通さない（fail closed）。
// 確かめる中身：署名（RS256・チームの公開鍵）、発行元（iss）、アプリの番号（aud）、期限（exp・nbf）、メール。

const enc = new TextEncoder(), dec = new TextDecoder();
function b64u(s){
  s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}
const part = s => JSON.parse(dec.decode(b64u(s)));
export const TEAM_RE = /^[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;

// チームの公開鍵（1時間ためておく。鍵の入れ替えのときだけ取り直す。取り直しは5分に1回まで）
const CACHE = new Map();   // team -> {at, keys, forcedAt}
async function teamKeys(team, fetchFn, force){
  const c = CACHE.get(team), now = Date.now();
  if (c && !force && now - c.at < 3600e3) return c.keys;
  if (c && force && now - (c.forcedAt || 0) < 300e3) return c.keys;
  const r = await fetchFn(`https://${team}/cdn-cgi/access/certs`, {cf: {cacheTtl: 300}});
  if (!r.ok) throw new Error('certs ' + r.status);
  const j = await r.json(); const keys = Array.isArray(j.keys) ? j.keys : [];
  CACHE.set(team, {at: now, keys, forcedAt: force ? now : (c && c.forcedAt) || 0});
  return keys;
}
export function _resetKeyCache(){ CACHE.clear(); }   // 試験用

export async function verifyAccessJwt(token, {teamDomain, aud, now = Date.now(), fetchFn = fetch} = {}){
  if (!TEAM_RE.test(String(teamDomain || ''))) throw new Error('team');
  if (!aud) throw new Error('aud-config');
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) throw new Error('no-token');
  const p = token.split('.'); if (p.length !== 3) throw new Error('format');
  let head, body; try{ head = part(p[0]); body = part(p[1]); }catch(e){ throw new Error('format'); }
  if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw new Error('alg');
  let keys = await teamKeys(teamDomain, fetchFn, false), jwk = keys.find(k => k.kid === head.kid);
  if (!jwk){ keys = await teamKeys(teamDomain, fetchFn, true); jwk = keys.find(k => k.kid === head.kid); }
  if (!jwk || jwk.kty !== 'RSA') throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', {kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true},
    {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(p[2]), enc.encode(p[0] + '.' + p[1]));
  if (!ok) throw new Error('signature');
  const t = Math.floor(now / 1000), skew = 60;
  if (typeof body.exp !== 'number' || body.exp < t - skew) throw new Error('expired');
  if (typeof body.nbf === 'number' && body.nbf > t + skew) throw new Error('not-yet');
  if (body.iss !== `https://${teamDomain}`) throw new Error('iss');
  const auds = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!auds.includes(aud)) throw new Error('aud');
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('email');   // サービストークン（メールなし）は通さない
  return {email, sub: String(body.sub || '')};
}
