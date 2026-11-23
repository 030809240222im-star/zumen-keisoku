// 図面計測ツール → dxf-takeoff 材料積算 のつなぎの試験と比較表
// 同じ壁を ① 図面計測ツールの計算 と ② 書き出した作業データを積算で開いた計算 で並べる。
// 使い方：node test/link.mjs   （部品 jsdom は dxf-takeoff の試験と同じ %LOCALAPPDATA%\dxf-takeoff、積算は ../../dxf-takeoff/app）
import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url)), ROOT=path.resolve(HERE,'..');
const DXF=process.env.DXF_TAKEOFF_ROOT || path.resolve(ROOT,'../../dxf-takeoff');
const DEPS=(process.env.DXF_TAKEOFF_DEPS||(process.env.LOCALAPPDATA||'')+'/dxf-takeoff').replace(/\\/g,'/');
const {JSDOM}=createRequire(DEPS+'/package.json')('jsdom');
let bad=0; const ok=(c,m)=>{ console.log((c?'OK  ':'NG  ')+m); if(!c) bad++; }; const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ---- ① 図面計測ツール ----
function stubs(w){
  const ctx=new Proxy({}, {get:(t,k)=> k==='measureText'? ()=>({width:10}) : k==='getImageData'||k==='createImageData'? ()=>({data:new Uint8ClampedArray(4)}) : k==='canvas'? {width:1,height:1} : (k in t? t[k] : ()=>{}), set:(t,k,v)=>{ t[k]=v; return true; }});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx; w.HTMLCanvasElement.prototype.toBlob=cb=>cb(new w.Blob([]));
  w.ResizeObserver=class{observe(){}}; w.matchMedia=()=>({matches:false, addEventListener(){}, addListener(){}});
  w.Element.prototype.scrollIntoView=()=>{}; w.indexedDB=undefined; w.fetch=()=>Promise.reject(new Error('offline'));
}
async function openZumen(){
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script src="https:[^"]+"><\/script>/g,'');
  const errs=[]; const dom=new JSDOM(html,{url:'http://127.0.0.1:5500/', runScripts:'dangerously', pretendToBeVisual:true, beforeParse(w){ stubs(w); w.addEventListener('error',e=>errs.push(e.message)); }});
  await sleep(200); return {w:dom.window, S:dom.window.__S, Z:dom.window.__zk, errs};
}
const Zm=await openZumen();
ok(Zm.S && Zm.Z, '図面計測ツールが jsdom で起動する'+(Zm.errs.length? '（エラー '+Zm.errs.slice(0,2).join(' / ')+'）' : ''));
if (!Zm.Z) process.exit(1);
const {S, Z}=Zm;
// 試験の壁（縮尺 1:1、座標は mm）
S.W=20000; S.H=20000; S.nPages=1; S.page=1; S.isPdf=false; S.name='試験図面';
S.scales[1]={mmPerUnit:1, label:'1:1'};
let id=1; const wall=(name, pts, w)=>({id:id++, page:1, kind:pts.length>2?'poly':'dist', name, pts:pts.map(([x,y])=>({x,y})), wall:{base:'start', openings:[], ...w}});
const CASES=[
  wall('W1', [[0,0],[5460,0]], {sys:'a2k', h:2700, openings:[{mark:'SD-1', s:1000, w:900, h:2000}]}),
  wall('W2', [[0,3000],[3000,3000],[3000,5000]], {sys:'s12w', h:3000, openings:[{mark:'AW-1', s:500, w:1600, h:1200, sill:900}]}),
  wall('W3', [[0,8000],[5460,8000]], {sys:'a2k', h:3200, ceil:2400, openings:[{mark:'SD-2', s:1000, w:900, h:2000}]}),
  wall('W4', [[0,12000],[4000,12000]], {sys:'hwz', h:2700}),
];
S.meas={1:CASES};
const {work, info}=Z.takeoffWork();
ok(info.walls===4 && info.noSpec===0, `壁4本を書き出す（壁片 ${info.pieces}・開口 ${info.ops}・天井高＋100 ${info.ceil}）`);
ok(info.pieces===8 && info.ops===3, '壁は開口の所で切って渡す（W1:2・W2:3・W3:2・W4:1 ＝ 8片、開口3）');
const rowsW3=work.summary.items.filter(r=>r[3]==='A-2000・WⅠ' && r[18]!=='' && r[17]===2500);
ok(rowsW3.length===2, 'W3 の壁片はボード高さ 2,500（天井高 2,400＋100）を持つ');

// ---- ② dxf-takeoff 材料積算 ----
const APP=path.join(DXF,'app','material-estimate.html');
let s=fs.readFileSync(APP,'utf8'); s=s.replace('// 起動：','window.__m={get S(){return S},compute,openFile,symSpec};\n// 起動：');
const edom=new JSDOM('<!doctype html><html><head><meta charset="utf-8"></head><body>'+s+'</body></html>',{url:'https://zairyo.test/',runScripts:'dangerously',pretendToBeVisual:true});
await sleep(150); const M=edom.window.__m;
const tmp=JSON.stringify(work);
await M.openFile({name:'試験図面_積算用作業データ.json', text:async()=>tmp});
ok(M.S.pieces.length===8 && M.S.ops.length===3, `積算で開ける（壁片 ${M.S.pieces.length}・開口 ${M.S.ops.length}）`);
ok(M.S.ops.every(o=>!o.inWall), '開口は壁片の外（開口の上の材料を積算が足す）');
for (const [sym,key] of [['A-2000・WⅠ','A2000WI'],['S12・WⅠ','S12WI'],['ハイパーウォールZ・WⅠ','HZWI']]) ok(M.symSpec(sym).mode===key, `壁種「${sym}」は積算の仕様 ${key} になる`);

