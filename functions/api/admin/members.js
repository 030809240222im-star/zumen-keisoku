// 利用者（メールアドレス）の登録・削除 — 管理の画面（admin.html）から使う
// 名簿の正本は Cloudflare Access の「グループ」（メールの一覧）。Access はこの一覧の人だけにログインのコードを送る。
//   GET    一覧
//   POST   {emails:[...] | text:"改行・カンマ区切り", memo}  登録
//   PATCH  {email, memo}  メモの変更（ZUMEN_KV があるとき）
//   DELETE {email}  削除（あわせてログイン中のセッションも切る）
// 環境変数：CF_API_TOKEN（権限：Access: Organizations, Identity Providers, and Groups の編集 だけ）・CF_ACCOUNT_ID・CF_ACCESS_GROUP_ID
//          ZUMEN_KV（任意。KV を結び付けると、メモ・登録日・操作の記録を残す）・MAX_MEMBERS（既定 1000）
import {json, normEmail, isEmail, adminEmails} from '../../_lib/http.js';

const API = 'https://api.cloudflare.com/client/v4';
const ID_RE = /^[0-9a-f-]{20,64}$/i;
class ApiErr extends Error { constructor(status, msg){ super(msg); this.status = status; } }

async function cf(env, path, init = {}){
  let r; try{
    r = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID}${path}`, {...init, headers: {'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json'}});
  }catch(e){ throw new ApiErr(502, 'Cloudflare につながりませんでした'); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.success === false){
    const m = (j && Array.isArray(j.errors) ? j.errors.map(e => e && e.message).filter(Boolean).join(' / ') : '') || `HTTP ${r.status}`;
    throw new ApiErr(502, (r.status === 401 || r.status === 403 ? 'Cloudflare の API トークンの権限が足りません：' : 'Cloudflare の設定を変更できませんでした：') + m.slice(0, 200));
  }
  return j.result;
}
const getGroup = env => cf(env, `/access/groups/${env.CF_ACCESS_GROUP_ID}`);
const putGroup = (env, g, include) => cf(env, `/access/groups/${env.CF_ACCESS_GROUP_ID}`, {method: 'PUT',
  body: JSON.stringify({name: g.name, include, exclude: g.exclude || [], require: g.require || [], ...(g.is_default != null ? {is_default: g.is_default} : {})})});
const ruleEmail = r => r && r.email && typeof r.email.email === 'string' ? normEmail(r.email.email) : null;

// KV（任意）：m:<メール> = {memo, addedAt, addedBy}、log = 最近の操作 300件
const kvGet = async (env, k) => { if (!env.ZUMEN_KV) return null; try{ return JSON.parse(await env.ZUMEN_KV.get(k) || 'null'); }catch(e){ return null; } };
const kvPut = async (env, k, v) => { if (env.ZUMEN_KV) await env.ZUMEN_KV.put(k, JSON.stringify(v)); };
const kvDel = async (env, k) => { if (env.ZUMEN_KV) await env.ZUMEN_KV.delete(k); };
async function logOp(env, by, act, emails){
  if (!env.ZUMEN_KV || !emails.length) return;
  const log = (await kvGet(env, 'log')) || []; const t = new Date().toISOString();
  for (const e of emails) log.unshift({t, by, act, email: e});
  await kvPut(env, 'log', log.slice(0, 300));
}
const cleanMemo = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);

function missingEnv(env){ return ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_ACCESS_GROUP_ID'].filter(k => !env[k]); }
async function readBody(request){
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) throw new ApiErr(415, 'JSON で送ってください');
  const t = await request.text(); if (t.length > 65536) throw new ApiErr(413, '一度に送れる量を超えています');
  try{ return JSON.parse(t || '{}'); }catch(e){ throw new ApiErr(400, '送られた内容を読めませんでした'); }
}
// よそのサイトから管理の操作をさせない（CSRF）：同じサイトからの、決まった印の付いた要求だけ
function sameSiteOnly(request){
  const url = new URL(request.url), origin = request.headers.get('Origin');
  if (request.headers.get('X-Zumen-Admin') !== '1' || !origin || origin !== url.origin) throw new ApiErr(403, 'この画面からの操作ではありません');
}

async function listing(env, me, request){
  const g = await getGroup(env); const admins = adminEmails(env);
  const emails = []; let other = 0;
  for (const r of g.include || []){ const e = ruleEmail(r); if (e) emails.push(e); else other++; }
  const members = [];
  for (const e of [...new Set(emails)].sort()){ const m = (await kvGet(env, 'm:' + e)) || {}; members.push({email: e, admin: admins.includes(e), memo: m.memo || '', addedAt: m.addedAt || '', addedBy: m.addedBy || ''}); }
  return {me, appUrl: new URL(request.url).origin + '/', group: g.name, members, admins, other, kv: !!env.ZUMEN_KV,
    log: env.ZUMEN_KV ? ((await kvGet(env, 'log')) || []).slice(0, 50) : [], max: +env.MAX_MEMBERS || 1000};
}

export async function onRequest(ctx){
  const {request, env, data} = ctx;
  try{
    if (!data || !data.user || !data.isAdmin) throw new ApiErr(403, '管理者だけが使えます');
    const miss = missingEnv(env); if (miss.length) throw new ApiErr(503, '設定が足りません：' + miss.join('・'));
    if (!ID_RE.test(env.CF_ACCESS_GROUP_ID) || !/^[0-9a-f]{32}$/i.test(env.CF_ACCOUNT_ID)) throw new ApiErr(503, 'CF_ACCOUNT_ID・CF_ACCESS_GROUP_ID の形が正しくありません');
    const me = data.user.email, method = request.method.toUpperCase();
    if (method === 'GET') return json(await listing(env, me, request));
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw new ApiErr(405, 'この操作はできません');
    sameSiteOnly(request);
    const b = await readBody(request);

    if (method === 'POST'){
      const raw = Array.isArray(b.emails) ? b.emails : String(b.text || '').split(/[\s,;、，]+/);
      if (raw.length > 200) throw new ApiErr(400, '一度に登録できるのは 200 件までです');
      const memo = cleanMemo(b.memo);
      const want = [], invalid = [];
      for (const x of raw){ const e = normEmail(x); if (!e) continue; (isEmail(e) ? want : invalid).push(e); }
      if (!want.length) throw new ApiErr(400, invalid.length ? 'メールアドレスの形が正しくありません：' + invalid.slice(0, 5).join('、') : 'メールアドレスを入れてください');
      const g = await getGroup(env); const include = [...(g.include || [])];
      const have = new Set(include.map(ruleEmail).filter(Boolean));
      const added = [], already = [];
      for (const e of [...new Set(want)]){ if (have.has(e)) already.push(e); else { include.push({email: {email: e}}); have.add(e); added.push(e); } }
      const max = +env.MAX_MEMBERS || 1000;
      if (have.size > max) throw new ApiErr(400, `登録できるのは ${max} 人までです`);
      if (added.length) await putGroup(env, g, include);
      const t = new Date().toISOString();
      for (const e of added) await kvPut(env, 'm:' + e, {memo, addedAt: t, addedBy: me});
      await logOp(env, me, '登録', added);
      return json({added, already, invalid, ...(await listing(env, me, request))});
    }

    const email = normEmail(b.email);
    if (!isEmail(email)) throw new ApiErr(400, 'メールアドレスの形が正しくありません');

    if (method === 'PATCH'){
      if (!env.ZUMEN_KV) throw new ApiErr(400, 'メモを残すには ZUMEN_KV（KV）を結び付けてください');
      const m = (await kvGet(env, 'm:' + email)) || {}; m.memo = cleanMemo(b.memo); await kvPut(env, 'm:' + email, m);
      return json(await listing(env, me, request));
    }

    // DELETE
    if (adminEmails(env).includes(email)) throw new ApiErr(400, '管理者は削除できません（ADMIN_EMAILS から外してからにしてください）');
    const g = await getGroup(env); const include = (g.include || []).filter(r => ruleEmail(r) !== email);
    if (include.length === (g.include || []).length) throw new ApiErr(404, 'このメールアドレスは登録されていません');
    if (!include.length) throw new ApiErr(400, '最後の 1 人は削除できません');
    await putGroup(env, g, include);
    let revoked = true; try{ await cf(env, '/access/organizations/revoke_user', {method: 'POST', body: JSON.stringify({email})}); }catch(e){ revoked = false; }
    await kvDel(env, 'm:' + email); await logOp(env, me, '削除', [email]);
    return json({removed: email, revoked, ...(await listing(env, me, request))});
  }catch(e){
    if (e instanceof ApiErr) return json({error: e.message}, e.status);
    return json({error: 'うまくいきませんでした。時間をおいてもう一度お試しください'}, 500);
  }
}
