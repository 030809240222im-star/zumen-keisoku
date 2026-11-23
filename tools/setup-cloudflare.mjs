// Cloudflare の初期設定を API で行う（何度流しても同じ結果になる。--dry-run は読むだけ）
//   ・ログインの方法：ワンタイムPIN（メールに届く6桁のコード）
//   ・利用者のグループ「図面計測ツール 利用者」（最初は管理者だけ）
//   ・Access のポリシー（このグループの人だけ通す）とアプリ（Pages のアドレスを守る）
//   ・Pages の環境変数（ACCESS_TEAM_DOMAIN・ACCESS_AUD・ADMIN_EMAILS・CF_ACCOUNT_ID・CF_ACCESS_GROUP_ID・CF_API_TOKEN）
//
// 使い方（PowerShell）：
//   $env:CF_SETUP_TOKEN="初期設定用のトークン"; $env:CF_RUNTIME_TOKEN="管理の画面用のトークン"
//   node tools/setup-cloudflare.mjs --account <アカウントID> --project zumen-keisoku --admin you@example.com [--domain 独自ドメイン] [--dry-run]
// トークンはコマンドの履歴に残らないよう、引数ではなく環境変数で渡す。終わったら初期設定用のトークンは Cloudflare で削除する。
import {pathToFileURL} from 'node:url';