// ---- 比較表 ----
const up=v=>Math.ceil(v-1e-9), f2=v=>(+v).toFixed(2);
const R=M.compute();
console.log('\n=== 比較表：同じ壁を両方で計算 ===');
console.log('壁種｜図面計測ツール（片面の壁面積・ボード枚数・スタッド本数）｜積算（片面の面積・ボード枚数・スタッド本数）');
const zk=new Map(); for (const m of CASES){ const r=Z.wallRow(m); const k=r.c.sys.name; const o=zk.get(k)||{net:0,sheets:0,studs:0}; o.net+=r.net/1e6; o.sheets+=r.sheets; o.studs+=r.c.studs.length; zk.set(k,o); }
const lines=rs=>rs.flatMap(x=>x.c.lines||[]);
for (const [k,o] of zk){ const rs=R.res.filter(x=>x.g.sym===k); const A=rs.reduce((a,x)=>a+(x.c.A||0),0), L=lines(rs);
  const sh=L.filter(t=>t.cat==='ボード'&&t.unit==='枚').reduce((a,t)=>a+t.q,0), st=L.filter(t=>t.cat==='LGS'&&/スタッド$/.test(t.name)).reduce((a,t)=>a+t.q,0);
  console.log(`  ${k}｜${f2(o.net)} m²・${o.sheets} 枚・${o.studs} 本｜${f2(A)} m²・${f2(sh)} 枚・${f2(st)} 本（グループ ${rs.length}）`);
  ok(Math.abs(A-o.net)<0.01, `  ${k}：片面の面積が両方で同じ（${f2(o.net)} m²）`); }
console.log('--- 積算の材料（LGS・ボード）---');
for (const t of R.T) if (t.cat==='LGS'||t.cat==='ボード') console.log(`  ${t.cat}｜${t.name}｜${t.spec}｜${up(t.q)} ${t.unit}`);
const zSheets=[...zk.values()].reduce((a,o)=>a+o.sheets,0), eSheets=R.T.filter(t=>t.cat==='ボード'&&t.unit==='枚').reduce((a,t)=>a+up(t.q),0);
console.log(`合計 ボード枚数：図面計測ツール ${zSheets} 枚 ／ 積算 ${eSheets} 枚（積算のボード倍率 ${M.S.cfg.bbai}）`);
ok(eSheets>0, '積算でボードの枚数が出る');

// ---- C：天井高＋100 の前と後（W3）----
const w3=CASES[2]; const a=Z.wallRow(w3); const ceil=w3.wall.ceil; delete w3.wall.ceil; const b=Z.wallRow(w3); w3.wall.ceil=ceil;
console.log(`\n=== W3（A-2000・WⅠ、H 3,200、天井高 2,400）===\n  ボードを H まで：片面 ${f2(b.net/1e6)} m²・ボード ${b.sheets} 枚\n  天井高＋100   ：片面 ${f2(a.net/1e6)} m²・ボード ${a.sheets} 枚`);
ok(a.net<b.net && a.c.studs.length===b.c.studs.length, '天井高＋100 にするとボードは減り、スタッドの本数は変わらない');
ok(Z.wallRow(CASES[0]).c.Hb===2700, '天井高を入れていない壁は今までどおり（ボードも H まで）');

// ---- 画面：壁の設定欄・一括設定 ----
const d=Zm.w.document; Zm.errs.length=0;
S.sel=w3.id; Z.refreshProps(); await sleep(30);
const seg=d.querySelector('#pCeilSeg');
ok(seg && seg.querySelector('button.on').dataset.v==='1' && d.querySelector('#pCeil').value==='2400', '壁の設定欄に「ボードの高さ：H まで｜天井高＋100」と天井高が出る');
seg.querySelector('[data-v="0"]').click(); await sleep(40);
ok(!('ceil' in w3.wall), '「H まで」を押すと天井高が外れる');
d.querySelector('#pCeilSeg [data-v="1"]').click(); await sleep(40);
ok(+w3.wall.ceil>0, '「天井高＋100」を押すと天井高が入る（'+w3.wall.ceil+'）'); w3.wall.ceil=2400;
Z.openWallBatch({ids:[CASES[3].id]}); await sleep(30);
ok(d.querySelector('#wbCeil') && d.querySelector('#wbTk'), '一括設定に「天井高」と「積算へ書き出し」がある');
d.querySelector('#wbCeil').value='2500'; d.querySelector('#wbApply').click(); await sleep(30);
ok(CASES[3].wall.ceil===2500 && Z.wallRow(CASES[3]).c.Hb===2600, '一括設定で天井高を入れると、ボード高さが天井高＋100 になる');
ok(!Zm.errs.length, '画面の操作でエラーが出ない'+(Zm.errs.length? '（'+Zm.errs[0]+'）':''));

console.log(bad? `\n${bad}件 不合格` : '\nすべて合格');
process.exit(bad?1:0);
