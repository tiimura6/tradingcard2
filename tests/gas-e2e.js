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
  await c.addInitScript(() => { window.confetti = () => {}; window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = () => true; });
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
  // ---------- サーバー単体：セキュリティ ----------
  console.log('サーバー（Code.gs）');
  {
    const { ctx: gas, sheets, cache, props } = makeEnv(); gas.setup();
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
  // 端末B：ログイン → 引き継ぎ
  const B = await newDevice(b, gas, 'B');
  await B.p.evaluate(() => Cloud.openModal('login')); await B.p.waitForTimeout(300);
  await B.p.fill('#authId', 'taro01'); await B.p.fill('#authPin', 'kotoba2026');
  await B.p.click('#authBody button[type=submit]'); await B.p.waitForTimeout(4000);
  check(await B.p.evaluate(() => unlockedCards.length) === 8324, '別の端末でログインすると続きから遊べる');
  await B.p.evaluate(() => { Cloud.logout(); }); await B.p.waitForTimeout(2500);
  check(await B.p.evaluate(() => JSON.parse(localStorage.getItem('unlockedCards') || '[]').length) === 0, 'ログアウトするとその端末の記録が消える');
  check(A.p.__errs.length + B.p.__errs.length === 0, 'エラーなし ' + [...A.p.__errs, ...B.p.__errs].join(' / '));
  await b.close();
  console.log(failed ? `\n${failed}件 失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
