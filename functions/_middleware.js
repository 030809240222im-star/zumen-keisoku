// すべての要求の入口（Cloudflare Pages Functions）
// 1. Cloudflare Access のログインの証明を確かめる（無い・偽物・期限切れは 403。設定が無ければ 503 で止める）
// 2. 管理の画面・API は管理者（ADMIN_EMAILS）だけ
// 3. 配ってよいファイル以外は 404（test/・tools/・docs/ などを出さない）
// 4. 安全のためのヘッダーを付ける
//
// 環境変数（Cloudflare Pages の設定 → 環境変数）
//   ACCESS_TEAM_DOMAIN  例 yourteam.cloudflareaccess.com
//   ACCESS_AUD          Access のアプリの「アプリケーション オーディエンス (AUD) タグ」
//   ADMIN_EMAILS        管理者のメール（カンマ区切り）
//   DEV_NO_AUTH=1       手元（localhost）で試すときだけ。公開先では効かない
import {verifyAccessJwt} from './_lib/access.js';
import {withSecurityHeaders, page, normPath, isAllowedPath, isAdminPath, adminEmails, normEmail} from './_lib/http.js';

export async function onRequest(ctx){
  const {request, env, next, data} = ctx;
  const url = new URL(request.url), p = normPath(url.pathname);
  if (p == null) return page(400, '開けません', 'アドレスが正しくありません。');

  let user = null;
  const local = (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && env.DEV_NO_AUTH === '1';
  if (local) user = {email: normEmail(env.DEV_EMAIL || 'dev@localhost.test')};
  else {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
      return page(503, '準備中です', '利用者の登録の設定（ACCESS_TEAM_DOMAIN・ACCESS_AUD）がまだ終わっていません。管理者に連絡してください。');
    try{
      user = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD});
    }catch(e){
      return page(403, 'このページは登録した人だけが使えます', 'ログインできていないか、メールアドレスが登録されていません。管理者に登録を依頼してください。');
    }
  }
  data.user = user;
  data.isAdmin = adminEmails(env).includes(user.email);

  if (!isAllowedPath(p)) return page(404, '見つかりません', 'このアドレスのページはありません。');
  if (isAdminPath(p) && !data.isAdmin) {
    if (/^\/api\//i.test(p)) return withSecurityHeaders(new Response(JSON.stringify({error: '管理者だけが使えます'}), {status: 403, headers: {'Content-Type': 'application/json; charset=utf-8'}}), 'api');
    return page(403, '管理者だけが使えます', 'この画面は管理者として登録したメールアドレスだけが開けます。');
  }
  const res = await next();
  return /^\/api\//i.test(p) ? res : withSecurityHeaders(res, 'app');
}
