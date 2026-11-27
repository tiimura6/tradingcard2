// GAS連携の通しテスト（Code.gs をモックのスプレッドシートで動かす）
// 実行: NODE_PATH=$(npm root -g) node tests/gas-e2e.js（手元の Chrome を使うときは CHROME_PATH=/usr/bin/google-chrome）
// 8765 番でファイルを配る小さなサーバーをテスト自身が立てる（すでに python3 -m http.server 8765 が動いていればそれを使う）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeEnv } = require('./gas-mock.js');

function startServer() {
  const ROOT = path.resolve(__dirname, '..');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => { srv.once('error', () => r(null)); srv.listen(8765, () => r(srv)); });   // 使用中なら既存のサーバーを使う
}

const FAKE = 'https://script.google.com/macros/s/FAKE/exec';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/const GAS_URL = '[^']*';/, `const GAS_URL = '${FAKE}';`);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) failed++; };

async function newDevice(b, gas, name) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(() => { window.confetti = () => {}; window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = () => true;
    if (!localStorage.getItem('tutorialDone')) localStorage.setItem('tutorialDone', 'test');   // 遊び方の案内は regression.js で確認
    // 物語の場面は画面をふさぐので、読んだことにしておく（物語は regression.js で確認）
    if (!localStorage.getItem('storySeen')) localStorage.setItem('storySeen', JSON.stringify(Object.fromEntries(['prologue','end_A1','start_A2','end_A2','start_B1','end_B1','start_B2','end_B2','start_PT','end_PT','hof'].map(k => [k, 1])))); });
  await c.route('**/index.html*', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await c.route(FAKE + '**', async r => {
    const req = r.request();
    let out;
    if (req.method() === 'POST') out = gas.doPost({ postData: { contents: req.postData() } }).getContent();
    else { const u = new URL(req.url()); out = gas.doGet({ parameter: Object.fromEntries(u.searchParams) }).getContent(); }
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
  });
  const p = await c.newPage(); p.__errs = []; p.on('pageerror', e => p.__errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2500);
  return { c, p };
}

