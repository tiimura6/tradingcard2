// GAS連携の通しテスト（Code.gs をモックで動かす）。先に python3 -m http.server 8765 を起動してから: node tests/gas-e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const { makeEnv } = require('./gas-mock.js');
const { ctx: gas, sheets } = makeEnv();
gas.setup();
const FAKE = 'https://script.google.com/macros/s/FAKE/exec';
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/const GAS_URL = '[^']*';/, `const GAS_URL = '${FAKE}';`);
async function newDevice(b, name) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(() => { window.confetti = () => {}; });
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
const sheetRows = n => sheets[n].data.filter((r, i) => i > 0 && r.some(x => x !== ''));
(async () => {
  const b = await chromium.launch();
  // 端末A：登録
  const A = await newDevice(b, 'A');
  console.log('A login screen shown:', await A.p.evaluate(() => getComputedStyle(document.getElementById('auth-overlay') || document.getElementById('authBox').parentElement).display));
  await A.p.evaluate(() => Cloud.openModal('register')); await A.p.waitForTimeout(300);
  await A.p.fill('#regId', 'taro01'); await A.p.fill('#regNick', 'たろう'); await A.p.fill('#regName', '山田太郎'); await A.p.fill('#regClass', '2-3');
  await A.p.fill('#regPin', '1234'); await A.p.fill('#regPin2', '1234');
  await A.p.click('button:has-text("登録して始める")'); await A.p.waitForTimeout(2500);
  // 学習：カードを手に入れて冒険で数問
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
  await A.p.evaluate(() => Cloud.manualSave()); await A.p.waitForTimeout(1500);
  await A.p.evaluate(() => Cloud.flushLogs && Cloud.flushLogs()); await A.p.waitForTimeout(16500);   // ログの送信（15秒ごと）
  const aState = await A.p.evaluate(() => ({ owned: unlockedCards.slice().sort(), gold, flag: localStorage.getItem('cardMergeV1') }));
  console.log('A owned', aState.owned.length, 'gold', aState.gold);
  console.log('status sheet:', JSON.stringify(sheetRows('取り組み状況')[0]));
  console.log('log rows:', sheetRows('学習ログ').length, 'sample:', JSON.stringify(sheetRows('学習ログ').slice(-1)[0]));
  // 端末B：ログイン → 引き継ぎ
  const B = await newDevice(b, 'B');
  await B.p.evaluate(() => Cloud.openModal('login')); await B.p.waitForTimeout(300);
  await B.p.fill('#authId', 'taro01'); await B.p.fill('#authPin', '1234');
  await B.p.click('#authBody button[type=submit]'); await B.p.waitForTimeout(4000);
  const bState = await B.p.evaluate(() => ({ owned: unlockedCards.slice().sort(), gold, flag: localStorage.getItem('cardMergeV1') }));
  console.log('B owned', bState.owned.length, 'gold', bState.gold, 'same cards:', JSON.stringify(aState.owned) === JSON.stringify(bState.owned));
  // ランキング（GET）
  console.log('hof ranking:', gas.doGet({ parameter: { action: 'hofRanking' } }).getContent().slice(0, 80));
  // ログアウト
  await B.p.evaluate(() => { window.confirm = () => true; Cloud.logout(); }); await B.p.waitForTimeout(2500);
  console.log('B after logout owned:', await B.p.evaluate(() => JSON.parse(localStorage.getItem('unlockedCards') || '[]').length));
  console.log('errors:', [...A.p.__errs, ...B.p.__errs]);
  await b.close();
})();
