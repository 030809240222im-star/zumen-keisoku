rules_version = '2';
// 図面計測ツール：名簿（members/<メール小文字>）にいて、メールが確認済みの人だけがアプリ本体（app）を読める。
// 名簿を足す・直す・外すのは管理者（role が admin、または持ち主）だけ。ここに無い場所は、だれも読めない・書けない。
// 持ち主のメール（__OWNER__）は tools/fbbuild.mjs が firebase/local.json から入れる（公開リポジトリに書かない）。
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null && request.auth.token.email_verified == true && request.auth.token.email is string; }
    function em() { return request.auth.token.email.lower(); }
    function isOwner() { return signedIn() && em() == '__OWNER__'; }
    function member() { return isOwner() || (signedIn() && exists(/databases/$(database)/documents/members/$(em()))); }
    function admin() { return isOwner() || (member() && get(/databases/$(database)/documents/members/$(em())).data.role == 'admin'); }
    function okMember(d) {
      return d.keys().hasOnly(['role', 'name', 'at', 'by']) && d.keys().hasAll(['role', 'at', 'by'])
        && d.role in ['admin', 'member'] && d.get('name', '') is string && d.get('name', '').size() <= 60
        && d.at is string && d.at.size() <= 40 && d.by is string && d.by.size() <= 254;
    }
    // 名簿：本人は自分の分だけ、管理者は全部読める
    match /members/{email} {
      allow get: if admin() || (signedIn() && email == em());
      allow list: if admin();
      allow create: if admin() && email == email.lower() && email.size() <= 254 && email.matches('^[^@/ ]+@[^@/ ]+[.][^@/ ]+$') && okMember(request.resource.data) && request.resource.data.by == em();
      // 持ち主と自分自身を、管理者でなくしてしまわない（締め出しを防ぐ）
      allow update: if admin() && okMember(request.resource.data) && (request.resource.data.role == 'admin' || (email != '__OWNER__' && email != em()));
      allow delete: if admin() && email != '__OWNER__' && email != em();
    }
    // アプリ本体：名簿の人だけが読める。書くのは公開の台本だけ（画面からは書けない）
    match /app/{d} {
      allow get: if member();
      match /parts/{p} { allow get: if member(); }
    }
  }
}