export const NAMES = {group: '図面計測ツール 利用者', policy: '図面計測ツール 利用者だけ', app: '図面計測ツール', idp: 'ワンタイムPIN（メール）'};
const API = 'https://api.cloudflare.com/client/v4';
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export async function setup(opt, fetchFn = fetch){
  const log = opt.log || (s => console.log(s));
  const {token, account, project, dryRun} = opt;
  const admins = [...new Set((opt.admins || []).map(s => String(s).trim().toLowerCase()).filter(Boolean))];
  if (!token) throw new Error('CF_SETUP_TOKEN（初期設定用のトークン）を環境変数に入れてください');
  if (!/^[0-9a-f]{32}$/i.test(account || '')) throw new Error('--account にアカウントID（32桁の英数字）を入れてください');
  if (!admins.length || !admins.every(e => EMAIL_RE.test(e))) throw new Error('--admin に管理者のメールアドレスを入れてください');
  if (project && !/^[a-z0-9][a-z0-9-]{0,57}$/.test(project)) throw new Error('--project の名前が正しくありません');
  const domains = [...new Set([...(opt.domains || []), ...(project ? [`${project}.pages.dev`, `*.${project}.pages.dev`] : [])].map(s => String(s).trim().toLowerCase()).filter(Boolean))];
  if (!domains.length) throw new Error('--project か --domain を入れてください');

  const writes = [];
  async function cf(path, init = {}, {soft = false} = {}){
    const method = (init.method || 'GET').toUpperCase();
    if (method !== 'GET' && dryRun){ writes.push(`${method} ${path}`); return method === 'POST' ? {id: '(作成予定)', aud: '(作成後に決まる)'} : {}; }
    const r = await fetchFn(`${API}/accounts/${account}${path}`, {...init, headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'}});
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false){
      if (soft) return {__failed: r.status};
      const m = (j && j.errors || []).map(e => e.message).join(' / ') || `HTTP ${r.status}`;
      throw new Error(`Cloudflare API（${method} ${path}）：${m}` + (r.status === 403 ? '\n→ トークンの権限が足りません。手順書の「トークンの権限」を確かめてください' : ''));
    }
    if (method !== 'GET') writes.push(`${method} ${path}`);
    return j.result;
  }
  const list = async path => { const r = await cf(path + (path.includes('?') ? '&' : '?') + 'per_page=100'); return Array.isArray(r) ? r : []; };

  // 1. Zero Trust のチーム
  const org = await cf('/access/organizations', {}, {soft: true});
  if (!org || org.__failed || !org.auth_domain) throw new Error('Zero Trust の初期設定（チーム名）がまだです。ダッシュボードの Zero Trust を一度開き、チーム名を決めてから流してください');
  const team = org.auth_domain; log(`チーム：${team}`);

  // 2. ログインの方法（ワンタイムPIN）
  let idp = (await list('/access/identity_providers')).find(x => x.type === 'onetimepin');
  if (idp) log('ログインの方法：ワンタイムPIN（設定済み）');
  else { idp = await cf('/access/identity_providers', {method: 'POST', body: JSON.stringify({name: NAMES.idp, type: 'onetimepin', config: {}})}); log('ログインの方法：ワンタイムPIN を追加'); }

  // 3. 利用者のグループ（管理者を必ず入れる）
  let group = (await list('/access/groups')).find(g => g.name === NAMES.group);
  if (!group){
    group = await cf('/access/groups', {method: 'POST', body: JSON.stringify({name: NAMES.group, include: admins.map(e => ({email: {email: e}})), exclude: [], require: []})});
    log(`グループ「${NAMES.group}」を作成（管理者 ${admins.length}人）`);
  } else {
    const have = new Set((group.include || []).map(r => r.email && String(r.email.email).toLowerCase()).filter(Boolean));
    const add = admins.filter(e => !have.has(e));
    if (add.length){ group = {...group, ...(await cf(`/access/groups/${group.id}`, {method: 'PUT', body: JSON.stringify({name: group.name, include: [...(group.include || []), ...add.map(e => ({email: {email: e}}))], exclude: group.exclude || [], require: group.require || []})}))}; log(`グループに管理者を追加：${add.join('、')}`); }
    else log(`グループ「${NAMES.group}」（設定済み）`);
  }

  // 4. ポリシー（再利用できるポリシー。古い仕組みのアカウントではアプリに直接付ける）
  const pol = await cf('/access/policies?per_page=100', {}, {soft: true});
  const reusable = Array.isArray(pol);
  let policy = reusable ? pol.find(p => p.name === NAMES.policy) : null;
  const polBody = {name: NAMES.policy, decision: 'allow', include: [{group: {id: group.id}}], exclude: [], require: []};
  if (reusable && !policy){ policy = await cf('/access/policies', {method: 'POST', body: JSON.stringify(polBody)}); log(`ポリシー「${NAMES.policy}」を作成`); }
  else if (reusable) log(`ポリシー「${NAMES.policy}」（設定済み）`);

  // 5. アプリ（Pages のアドレスを守る）
  const appBody = {name: NAMES.app, type: 'self_hosted', domain: domains[0], self_hosted_domains: domains, session_duration: '24h',
    allowed_idps: [idp.id], auto_redirect_to_identity: true, app_launcher_visible: false,
    ...(reusable ? {policies: [{id: policy.id, precedence: 1}]} : {})};
  let app = (await list('/access/apps')).find(a => a.name === NAMES.app);
  if (!app){ app = await cf('/access/apps', {method: 'POST', body: JSON.stringify(appBody)}); log(`Access のアプリを作成：${domains.join('・')}`); }
  else { app = {...app, ...(await cf(`/access/apps/${app.id}`, {method: 'PUT', body: JSON.stringify(appBody)}))}; log(`Access のアプリを更新：${domains.join('・')}`); }
  if (!reusable){
    const ps = dryRun && app.id === '(作成予定)' ? [] : await list(`/access/apps/${app.id}/policies`);
    if (!ps.some(p => p.name === NAMES.policy)){ await cf(`/access/apps/${app.id}/policies`, {method: 'POST', body: JSON.stringify({...polBody, precedence: 1})}); log('アプリにポリシーを追加'); }
  }

  // 6. Pages の環境変数
  const vars = {ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: app.aud, ADMIN_EMAILS: admins.join(','), CF_ACCOUNT_ID: account, CF_ACCESS_GROUP_ID: group.id};
  if (project){
    await cf(`/pages/projects/${project}`);
    const env_vars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, {type: 'plain_text', value: String(v)}]));
    if (opt.runtimeToken) env_vars.CF_API_TOKEN = {type: 'secret_text', value: opt.runtimeToken};
    await cf(`/pages/projects/${project}`, {method: 'PATCH', body: JSON.stringify({deployment_configs: {production: {env_vars}, preview: {env_vars}}})});
    log(`Pages「${project}」の環境変数を設定${opt.runtimeToken ? '（CF_API_TOKEN は秘密の値として）' : '（CF_API_TOKEN は未設定：CF_RUNTIME_TOKEN を入れて流し直すか、ダッシュボードで入れてください）'}`);
  }
  return {team, aud: app.aud, groupId: group.id, appId: app.id, domains, vars, writes, reusable};
}

// ---- コマンドとして流したとき ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const a = process.argv.slice(2), get = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; }, all = k => a.flatMap((x, i) => x === k ? String(a[i + 1] || '').split(',') : []);
  try{
    const r = await setup({token: process.env.CF_SETUP_TOKEN, runtimeToken: process.env.CF_RUNTIME_TOKEN, account: get('--account'), project: get('--project'),
      admins: all('--admin'), domains: all('--domain'), dryRun: a.includes('--dry-run')});
    console.log(`\n${a.includes('--dry-run') ? '【試し（変更していません）】予定の変更：' : '変更した所：'}\n  ${r.writes.join('\n  ') || 'なし'}`);
    console.log(`\nACCESS_TEAM_DOMAIN=${r.team}\nACCESS_AUD=${r.aud}\nCF_ACCESS_GROUP_ID=${r.groupId}\n`);
    console.log('次に：Cloudflare Pages で「デプロイを再試行」（環境変数は次のデプロイから効きます）→ 手順書の「動作確認」へ');
  }catch(e){ console.error('止まりました：' + e.message); process.exit(1); }
}