(async () => {
  // ---------- サーバー単体：効果検証レポート ----------
  console.log('効果検証レポート（Code.gs）');
  {
    const env = makeEnv(); const { ctx: gas, sheets } = env; gas.setup();
    const D = (d, h) => new Date(Date.UTC(2026, 10, d, h || 1));   // 2026-11-d 日本時間 10時
    const L = [];
    const ev = (user, day, card, ok, rt, opt = {}) => L.push([D(day), user, opt.kind || '会員', 's', opt.ev || 'training', card, 'w' + card, '', '', ok ? '正解' : '不正解', rt, 1, 0, '鉄', opt.diff === undefined ? '' : opt.diff]);
    // u1：カード1〜4。初回は1,2が不正解 → 翌日と8日後に再挑戦して正解。回答時間が短くなる
    ev('u1', 2, 1, false, 9); ev('u1', 2, 2, false, 8); ev('u1', 2, 3, true, 6); ev('u1', 2, 4, true, 6);
    ev('u1', 3, 1, true, 5); ev('u1', 3, 2, false, 7); ev('u1', 3, 3, true, 3); ev('u1', 3, 4, true, 4);
    ev('u1', 10, 1, true, 3); ev('u1', 10, 2, true, 4);
    // u2：同じ日にしか答えていない（再挑戦にならない）＋ ゲストの回答と回答でないイベントは数えない
    ev('u2', 4, 1, false, 9); ev('u2', 4, 1, true, 4);
    ev('g1', 4, 1, true, 3, { kind: 'ゲスト' }); L.push([D(4), 'u2', '会員', 's', 'unlock', 5, 'w5', '', '', '-', '', 1, 0, '鉄', '']);
    // 文法とバトルの苦手度
    ev('u1', 4, 'g-a1-01', false, 10, { ev: 'grammar' }); ev('u1', 6, 'g-a1-01', true, 8, { ev: 'grammar' });
    ev('u1', 5, 7, true, 5, { ev: 'battle', diff: 2 }); ev('u1', 5, 8, false, 5, { ev: 'battle', diff: 2 }); ev('u1', 5, 9, true, 5, { ev: 'battle', diff: 0 });
    sheets['学習ログ'].getRange(2, 1, L.length, 15).setValues(L);
    const r = gas.buildEffectReport();
    const out = sheets['効果検証'].data.map(x => x.map(v => v === undefined ? '' : v));
    const find = t => out.find(x => String(x[0]).startsWith(t)) || [];
    check(r.users === 2 && r.answers === 17, `会員の回答だけを数える（${r.users}人・${r.answers}件）`);
    check(find('初回の回答')[1] === 9 && find('翌日以降の最初の再挑戦')[1] === 5 && find('翌日以降の最初の再挑戦')[2] === 80, '単語ごとの初回と翌日以降の再挑戦 ' + JSON.stringify([find('初回の回答'), find('翌日以降の最初の再挑戦')]));
    check(find('初回不正解 → 翌日以降に正解')[1] === 3 && find('初回不正解 → 翌日以降に正解')[2] === 66.7 && find('初回不正解 → 7日以降に正解')[2] === 100, '克服率（翌日以降・7日以降） ' + JSON.stringify([find('初回不正解 → 翌日以降'), find('初回不正解 → 7日以降')]));
    check(String(find('回答時間の中央値')[2]) === '6 → 3.5', '正解した単語の回答時間が短くなったか ' + find('回答時間の中央値')[2]);
    check(find('（文法問題のみ）初回不正解')[2] === 100 && find('苦手度2')[1] === 2 && find('苦手度2')[2] === 50, '文法問題とバトルの苦手度ごとの集計');
    check(out.some(x => String(x[0]).includes('7日以上あとの再挑戦で正解できた割合は 100%')) && find('2026-11-02')[1] === 2, '要約の文・週ごとの推移');
    gas.installEffectReportTrigger();
    check(env.triggers.filter(t => t.fn === 'dailyEffectReport').length === 1, '毎朝の自動更新を設定できる');
  }

  // ---------- サーバー単体：教養の手帖（時の回廊・世界史） ----------
  console.log('教養の手帖（Code.gs）');
  {
    const env = makeEnv(); const { ctx: gas, sheets } = env; gas.setup();
    const call = o => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
    const H = sheets['取り組み状況'].data[0];
    check(H.length === 30 && H[28] === '要確認' && H[29] === '時の回廊（枚）', '取り組み状況：既存の列はそのまま、末尾に「時の回廊（枚）」' + JSON.stringify(H.slice(23)));
    const HL = sheets['学習ログ'].data[0];
    check(HL.length === 17 && HL[13] === '手帖' && HL[14] === '苦手度' && HL[15] === '確認問題の段階' && HL[16] === '確認問題の点数', '学習ログ：既存の15列はそのまま、末尾に確認問題の段階・点数' + JSON.stringify(HL.slice(13)));
    // wh-N は存在するカード。wh-101 は存在しない
    const sm = gas.summarize_({ unlockedCards: JSON.stringify(['a1-1', 'wh-1', 'wh-100', 'wh-101']) });
    check(sm.badIds === 1 && sm.nbCounts.length === 6 && sm.nbCounts[5] === 3 && sm.nbCounts[0] === 1, `wh-1〜wh-100 は正しいカード（badIds ${sm.badIds}・nbCounts ${JSON.stringify(sm.nbCounts)}）`);
    // wh-1 を持った生徒の保存 → 不正の見える化で問題なし、時の回廊の列に1枚
    call({ action: 'register', loginId: 'whu', nickname: 'せかい', password: 'secret123' });
    const tk = call({ action: 'login', loginId: 'whu', password: 'secret123' }).token;
    call({ action: 'saveProgress', token: tk, rev: 0, data: { unlockedCards: JSON.stringify(['a1-1', 'a1-2', 'wh-1']), notebookState: JSON.stringify({ current: 'WH' }) } });
    let st = sheets['取り組み状況'].data.find(r => r[0] === 'whu') || [];
    check(!String(st[28] || '').includes('存在しないカード'), '不正の見える化：wh-1 を存在しないカードと数えない（要確認「' + (st[28] || '') + '」）');
    check(JSON.stringify(st.slice(23, 28)) === '[2,0,0,0,0]' && st[29] === 1 && st[22] === '時の回廊（世界史）', '手帖ごとの枚数：鉄〜白金の列は今まで通り・時の回廊の1枚は末尾の列 ' + JSON.stringify([st[22], st.slice(23, 30)]));
    check(st[12] === 2, '獲得カード（収集率の分子）は全手帖コンプリートの8,324枚に入る手帖だけを数える（' + st[12] + '）');
    // 全カード＋時の回廊100枚でも「上限超え」にならない
    call({ action: 'register', loginId: 'whall', nickname: 'ぜんぶ', password: 'secret123' });
    const ta = call({ action: 'login', loginId: 'whall', password: 'secret123' }).token;
    const all = [['a1-', 1067], ['a2-', 1352], ['b1-', 2353], ['b2-', 2689], ['card-', 863], ['wh-', 100]].reduce((a, [p, n]) => a.concat(Array.from({ length: n }, (_, i) => p + (i + 1))), []);
    call({ action: 'saveProgress', token: ta, rev: 0, data: { unlockedCards: JSON.stringify(all) } });
    st = sheets['取り組み状況'].data.find(r => r[0] === 'whall') || [];
    check(!String(st[28] || '').includes('上限超え') && !String(st[28] || '').includes('存在しない') && st[12] === 8324 && st[29] === 100, '全8,324枚＋時の回廊100枚：上限超えにならない（要確認「' + (st[28] || '') + '」）');
    // 確認問題のログ：nb（確認した手帖）・段階・点数を残す（ev.notebook は開いていた手帖なので使わない）
    call({ action: 'register', loginId: 'whv', nickname: 'れきし', password: 'secret123' });
    const tv = call({ action: 'login', loginId: 'whv', password: 'secret123' }).token;
    const now = Date.now(), DAY = 86400000;
    const kc = (ago, phase, score, extra = {}) => Object.assign({ timestamp: now - ago * DAY, eventType: 'kyoyo_check', notebook: 'B1', isCorrect: null, nb: 'WH', phase, score }, extra);
    call({ action: 'log', token: tk, sessionId: 's', events: [kc(20, 'pre', 4), kc(2, 'post', 9)] });
    call({ action: 'log', token: tv, sessionId: 's', events: [kc(15, 'pre', 6), kc(1, 'post', 7), { timestamp: now, eventType: 'training', cardNo: 1, word: 'w1', isCorrect: true, notebook: 'A1' }]});
    call({ action: 'log', token: ta, sessionId: 's', events: [kc(3, 'pre', 5)] });                 // 学習前だけ
    call({ action: 'log', guestId: 'g9', sessionId: 's', events: [kc(3, 'pre', 1)] });            // ゲストはレポートに入れない
    call({ action: 'log', token: ta, sessionId: 's', events: [kc(3, 'later', 'abc', { nb: 'ZZ' })] });   // おかしな値は空欄
    const LG = sheets['学習ログ'].data.slice(1).filter(r => r[4] === 'kyoyo_check');
    const r1 = LG.find(r => r[1] === 'whu' && r[16] === 4) || [];
    check(r1[13] === '時の回廊（世界史）' && r1[15] === '学習前' && r1[16] === 4, '学習ログに確認問題の手帖・段階・点数を記録 ' + JSON.stringify(r1.slice(13)));
    const bad = LG.find(r => r[1] === 'whall' && r[15] !== '学習前') || [];
    check(bad[15] === '' && bad[16] === '' && bad[13] === '銀', 'おかしな段階・点数・手帖は記録しない ' + JSON.stringify(bad.slice(13)));
    const rep = gas.buildEffectReport();
    const out = sheets['効果検証'].data.map(x => x.map(v => v === undefined ? '' : v));
    const find = t => out.find(x => String(x[0]).startsWith(t)) || [];
    check(rep.answers === 1, '確認問題は回答数（4択の単語の回答）に入れない（' + rep.answers + '件）');
    check(!!find('■ 6. 教養の手帖の確認問題')[0], 'レポートに確認問題の節がある');
    check(find('時の回廊（世界史）・学習前')[1] === 3 && find('時の回廊（世界史）・学習前')[2] === 5, '学習前：人数3（ゲストは除く）・平均5点 ' + JSON.stringify(find('時の回廊（世界史）・学習前')));
    check(find('時の回廊（世界史）・学習後')[1] === 2 && find('時の回廊（世界史）・学習後')[2] === 8, '学習後：人数2・平均8点 ' + JSON.stringify(find('時の回廊（世界史）・学習後')));
    const pr = find('時の回廊（世界史）・両方を受けた生徒');
    check(pr[1] === 2 && pr[2] === 5 && pr[3] === 8 && pr[4] === 3, '学習前と後の両方を受けた生徒：2人・5点→8点・伸び3点 ' + JSON.stringify(pr));
    const pu = out.find(x => x[0] === 'whu' && x[1] === '時の回廊（世界史）') || [];
    check(pu[2] === 4 && pu[3] === 9 && pu[4] === 5, '生徒ごとの学習前・学習後 ' + JSON.stringify(pu));
    check(out.some(x => String(x[0]).includes('学習前と学習後の両方を受けた 2人の平均点は 5点 → 8点')), '要約に確認問題の文');
  }

  // ---------- サーバー単体：学習ログは新しいものが上・古いログは保管ファイルへ ----------
  console.log('学習ログの並び順と保管（Code.gs）');
  {
    const env = makeEnv(); const { ctx: gas, sheets, files, props } = env; gas.setup();
    const call = o => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
    call({ action: 'register', loginId: 'logu', nickname: 'ろぐ', password: 'secret123' });
    call({ action: 'register', loginId: 'logv', nickname: 'ろぐ2', password: 'secret123' });
    const tk = call({ action: 'login', loginId: 'logu', password: 'secret123' }).token;
    const tv = call({ action: 'login', loginId: 'logv', password: 'secret123' }).token;
    const now = Date.now(), DAY = 86400000;
    const e = (ago, card, ok = true) => ({ timestamp: now - ago * DAY, eventType: 'training', cardNo: card, word: 'w' + card, isCorrect: ok });
    call({ action: 'log', token: tk, sessionId: 's', events: [e(200, 1), e(120, 2), e(100, 3, false)] });   // 古い3件（1回で送ると古い順のことがある）
    call({ action: 'log', token: tv, sessionId: 's', events: [e(150, 9)] });
    call({ action: 'log', token: tk, sessionId: 's', events: [e(10, 4), e(1, 5)] });
    const L = sheets['学習ログ'];
    const times = () => L.data.slice(1, L.getLastRow()).map(r => r[0].getTime());
    const t0 = times();
    // 届いた順に上へ積む（最後に届いた送信が一番上）。1回の送信の中は新しい順
    check(JSON.stringify(t0.map(t => Math.round((now - t) / DAY))) === '[1,10,150,100,120,200]' && L.data[0][0] === 'タイムスタンプ', '新しく届いたものが上・1回の送信の中は新しい順（見出しは1行目のまま）' + JSON.stringify(t0.map(t => Math.round((now - t) / DAY))));
    // 既存の古い順のシートは setup で新しい順に並べ替える
    L.data.splice(1, 6, ...L.data.slice(1, 7).reverse()); gas.setup();
    const t1 = times();
    check(t1.every((t, i) => i === 0 || t1[i - 1] >= t), 'setup で既存のログを新しい順に並べ替える');
    // 90日より前は保管ファイルへ
    const moved = gas.archiveOldLogs();
    const arch = files[props.LOG_ARCHIVE_ID];
    const archRows = arch ? arch.getSheets().filter(sh => /^\d{4}-\d{2}$/.test(sh.getName())).reduce((a, sh) => a + sh.getLastRow() - 1, 0) : 0;
    check(moved === 4 && L.getLastRow() === 3 && archRows === 4 && !arch.getSheetByName('シート1'), `古い4行を保管ファイルへ移し、学習ログには新しい2行だけ（移動 ${moved} / 残り ${L.getLastRow() - 1} / 保管 ${archRows}）`);
    check(gas.archiveOldLogs() === 0, 'もう一度実行しても何も起きない');
    // 効果検証レポートは保管分も数える
    const rep = gas.buildEffectReport();
    check(rep.answers === 6, '効果検証レポートは保管ファイルの分も読む（回答 ' + rep.answers + '件）');
    // 生徒データの削除は保管ファイルからも消す
    gas.deleteUserData_('logu');
    const left = arch.getSheets().filter(sh => /^\d{4}-\d{2}$/.test(sh.getName())).reduce((a, sh) => a.concat(sh.data.slice(1, sh.getLastRow()).map(r => r[1])), []);
    check(left.length === 1 && left[0] === 'logv' && L.getLastRow() === 1, '生徒データの削除は保管ファイルの行も消す ' + JSON.stringify(left));
    gas.installLogArchiveTrigger();
    check(env.triggers.filter(t => t.fn === 'dailyLogArchive').length === 1, '毎日の自動移動を設定できる');
  }

  // ---------- サーバー単体：レイドボス ----------
  console.log('レイドボス（Code.gs）');
  {
    const env = makeEnv(); const { ctx: gas, sheets, cache, props } = env; gas.setup();
    let fake = new Date('2026-11-04T03:00:00Z').getTime();   // 水曜（日本時間 12時）
    const RealDate = Date;
    gas.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(fake); } static now() { return fake; } };
    const call = o => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
    call({ action: 'register', loginId: 'raid01', nickname: 'りゅう', password: 'secret123' });
    call({ action: 'register', loginId: 'raid02', nickname: 'かくれ', password: 'secret123' });
    const t1 = call({ action: 'login', loginId: 'raid01', password: 'secret123' }).token;
    const t2 = call({ action: 'login', loginId: 'raid02', password: 'secret123' }).token;
    props.RAID_HP = '2500';
    let st = call({ action: 'raidStatus' });
    check(st.ok && st.week === '2026-11-02' && st.hp === 2500 && st.dmg === 0 && st.me === null && st.boss && st.boss.name, `週は月曜で区切る・ボスとHP（${st.week} ${st.boss && st.boss.name}）`);
    check(call({ action: 'raidHit', points: 100 }).error === 'auth', 'ログインしていないと挑めない');
    check(call({ action: 'raidHit', token: t1, points: 99999 }).error === 'invalid', '1回の上限を超える点数は受け付けない');
    st = call({ action: 'raidHit', token: t1, points: 900 });
    check(st.ok && st.dmg === 900 && st.me.dmg === 900 && st.me.hitsToday === 1, '与えたダメージが合算される');
    call({ action: 'raidHit', token: t1, points: 500 }); call({ action: 'raidHit', token: t1, points: 500 });
    check(call({ action: 'raidHit', token: t1, points: 500 }).error === 'limit', '1日3回まで');
    check(call({ action: 'raidClaim', token: t1 }).error === 'not_defeated', '倒すまでは報酬を受け取れない');
    call({ action: 'setPrefs', token: t2, hideRanking: true });
    st = call({ action: 'raidHit', token: t2, points: 700 });
    check(st.defeated && st.dmg === 2500 && st.top.length === 1 && st.top[0].name === 'りゅう' && st.top[0].dmg === 1900, '合計がHPに届くと撃破・「ランキングに載せない」人は上位に出ない');
    const c1 = call({ action: 'raidClaim', token: t1 });
    check(c1.ok && c1.reward === 2000 && call({ action: 'raidClaim', token: t1 }).error === 'claimed', '撃破後、参加者は1回だけ報酬を受け取れる');
    fake += 86400000; Object.keys(cache).forEach(k => delete cache[k]);
    st = call({ action: 'raidStatus', token: t1 });
    check(st.me.hitsToday === 0 && st.me.dmg === 1900, '次の日は挑戦回数が戻る（ダメージは週の間残る）');
    fake += 6 * 86400000; Object.keys(cache).forEach(k => delete cache[k]);
    st = call({ action: 'raidStatus', token: t1 });
    check(st.week === '2026-11-09' && st.dmg === 0 && st.me.dmg === 0 && !st.defeated, '翌週は新しいボス（ダメージ0から）');
    gas.deleteUserData_('raid01');
    check(!sheets['レイド'].data.slice(1).some(r => String(r[2]) === 'raid01'), '生徒データの削除でレイドの記録も消える');
  }

  // ---------- サーバー単体：セキュリティ ----------
  console.log('サーバー（Code.gs）');
  {
    const env0 = makeEnv(); const { ctx: gas, sheets, cache, props } = env0; gas.setup();
    // バックアップの時刻をずらすための仕掛け（同じ分に何回も取るとシート名が重なるため）
    let fake = new Date('2026-11-01T00:00:00Z').getTime();
    const RealDate = Date;
    env0.bump = () => { fake += 7 * 86400000; };
    gas.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(fake); } static now() { return fake; } };
    const call = o => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
    check(call({ action: 'register', loginId: 'aaa', nickname: 'a', password: '12345678' }).error === 'invalid_password', '数字だけのパスワードは登録できない');
    check(call({ action: 'register', loginId: 'aaa', nickname: 'a', password: 'abc12' }).error === 'invalid_password', '8文字未満のパスワードは登録できない');
    const r = call({ action: 'register', loginId: 'aaa', nickname: '  =HYPERLINK("x")', password: 'secret123' });
    const r0 = call({ action: 'register', loginId: 'bbb', nickname: '＝1+1', password: 'secret123' });
    check(r.ok, '英字と数字を含む8文字以上で登録できる');
    const u = sheets['ユーザー'].data[1], u2 = sheets['ユーザー'].data[2];
    check(String(u[1]).startsWith('HYPERLINK') && u2[1] === '1+1', `先頭の空白・全角でも数式の記号を除去（${u[1]} / ${u2[1]}）`);
    check(u[2] === '' && u[3] === '' && String(u[4]).startsWith('v2$') && !String(u[4]).includes('secret'), '氏名・クラスは保存しない・パスワードは繰り返しハッシュで保存');
    check(call({ action: 'login', loginId: 'aaa', password: 'secret123' }).ok, '正しいパスワードでログインできる');
    // 段階的なロック
    let last;
    for (let i = 0; i < 5; i++) last = call({ action: 'login', loginId: 'aaa', password: 'wrong999' });
    check(last.error === 'locked' && last.minutes === 10, '5回続けて間違えると10分ロック');
    sheets['ユーザー'].data[1][9] = '';   // ロック時間が過ぎたことにする
    Object.keys(cache).forEach(k => delete cache[k]);
    for (let i = 0; i < 5; i++) last = call({ action: 'login', loginId: 'aaa', password: 'wrong999' });
    check(last.error === 'locked' && last.minutes === 60, '2回目のロックは1時間');
    sheets['ユーザー'].data[1][9] = '';
    Object.keys(cache).forEach(k => delete cache[k]);
    check(call({ action: 'login', loginId: 'aaa', password: 'secret123' }).ok, 'ロック明けは正しいパスワードで入れる（失敗回数はリセット）');
    // 送信回数の制限
    Object.keys(cache).forEach(k => delete cache[k]);
    let limited = false;
    for (let i = 0; i < 12; i++) { const x = call({ action: 'login', loginId: 'aaa', password: 'secret123' }); if (x.error === 'rate_limited') limited = true; }
    check(limited, '1つのIDへのログインは1分に10回まで');
    const ev = n => Array.from({ length: n }, () => ({ timestamp: Date.now(), eventType: 'training', cardNo: 1, word: 'x', isCorrect: true }));
    let gl = 0; for (let i = 0; i < 5; i++) if (call({ action: 'log', guestId: 'g1', sessionId: 's', events: ev(100) }).error === 'rate_limited') gl++;
    check(gl >= 1, 'ゲストのログは1人10分に400件まで');
    let rg = 0; for (let i = 0; i < 25; i++) if (call({ action: 'register', loginId: 'u' + i + 'x', nickname: 'n' + i, password: 'abcd1234' }).error === 'rate_limited') rg++;
    check(rg >= 5, '新規登録は全体で10分に20件まで');
    // 旧PIN形式のアカウントも入れて、新形式へ切り替わる
    Object.keys(cache).forEach(k => delete cache[k]);
    const salt = 'oldsalt';
    sheets['ユーザー'].data.push(['oldpin', '旧', '', '', gas.hash_(salt + '1234'), salt, new Date(), new Date(), 0, '', '']);
    check(call({ action: 'login', loginId: 'oldpin', password: '1234' }).ok, '旧形式（PIN）のアカウントもログインできる');
    check(String(sheets['ユーザー'].data.slice(-1)[0][4]).startsWith('v2$'), 'ログイン時に新しいハッシュ形式へ切り替わる');
    // 管理者キー
    Object.keys(cache).forEach(k => delete cache[k]);
    const tok = call({ action: 'login', loginId: 'aaa', password: 'secret123' }).token;
    check(call({ action: 'adminUnlock', token: tok, key: 'TEACHERKEY01' }).error === 'bad_key', '管理者キー未設定なら使えない');
    const s2 = 'adm'; props.ADMIN_KEY_SALT = s2; props.ADMIN_KEY_HASH = gas.passHash_(s2, 'TEACHERKEY01');
    check(call({ action: 'adminUnlock', token: tok, key: 'TEACHERKEY01' }).error === 'bad_key', '管理者の印がないアカウントは正しいキーでも使えない');
    sheets['ユーザー'].data[1][10] = '○';
    check(call({ action: 'adminUnlock', token: tok, key: 'WRONGKEY000' }).error === 'bad_key', '違うキーは使えない');
    check(call({ action: 'adminUnlock', token: tok, key: 'teacherkey01' }).ok, '管理者の印＋正しいキーで使える');
    check(call({ action: 'adminUnlock', key: 'TEACHERKEY01' }).error === 'auth', 'ログインしていないと使えない');
    // 不正の検出
    Object.keys(cache).forEach(k => delete cache[k]);
    const t2 = call({ action: 'register', loginId: 'cheat', nickname: 'ずる', password: 'abcd1234' });
    const ids = Array.from({ length: 300 }, (_, i) => 'a1-' + (i + 1)).concat(['a1-99999', 'zz-1']);
    call({ action: 'saveProgress', token: t2.token || call({ action: 'login', loginId: 'cheat', password: 'abcd1234' }).token, rev: 0,
      data: { unlockedCards: JSON.stringify(ids), gold: '5000000' } });
    const st = sheets['取り組み状況'].data.find(rw => rw[0] === 'cheat') || [];
    const flag = String(st[28] || '');
    check(/存在しないカード2枚/.test(flag) && /ゴールド/.test(flag), `要確認に不正の疑いを記録（${flag}）`);
    // ランキングに載せない
    Object.keys(cache).forEach(k => delete cache[k]);
    const tA = call({ action: 'login', loginId: 'aaa', password: 'secret123' }).token;
    sheets['殿堂入り'].data.push([new gas.Date(), 'aaa', 'a', '白金の手帖']);
    check(JSON.parse(gas.doGet({ parameter: { action: 'hofRanking' } }).getContent()).ranking.length === 1, '殿堂入りはランキングに出る');
    check(call({ action: 'setPrefs', token: tA, hideRanking: true }).ok, '「ランキングに載せない」を保存できる');
    check(JSON.parse(gas.doGet({ parameter: { action: 'hofRanking' } }).getContent()).ranking.length === 0, '載せない設定の生徒はランキングから消える');
    check(call({ action: 'login', loginId: 'aaa', password: 'secret123' }).hideRanking === true, 'ログインすると設定が返る');
    // クラス別集計
    check(String((sheets['クラス別集計'].data[1] || [])[0]).includes('UNIQUE'), 'クラス別集計シートに集計式が入る');
    // バックアップ（5回取ると4回分だけ残る）
    const { files, triggers } = env0;
    for (let i = 0; i < 5; i++) { gas.backupNow(true); env0.bump(); }
    const bk = files[props.BACKUP_ID];
    const stamps = new Set(bk.getSheets().map(x => x.getName().split('_').slice(0, 2).join('_')));
    const copied = bk.getSheets().find(x => /_ユーザー$/.test(x.getName()));
    check(stamps.size === 4 && copied && copied.data.length === sheets['ユーザー'].data.length, `バックアップは別ファイルに4回分（${stamps.size}回分）`);
    gas.installWeeklyBackup(); gas.installWeeklyBackup();
    check(triggers.length === 1 && triggers[0].getHandlerFunction() === 'weeklyBackup', '毎週のバックアップのトリガーは1つだけ');
    // 問い合わせ
    Object.keys(cache).forEach(k => delete cache[k]);
    check(call({ action: 'contact', type: '不具合の報告', message: 'カードが表示されません', email: 'a@example.com', clientId: 'c1' }).ok, '問い合わせを受け付ける');
    const ct = sheets['問い合わせ'].data[1] || [];
    check(ct[1] === '不具合の報告' && ct[2] === 'カードが表示されません' && ct[6] === '未対応', '「問い合わせ」シートに記録（対応状況＝未対応）');
    check(call({ action: 'contact', message: 'abc' }).error === 'contact_short', '短すぎる問い合わせははじく');
    check(call({ action: 'contact', message: 'こんにちは、質問です', email: 'bad@' }).error === 'contact_email', '形の正しくないメールアドレスははじく');
    const nBefore = sheets['問い合わせ'].data.length;
    check(call({ action: 'contact', message: '自動投稿のスパムです', website: 'http://spam' }).ok && sheets['問い合わせ'].data.length === nBefore, '見えない欄が埋まった自動投稿は記録しない');
    let cl = 0; for (let i = 0; i < 4; i++) if (call({ action: 'contact', message: '連続で送る問い合わせ', clientId: 'c2' }).error === 'rate_limited') cl++;
    check(cl === 1, '同じ端末からの問い合わせは10分に3件まで');
    call({ action: 'contact', message: '=HYPERLINK("http://x")だよ', clientId: 'c3' });
    check(!String(sheets['問い合わせ'].data.slice(-1)[0][2]).startsWith('='), '問い合わせの内容も数式として書き込まれない');
    // データ削除
    const before = sheets['学習ログ'].data.filter(r => r[1] === 'cheat').length;
    call({ action: 'log', token: call({ action: 'login', loginId: 'cheat', password: 'abcd1234' }).token, sessionId: 's', events: ev(3) });
    const n = gas.deleteUserData_('cheat');
    const left = ['ユーザー', 'セッション', '進捗データ', '取り組み状況', '学習ログ', '日別集計'].map(k => sheets[k].data.filter(r => r.includes('cheat')).length).reduce((a, b) => a + b, 0);
    check(n > 0 && left === 0 && sheets['ユーザー'].data.some(r => r[0] === 'aaa'), `生徒のデータ削除：その生徒の行だけすべて消える（${n}行）`);
  }

  // ---------- アプリと通し ----------
  console.log('アプリと通し');
  const { ctx: gas, sheets, props } = makeEnv(); gas.setup();
  const srv = await startServer();
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const sheetRows = n => sheets[n].data.filter((r, i) => i > 0 && r.some(x => x !== ''));
  const A = await newDevice(b, gas, 'A');
  check(await A.p.evaluate(() => getComputedStyle(document.getElementById('auth-overlay')).display) === 'flex', '起動時にログイン画面が出る');
  await A.p.evaluate(() => Cloud.openModal('register')); await A.p.waitForTimeout(300);
  check(await A.p.evaluate(() => !document.getElementById('regName') && !document.getElementById('regClass') && !document.querySelector('#authBody .auth-note, #authBody .auth-sub, #authBody small') && document.getElementById('regPin').getAttribute('inputmode') !== 'numeric'), '登録画面に氏名・クラス欄も説明文もなく、パスワードは英数字で入力');
  await A.p.fill('#regId', 'taro01'); await A.p.fill('#regNick', 'たろう');
  await A.p.fill('#regPin', '12345678'); await A.p.fill('#regPin2', '12345678');
  await A.p.click('button:has-text("登録して始める")'); await A.p.waitForTimeout(800);
  check((await A.p.evaluate(() => document.getElementById('authError').innerText)).includes('英字と数字'), '数字だけのパスワードは画面でもはじく');
  await A.p.fill('#regPin', 'kotoba2026'); await A.p.fill('#regPin2', 'kotoba2026');
  await A.p.click('button:has-text("登録して始める")'); await A.p.waitForTimeout(2500);
  // 学習
  await A.p.evaluate(() => { gold = 500; saveGold(); drawMulti('normal'); closeMultiDraw(); });
  await A.p.waitForTimeout(800);
  await A.p.evaluate(() => enterAdventureMode()); await A.p.waitForTimeout(2000);
  await A.p.evaluate(() => { closeTrainingModal(false); openTrainingMode(); });
  for (let i = 0; i < 3; i++) {
    await A.p.waitForTimeout(400);
    await A.p.evaluate(() => { trainingSession.qCount = 0; const x = document.querySelector('.quiz-choice-btn[data-correct]'); x && x.click(); });
    await A.p.waitForTimeout(1400);
    await A.p.evaluate(() => { const bs = [...document.querySelectorAll('#quizChoices .action-btn')]; bs.length && bs[bs.length - 1].click(); });
  }
  await A.p.evaluate(() => Cloud.saveNow({ force: true })); await A.p.waitForTimeout(1500);
  await A.p.waitForTimeout(16000);   // ログの送信（15秒ごと）
  const aOwned = await A.p.evaluate(() => unlockedCards.slice().sort());
  const st = sheetRows('取り組み状況')[0] || [];
  check(st[0] === 'taro01' && !st[2] && st[12] === aOwned.length, `取り組み状況に記録（氏名は空・カード${st[12]}枚）`);
  check(sheetRows('学習ログ').length >= 3 && sheetRows('学習ログ').slice(-1)[0][13] === '鉄', '学習ログに手帖つきで記録');
  // ゴールドのクーポンは廃止
  await A.p.evaluate(() => { window.__alerts = []; const g = gold; openCouponModal(); document.getElementById('couponInput').value = 'MAGIC5'; submitCoupon(); window.__g = gold - g; });
  check(await A.p.evaluate(() => window.__g === 0 && window.__alerts.join('').includes('無効')), 'ゴールドのクーポン（MAGIC5）は使えない');
  // 管理者キー（アプリから）
  const s2 = 'adm'; props.ADMIN_KEY_SALT = s2; props.ADMIN_KEY_HASH = gas.passHash_(s2, 'TEACHERKEY01');
  await A.p.evaluate(() => { window.__alerts = []; openCouponModal(); document.getElementById('couponInput').value = 'TEACHERKEY01'; submitCoupon(); });
  await A.p.waitForTimeout(800);
  check((await A.p.evaluate(() => window.__alerts.join('|'))).includes('無効な鍵'), '管理者の印がなければアプリから鍵を入れても解禁されない');
  sheets['ユーザー'].data[1][10] = '○';
  await A.p.evaluate(() => { window.__alerts = []; openCouponModal(); document.getElementById('couponInput').value = 'TEACHERKEY01'; submitCoupon(); });
  await A.p.waitForTimeout(1200);
  check(await A.p.evaluate(() => unlockedCards.length) === 8424, '管理者の印＋正しい鍵で全カード解禁（8,324枚＋時の回廊100枚）');
  check(String((sheetRows('取り組み状況')[0] || [])[28] || '').includes('管理者キー使用'), '管理者キーの使用を要確認に記録');
  await A.p.evaluate(() => Cloud.saveNow({ force: true })); await A.p.waitForTimeout(1500);
  check(!/上限超え|存在しない/.test(String((sheetRows('取り組み状況')[0] || [])[28] || '')), '全カード解禁（時の回廊を含む）を保存しても上限超え・存在しないカードにならない（' + ((sheetRows('取り組み状況')[0] || [])[28] || '') + '）');
  await A.p.evaluate(() => Cloud.saveNow()); await A.p.waitForTimeout(1500);
  // レイドボス：画面を開く → 挑む（5ターンで終了）→ 点数がサーバーに合算される
  await A.p.evaluate(() => openRaid()); await A.p.waitForTimeout(1200);
  check(await A.p.evaluate(() => !!document.querySelector('#raidBox .raid-go') && document.querySelector('#raidBox').innerText.includes('今日あと3回')), 'レイドの画面が開き、挑戦できる（今日あと3回）');
  if (process.env.SHOT) await A.p.screenshot({ path: process.env.SHOT + '/raid.png' });
  await A.p.evaluate(() => startRaid()); await A.p.waitForTimeout(400);
  await A.p.evaluate(() => confirmFormationAndStart()); await A.p.waitForTimeout(2000);
  const rs = await A.p.evaluate(() => ({ type: battleSession.stage.type, hp: battleSession.enemyMaxHP }));
  await A.p.evaluate(() => { battleSession.enemyHP = Math.round(battleSession.enemyMaxHP * 0.6); battleSession.turnCount = 6; endBattle(); });
  await A.p.waitForTimeout(1500);
  const raidRow = sheetRows('レイド').find(r => String(r[2]) === 'taro01');
  check(rs.type === 'raid' && raidRow && Number(raidRow[4]) === 400 && await A.p.evaluate(() => document.getElementById('battleResultDesc').innerText.includes('400点')), `レイドの点数（HPの40%＝400点）がサーバーに合算される（${raidRow && raidRow[4]}）`);
  await A.p.evaluate(() => { document.getElementById('battle-result-overlay').style.display = 'none'; document.getElementById('battle-overlay').style.display = 'none'; document.body.classList.remove('battle-mode'); });
  // 端末B：ログイン → 引き継ぎ
  const B = await newDevice(b, gas, 'B');
  await B.p.evaluate(() => Cloud.openModal('login')); await B.p.waitForTimeout(300);
  await B.p.fill('#authId', 'taro01'); await B.p.fill('#authPin', 'kotoba2026');
  await B.p.click('#authBody button[type=submit]'); await B.p.waitForTimeout(4000);
  check(await B.p.evaluate(() => unlockedCards.length) === 8424, '別の端末でログインすると続きから遊べる');
  await B.p.evaluate(() => Cloud.openModal('account')); await B.p.waitForTimeout(300);
  await B.p.click('#prefHideRanking'); await B.p.waitForTimeout(800);
  check(String(sheets['ユーザー'].data.find(r => r[0] === 'taro01')[11]) === '○', 'アカウント画面で「ランキングに載せない」を選べる');
  await B.p.evaluate(() => Cloud.closeModal());
  await B.p.evaluate(() => { Cloud.logout(); }); await B.p.waitForTimeout(2500);
  check(await B.p.evaluate(() => JSON.parse(localStorage.getItem('unlockedCards') || '[]').length) === 0, 'ログアウトするとその端末の記録が消える');
  // 問い合わせページ（アプリと同じサーバーへ送る）
  const before = sheetRows('問い合わせ').length;
  await A.p.goto('http://localhost:8765/contact.html'); await A.p.waitForTimeout(800);
  await A.c.route('**/contact.html*', r => r.continue());
  await A.p.selectOption('#type', '使い方の質問'); await A.p.fill('#message', '冒険の始め方を教えてください');
  await A.p.click('#send'); await A.p.waitForTimeout(1500);
  check(await A.p.evaluate(() => getComputedStyle(document.getElementById('done')).display) === 'block'
        && sheetRows('問い合わせ').length === before + 1, '問い合わせページから送信できる');
  // 共用の端末：しばらく使わないと、次に開いたとき自動でログアウト（記録は保存してから）
  const C = await newDevice(b, gas, 'C');
  await C.p.evaluate(() => Cloud.openModal('login')); await C.p.waitForTimeout(300);
  await C.p.fill('#authId', 'taro01'); await C.p.fill('#authPin', 'kotoba2026'); await C.p.check('#authShared');
  await C.p.click('#authBody button[type=submit]'); await C.p.waitForTimeout(4000);
  check(await C.p.evaluate(() => JSON.parse(localStorage.getItem('authSession')).shared === true), '「共用の端末」でログインできる');
  await C.p.evaluate(() => { gold = 777; saveGold(); localStorage.setItem('authLastActive', String(Date.now() - 25 * 60000)); });
  await C.p.reload(); await C.p.waitForTimeout(5000);
  const cs = await C.p.evaluate(() => ({ sess: localStorage.getItem('authSession'), owned: JSON.parse(localStorage.getItem('unlockedCards') || '[]').length }));
  const saved = JSON.parse(gas.doPost({ postData: { contents: JSON.stringify({ action: 'loadProgress', token: gas.issueToken_('taro01') }) } }).getContent());
  check(!cs.sess && cs.owned === 0 && saved.data && saved.data.gold === '777', '20分使わないと自動でログアウトし、直前の記録はサーバーに保存済み');
  check(A.p.__errs.length + B.p.__errs.length + C.p.__errs.length === 0, 'エラーなし ' + [...A.p.__errs, ...B.p.__errs, ...C.p.__errs].join(' / '));
  await b.close();
  if (srv) srv.close();
  console.log(failed ? `\n${failed}件 失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
