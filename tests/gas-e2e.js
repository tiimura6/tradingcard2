// GAS連携の通しテスト（Code.gs をモックのスプレッドシートで動かす）
// 先に python3 -m http.server 8765 を起動してから: NODE_PATH=$(npm root -g) node tests/gas-e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { makeEnv } = require('./gas-mock.js');

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
  const b = await chromium.launch();
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
  await A.p.evaluate(() => enterAdventureMode()); await A.p.waitForTimeout(1500);
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
  check(await A.p.evaluate(() => unlockedCards.length) === 8324, '管理者の印＋正しい鍵で全カード解禁');
  check(String((sheetRows('取り組み状況')[0] || [])[28] || '').includes('管理者キー使用'), '管理者キーの使用を要確認に記録');
  await A.p.evaluate(() => Cloud.saveNow()); await A.p.waitForTimeout(1500);
  // レイドボス：画面を開く → 挑む（5ターンで終了）→ 点数がサーバーに合算される
  await A.p.evaluate(() => openRaid()); await A.p.waitForTimeout(1200);
  check(await A.p.evaluate(() => !!document.querySelector('#raidBox .raid-go') && document.querySelector('#raidBox').innerText.includes('今日あと3回')), 'レイドの画面が開き、挑戦できる（今日あと3回）');
  if (process.env.SHOT) await A.p.screenshot({ path: process.env.SHOT + '/raid.png' });
  await A.p.evaluate(() => startRaid()); await A.p.waitForTimeout(400);
  for (let n = 0; n < 3; n++) await A.p.evaluate(() => document.querySelector('#formationCardPool .formation-pool-card:not(.used)').click());
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
  check(await B.p.evaluate(() => unlockedCards.length) === 8324, '別の端末でログインすると続きから遊べる');
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
  console.log(failed ? `\n${failed}件 失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
