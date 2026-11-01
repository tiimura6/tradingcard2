#!/usr/bin/env node
/*
 * 回帰テスト（ブラウザで実際にアプリを動かして確認する）
 *
 * 使い方:  npm test        （または  node tests/regression.js）
 * 初回のみ: npm install && npx playwright install chromium
 *
 * テスト用に小さなWebサーバーを自動で立ち上げ、ヘッドレスのChromiumで index.html を開く。
 * 各テストは新しいブラウザ環境（localStorage 空）から始まる。
 * 失敗したテストがあれば一覧を表示して終了コード1で終わる。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8799;
const URL = `http://localhost:${PORT}/index.html`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };

function startServer() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(PORT, () => r(srv)));
}

// ---- 小さなテスト枠組み ----
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// 共通：新しいブラウザ環境でアプリを開く
async function openApp(browser, { seed, viewport, ignoreMute } = {}) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  await ctx.addInitScript(({ seed, ignoreMute }) => {
    window.confetti = () => {};
    window.alert = m => { (window.__alerts = window.__alerts || []).push(String(m)); };
    window.confirm = () => true;
    // 鳴っている音の記録（BGMの重なりテスト用）
    window.__media = [];
    const P = HTMLMediaElement.prototype, op = P.play;
    P.play = function () { if (!window.__media.includes(this)) window.__media.push(this); return op.call(this); };
    if (ignoreMute) Object.defineProperty(P, 'muted', { get() { return false; }, set() {} });   // iPhone相当（消音が効かない）
    if (seed && !sessionStorage.getItem('__seeded')) {
      Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
      sessionStorage.setItem('__seeded', '1');
    }
  }, { seed: seed || null, ignoreMute: !!ignoreMute });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(1500);
  page.__errors = errors;
  page.__ctx = ctx;
  return page;
}
const playing = page => page.evaluate(() =>
  window.__media.filter(a => !a.paused && a.loop).map(a => a.src.split('/').pop()).sort().join(','));
const ids = (prefix, from, to) => { const a = []; for (let i = from; i <= to; i++) a.push(`${prefix}-${i}`); return a; };
async function formParty(page, stageIndex) {
  await page.evaluate(i => openBattleFormationModal(getBattleStages()[i]), stageIndex);
  for (let n = 0; n < 3; n++) await page.evaluate(() => document.querySelector('#formationCardPool .formation-pool-card:not(.used)').click());
}

// =====================================================================
test('新規ユーザーは鉄の手帖から始まり、エラーが出ない', async b => {
  const p = await openApp(b);
  const r = await p.evaluate(() => ({ nb: currentNB.key, n: cardsData.length, h1: document.getElementById('nbTitle').textContent }));
  assert(r.nb === 'A1' && r.n === 1067 && r.h1 === '鉄の手帖', JSON.stringify(r));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('既存ユーザー（白金カード所持）は白金の手帖が開いている', async b => {
  const p = await openApp(b, { seed: { unlockedCards: ['card-1', 'card-2'] } });
  const r = await p.evaluate(() => ({ nb: currentNB.key, st: notebookState.unlocked }));
  assert(r.nb === 'PT' && r.st.includes('PT') && r.st.includes('A1'), JSON.stringify(r));
});

test('手帖の切り替え：再読み込みなし・背景と見出しが変わる・BGMが途切れない', async b => {
  const p = await openApp(b, { seed: { notebookState: { unlocked: ['A1', 'A2', 'B1', 'B2', 'PT'], current: 'A1' } } });
  let navs = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) navs++; });
  await p.click('#bgmBtn'); await p.waitForTimeout(600);
  for (const [name, key, bg] of [['銅の手帖', 'A2', 'bg_A2.jpg'], ['白金の手帖', 'PT', 'bg_PT.jpg'], ['鉄の手帖', 'A1', 'bg.jpg']]) {
    await p.click('#nbChip'); await p.waitForTimeout(300);
    await p.click(`.nb-row:has-text("${name}")`); await p.waitForTimeout(2300);
    const r = await p.evaluate(() => ({ nb: currentNB.key, h1: document.getElementById('nbTitle').textContent,
      bg: getComputedStyle(document.getElementById('bg-layer')).backgroundImage }));
    assert(r.nb === key && r.h1 === name && r.bg.includes(bg), JSON.stringify(r));
    assert((await playing(p)) === 'main.mp3', 'BGM: ' + await playing(p));
  }
  assert(navs === 0, `ページが ${navs} 回読み込み直された`);
});

test('BGMが重ならない（iPhone相当：消音が効かない環境）', async b => {
  const p = await openApp(b, { ignoreMute: true, seed: { unlockedCards: ids('a1', 1, 3) } });
  await p.mouse.click(200, 820); await p.waitForTimeout(600);
  assert((await playing(p)) === '', '起動直後に鳴っている: ' + await playing(p));
  await p.click('#bgmBtn'); await p.waitForTimeout(800);
  assert((await playing(p)) === 'main.mp3', 'メイン: ' + await playing(p));
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(1600);
  assert((await playing(p)) === 'adventure.mp3', '冒険: ' + await playing(p));
  await p.evaluate(() => closeTrainingModal(true)); await p.waitForTimeout(1800);
  assert((await playing(p)) === 'main.mp3', '冒険後: ' + await playing(p));
  await formParty(p, 0); await p.click('#formationStartBtn'); await p.waitForTimeout(1500);
  assert((await playing(p)) === 'boss.mp3', 'バトル: ' + await playing(p));
});

test('カードを引く：50G（被りあり）と100G（新カード確定）', async b => {
  const p = await openApp(b);
  await p.waitForTimeout(2500);   // 起動直後のログイン報酬（ゴールド）が付与され終わるのを待つ
  await p.evaluate(() => { gold = 1000; saveGold(); });
  await p.click('#gachaBtn'); await p.waitForTimeout(300);
  await p.click('#drawPremiumBtn'); await p.waitForTimeout(3000);
  let r = await p.evaluate(() => ({ gold, owned: ownedInNotebook() }));
  assert(r.gold === 900 && r.owned === 1, JSON.stringify(r));
  await p.evaluate(() => document.getElementById('gachaCloseBtn').click());
  await p.click('#gachaBtn'); await p.waitForTimeout(300);
  await p.click('#drawNormalBtn'); await p.waitForTimeout(3000);
  r = await p.evaluate(() => ({ gold }));
  assert(r.gold === 850, JSON.stringify(r));
});

test('冒険で正解するとXPとゴールドが増える／記録画面にカウントアップ表示', async b => {
  const p = await openApp(b);
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(1500);
  await p.evaluate(() => openTrainingMode()); await p.waitForTimeout(400);
  const g0 = await p.evaluate(() => gold);
  await p.evaluate(() => document.querySelector('.quiz-choice-btn[data-correct]').click()); await p.waitForTimeout(1300);
  assert((await p.evaluate(() => gold)) > g0, 'ゴールドが増えていない');
  await p.evaluate(() => closeQuiz()); await p.waitForTimeout(1600);
  const t = await p.evaluate(() => document.getElementById('quizTitle').innerText + document.getElementById('quizSentence').innerText);
  assert(t.includes('今回の冒険の記録') && t.includes('獲得ゴールド'), t);
});

test('4択に正解が2つ入らない（a.m. と p.m. など）', async b => {
  const p = await openApp(b);
  const bad = await p.evaluate(() => {
    const pairs = { 'a.m.': ['p.m.'], 'Monday': ['Tuesday', 'Sunday'], 'buy': ['sell'] }, out = [];
    for (const w of Object.keys(pairs)) {
      const c = cardsData.find(x => x.quiz.answer === w);
      for (let k = 0; k < 80; k++) {
        trainingSession.active = k % 2 === 0; showQuiz(c);
        const ch = [...document.querySelectorAll('.quiz-choice-btn')].map(x => x.textContent);
        pairs[w].forEach(x => { if (ch.includes(x)) out.push(w + ':' + x); });
      }
    }
    trainingSession.active = false;
    return [...new Set(out)];
  });
  assert(bad.length === 0, bad.join(','));
});

test('回答判定：1文字では正解にならない', async b => {
  const p = await openApp(b);
  const r = await p.evaluate(() => [validateAnswer('a', 'apple'), validateAnswer('Apple', 'apple'), validateAnswer('an apple', 'apple')]);
  assert(r[0] === false && r[1] === true && r[2] === true, JSON.stringify(r));
});

test('★：復習日前の連続正解では上がらない／覚醒クエストで★3', async b => {
  const now = Date.now();
  const p = await openApp(b, { seed: { cardMergeV1: '1', srsData: { 'a1-30': { level: 2, nextReview: now + 86400000 * 3, correct: 2, incorrect: 0 } } } });
  await p.evaluate(() => { updateSRS('a1-40', true); updateSRS('a1-40', true); updateSRS('a1-40', true); });
  assert((await p.evaluate(() => srsData['a1-40'].level)) === 1, '連続正解で段階が上がった');
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(1500);
  await p.evaluate(() => { closeTrainingModal(false); openTrainingMode(); trainingSession.qCount = 3; showTrainingQuiz(); }); await p.waitForTimeout(300);
  assert((await p.evaluate(() => document.getElementById('quizTitle').innerText)).includes('覚醒'), '覚醒クエストが出ない');
  await p.fill('#awakenInput', await p.evaluate(() => cardsData[29].quiz.answer));
  await p.click('#awakenSubmit'); await p.waitForTimeout(800);
  assert((await p.evaluate(() => getStars('a1-30'))) === 3, '★3 にならない');
});

test('バトル：順番に編成（前衛はPower順）→作戦→1問→命中判定→撃退の演出と結果', async b => {
  const p = await openApp(b, { seed: { unlockedCards: ids('a1', 1, 60) } });
  await p.evaluate(() => openBattleFormationModal(getBattleStages()[0]));
  assert((await p.evaluate(() => formationPoolSort)) === 'power', '前衛でPower順になっていない');
  for (let n = 0; n < 3; n++) await p.evaluate(() => document.querySelector('#formationCardPool .formation-pool-card:not(.used)').click());
  const slots = await p.evaluate(() => ['front', 'mid', 'rear'].every(x => formationState.slots[x]));
  assert(slots, '3枠が埋まらない');
  await p.click('#formationStartBtn'); await p.waitForTimeout(1300);
  assert((await p.evaluate(() => document.querySelectorAll('.bplan-btn').length)) === 6, '作戦ボタンが攻撃・スキルの6個でない');
  await p.evaluate(() => { battleSession.enemyHP = 1; });
  await p.click('#battleGoBtn'); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('.quiz-choice-btn[data-correct]').click());
  await p.waitForTimeout(5500);
  const d = await p.evaluate(() => document.getElementById('battleResultDesc').innerText);
  assert(d.includes('撃退'), d);
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('管理者キーで全手帖・全カード・全タブが開く', async b => {
  const p = await openApp(b);
  await p.evaluate(() => { openCouponModal(); document.getElementById('couponInput').value = 'SHION3215T'; submitCoupon(); });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ st: notebookState.unlocked.length, owned: unlockedCards.length, tabs: getUnlockedTabCount() }));
  assert(r.st === 5 && r.owned === 8324 && r.tabs === 11, JSON.stringify(r));
});

test('殿堂入りボスラッシュが開始できる（白金の手帖）', async b => {
  const p = await openApp(b, { seed: { unlockedCards: ids('card', 1, 863) } });
  await p.evaluate(() => startHofBossRush()); await p.waitForTimeout(400);
  assert((await p.evaluate(() => getComputedStyle(document.getElementById('battle-formation-modal')).display)) !== 'none', '編成画面が開かない');
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('殿堂入りボタンは白金の手帖だけに表示／ボスラッシュはバトル背景', async b => {
  const p = await openApp(b, { seed: { unlockedCards: ids('card', 1, 863).concat(['a1-1']),
    notebookState: { unlocked: ['A1', 'PT'], current: 'A1' } } });
  assert((await p.evaluate(() => getComputedStyle(document.getElementById('hofBtn')).display)) === 'none', '鉄の手帖で殿堂入りボタンが見えている');
  await p.click('#nbChip'); await p.waitForTimeout(300);
  await p.click('.nb-row:has-text("白金の手帖")'); await p.waitForTimeout(2300);
  assert((await p.evaluate(() => getComputedStyle(document.getElementById('hofBtn')).display)) !== 'none', '白金で殿堂入りボタンが見えない');
  await p.evaluate(() => startHofBossRush()); await p.waitForTimeout(400);
  const bg = await p.evaluate(() => getComputedStyle(document.getElementById('bg-layer')).backgroundImage);
  assert(bg.includes('boss-bg'), '編成中の背景: ' + bg);
  await p.evaluate(() => closeFormationModal()); await p.waitForTimeout(300);
  assert(!(await p.evaluate(() => document.body.classList.contains('battle-mode'))), 'キャンセル後もバトル背景のまま');
});

test('単語ガイド：発音記号・成り立ち・例文訳が表示される（金の手帖 exaggerate）', async b => {
  const p = await openApp(b, { seed: { notebookState: { unlocked: ['A1', 'A2', 'B1', 'B2', 'PT'], current: 'B2' } } });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const c = cardsData.find(c => c.quiz.answer === 'exaggerate'); showZoomInfoPanel(c.no); });
  await p.waitForTimeout(1500);
  const txt = await p.evaluate(() => document.getElementById('zoomInfoContent').innerText);
  assert(txt.includes('/ɪɡˈzædʒəreɪt/'), 'IPAなし: ' + txt.slice(0, 120));
  assert(txt.includes('成り立ち') && txt.includes('誇張'), txt.slice(0, 200));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('同じつづりの語は1枚：意味ごとの例文を表示／出題は意味ごと／古い番号の所持カードを移行', async b => {
  // 旧番号：A1 の about(副)=a1-3, about(前)=a1-4, answer(名)=a1-38, answer(動)=a1-39 → 新番号 a1-3, a1-3, a1-3, a1-34
  const p = await openApp(b, { seed: { unlockedCards: ['a1-3', 'a1-4', 'a1-39'],
    srsData: { 'a1-3': { level: 1, nextReview: 0, correct: 2, incorrect: 0 }, 'a1-4': { level: 3, nextReview: 0, correct: 4, incorrect: 1 } } } });
  const r = await p.evaluate(() => {
    const about = cardsData.find(c => c.quiz.answer === 'about');
    const ans = cardsData.find(c => c.quiz.answer === 'answer');
    return { owned: unlockedCards.slice().sort(), aboutNo: about.no, ansNo: ans.no, senses: about._senses.map(s => s.pos).join(','),
      srs: srsData['a1-3'], dupWords: cardsData.length - new Set(cardsData.map(c => c.quiz.answer.toLowerCase())).size, flag: localStorage.getItem('cardMergeV1') };
  });
  assert(r.aboutNo === 3 && r.ansNo === 34 && r.senses === 'adv.,prep.', JSON.stringify(r));
  assert(JSON.stringify(r.owned) === JSON.stringify(['a1-3', 'a1-34']), '移行: ' + JSON.stringify(r.owned));
  assert(r.srs.level === 3 && r.srs.correct === 6, 'srs: ' + JSON.stringify(r.srs));
  assert(r.dupWords === 2 && r.flag === '1', JSON.stringify(r));   // May/may と Miss/miss だけは別の語として残す
  // 単語ガイド：意味ごとの例文
  await p.evaluate(() => showZoomInfoPanel(3)); await p.waitForTimeout(1200);
  const txt = await p.evaluate(() => document.getElementById('zoomInfoContent').innerText);
  assert(txt.includes('例文（意味ごと）') && txt.includes('two hours') && txt.includes('sleeping star'), txt.slice(0, 300));
  // 出題：何度か出すと両方の意味が出る
  const seen = await p.evaluate(() => { const c = cardsData[2], s = new Set(); for (let i = 0; i < 40; i++) { pickSense(c); s.add(c.quiz.pos); } return [...s].sort().join(','); });
  assert(seen === 'adv.,prep.', seen);
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('小さい画面（幅360px）で主な画面が横にはみ出さない', async b => {
  const p = await openApp(b, { viewport: { width: 360, height: 740 }, seed: { unlockedCards: ids('a1', 1, 50) } });
  const steps = ['openStudyMode("all")', 'closeStudyMode()', 'showHallOfFameModal()', 'closeChallengeModal()',
    'openBattleStageModal()', 'closeBattleStageModal()', 'openNotebookPicker()', 'closeNotebookPicker()',
    'gold=500;startGachaViaButton()', 'closeGachaChoiceModal()', 'tapCard(cardsData[1],true)', 'closeZoom()',
    'enterAdventureMode()', 'closeTrainingModal(true)'];
  for (const s of steps) {
    await p.evaluate(s); await p.waitForTimeout(250);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 360, `${s} で横幅 ${w}px`);
  }
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

// =====================================================================
(async () => {
  const srv = await startServer();
  const browser = await chromium.launch();
  const only = process.argv[2];
  let fail = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const t0 = Date.now();
    try {
      await t.fn(browser);
      console.log(`  ✅ ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      fail++;
      console.log(`  ❌ ${t.name}\n       → ${String(e.message).split('\n')[0]}`);
    }
    for (const c of browser.contexts()) await c.close();
  }
  await browser.close();
  srv.close();
  console.log(fail ? `\n${fail}件 失敗` : '\nすべて成功');
  process.exit(fail ? 1 : 0);
})();
