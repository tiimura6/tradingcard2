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
    // レベル判定テストは、そのテストでだけ出す（ほかのテストでは画面をふさぐため受験済みにしておく）
    if (!sessionStorage.getItem('__seeded') && !(seed && seed.__placement)) localStorage.setItem('placementDone', 'test');
    if (!sessionStorage.getItem('__seeded') && !(seed && seed.__tutorial)) localStorage.setItem('tutorialDone', 'test');   // 遊び方の案内は案内のテストでだけ出す
    // 物語の場面は、物語のテストでだけ出す（ほかのテストでは画面をふさぐので読んだことにしておく）
    if (!sessionStorage.getItem('__seeded') && !(seed && seed.__story)) localStorage.setItem('storySeen', JSON.stringify(Object.fromEntries(['prologue','end_A1','start_A2','end_A2','start_B1','end_B1','start_B2','end_B2','start_PT','end_PT','hof'].map(k => [k, 1]))));
    if (seed && !sessionStorage.getItem('__seeded')) {
      Object.entries(seed).forEach(([k, v]) => { if (k !== '__placement' && k !== '__story' && k !== '__tutorial') localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); });
      sessionStorage.setItem('__seeded', '1');
    }
  }, { seed: seed || null, ignoreMute: !!ignoreMute });
  // ログイン機能（GAS）は切った状態でテストする（本番のサーバーにはつながない）
  await ctx.route(/\/index\.html(\?.*)?$/, async r => {
    const res = await r.fetch();
    const body = (await res.text()).replace(/const GAS_URL = '[^']*';/, "const GAS_URL = '';");
    await r.fulfill({ response: res, body });
  });
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
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(2000);
  assert((await playing(p)) === 'bgm_meadow.mp3', '冒険: ' + await playing(p));
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
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(2000);
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
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(2000);
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
  const si = await p.evaluate(() => ({ n: document.querySelectorAll('#formationSkillInfo > div').length, txt: document.getElementById('formationSkillInfo').innerText, pool: document.querySelector('#formationCardPool .formation-pool-card').title }));
  assert(si.n === 3 && si.txt.includes('力') && si.pool.includes('力'), '編成画面にスキルの効果が出ない ' + JSON.stringify(si));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/formation.png' });
  await p.click('#formationStartBtn'); await p.waitForTimeout(1300);
  assert((await p.evaluate(() => document.querySelectorAll('.bplan-btn').length)) === 9, '作戦ボタンが攻撃・スキル・守るの9個でない');
  // 最初はゲージ0なのでスキルは選べない・ボスの予告が出ている
  const g0 = await p.evaluate(() => ({ dis: [...document.querySelectorAll('.bplan-btn.skill')].every(b => b.disabled), intent: battleSession.intent, box: !!document.querySelector('.b-intent') }));
  assert(g0.dis && g0.intent === 'attack' && g0.box, JSON.stringify(g0));
  await p.evaluate(() => { battleSession.enemyHP = 1; });
  await p.click('#battleGoBtn'); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('.quiz-choice-btn[data-correct]').click());
  await p.waitForTimeout(5500);
  const d = await p.evaluate(() => document.getElementById('battleResultDesc').innerText);
  assert(d.includes('撃退'), d);
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('バトル：ことばの力ゲージ・スキルの消費・守る・必殺技・ボスの予告と怒り状態', async b => {
  const p = await openApp(b, { seed: { unlockedCards: ids('a1', 1, 60) } });
  await p.evaluate(() => openBattleFormationModal(getBattleStages()[0]));
  for (let n = 0; n < 3; n++) await p.evaluate(() => document.querySelector('#formationCardPool .formation-pool-card:not(.used)').click());
  await p.click('#formationStartBtn'); await p.waitForTimeout(1300);
  const r = await p.evaluate(() => {
    const s = battleSession, out = {};
    // ゲージが2枚分ちょうど：スキルは2枚まで（使う力はスキルごとに違う）
    s.gauge = skillCost(s.units[0]) + skillCost(s.units[1]); renderBattlePlanner();
    setBattlePlan(0, 'skill'); setBattlePlan(1, 'skill'); setBattlePlan(2, 'skill');
    out.skills = s.plan.filter(a => a === 'skill').length;
    out.thirdDisabled = document.querySelectorAll('.bplan-btn.skill')[2].disabled;
    // 作戦決定でゲージを使う
    s.turn = 'player'; s.plan = ['skill', 'attack', 'guard']; s.gauge = 40;
    const sq = battleStartQuiz; battleStartQuiz = () => {}; confirmBattlePlan(); battleStartQuiz = sq;
    out.afterSpend = s.gauge; out.expSpend = 40 - skillCost(s.units[0]);
    // 満タンで必殺技ボタン
    s.turn = 'player'; s.gauge = 100; renderBattlePlanner();
    out.ultBtn = !!document.querySelector('.bplan-ult');
    // 力をためた次は必ず大技
    s.intent = 'charge'; out.next = pickBossIntent();
    out.cost = planCost('ult');
    return out;
  });
  if (process.env.SHOT) { await p.evaluate(() => { const s = battleSession; s.turn = 'player'; s.gauge = 70; s.streak = 3; s.intent = 'smash'; s.intentTurn = s.turnCount; s.plan = ['skill', 'guard', 'attack']; renderBattlePlanner(); document.querySelector('#battleActionArea').scrollIntoView(); }); await p.screenshot({ path: process.env.SHOT + '/plan1.png' });
    await p.evaluate(() => { const s = battleSession; s.gauge = 100; s.plan = 'ult'; s.intent = 'shield'; s.rage = true; renderBattlePlanner(); }); await p.screenshot({ path: process.env.SHOT + '/plan2.png' }); }
  assert(r.skills === 2 && r.thirdDisabled && r.afterSpend === r.expSpend && r.ultBtn && r.next === 'smash' && r.cost === 100, JSON.stringify(r));
  // 正解でゲージがたまる（連続正解で増える）・守るで被ダメージが減る
  const r2 = await p.evaluate(() => new Promise(res => {
    const s = battleSession; s.gauge = 0; s.streak = 1; s.plan = ['guard', 'guard', 'attack']; s.intent = 'attack'; s.enemyHP = s.enemyMaxHP;
    s.playerHP = Math.round(s.playerMaxHP / 2); const hp0 = s.playerHP;
    const eT = battleEnemyTurn; battleEnemyTurn = () => { battleEnemyTurn = eT; res({ gauge: s.gauge, streak: s.streak, cut: s._guardCut, healed: s.playerHP - hp0, exp: 2 * Math.round(s.playerMaxHP * GAUGE.guardHeal) }); };
    resolveBattleRound(true);
  }));
  assert(r2.gauge === 35 && r2.streak === 2 && Math.abs(r2.cut - 0.6) < 1e-9 && r2.healed === r2.exp, JSON.stringify(r2));
  // スキルは品詞ごとに4種類・単語で決まる（同じ単語はいつも同じ）。鉄壁は大技を防ぎ、先読みは大技を止め、呪いはボスの攻撃を下げる
  const r4 = await p.evaluate(() => new Promise(res => {
    const kinds = new Set(cardsData.slice(0, 400).map(c => getWordSkill(c).kind));
    const same = getWordSkill(cardsData[5]).name === getWordSkill(cardsData[5]).name;
    const s = battleSession, u = s.units[0], orig = u.skill;
    const out = { kinds: kinds.size, same };
    u.skill = Object.assign({}, POS_SKILLS.adv[1].base, { type: 'swift' }); s.intent = 'smash'; applySkillEffect(u, 1, 1, ''); out.foresee = s.intent; out.fx = !!document.querySelector('#skill-fx .sk-banner') && !!document.querySelector('#skill-fx .sk-ring');
    u.skill = orig;
    s._wall = 0.25; s.intent = 'smash'; s.playerHP = s.playerMaxHP; const hp0 = s.playerHP; s.rage = true;
    const rbu = renderBattleUI; renderBattleUI = () => {}; battleEnemyTurn();
    setTimeout(() => { out.walled = hp0 - s.playerHP; s._curse = { power: 0.4, turns: 1 }; s.intent = 'attack'; const hp1 = s.playerHP; battleEnemyTurn();
      setTimeout(() => { out.cursed = hp1 - s.playerHP; out.atk = s.stage.atk; }, 1000);
      setTimeout(() => { renderBattleUI = rbu; res(out); }, 2200); }, 2000);   // 次のターンの準備（予告の決め直し）が終わってから戻す
  }));
  assert(r4.kinds >= 12 && r4.same && r4.foresee === 'attack' && r4.fx && r4.walled === 0 && r4.cursed > 0 && r4.cursed < r4.atk, JSON.stringify(r4));
  // ★（習熟度）1つにつき+30%：★5で2.5倍
  const st = await p.evaluate(() => { const c = cardsData[10]; const keep = getStars; getStars = () => 0; const a0 = getCardStats(c).atk; getStars = () => 5; const a5 = getCardStats(c).atk; getStars = keep; return { a0, a5, lv: xpData.level }; });
  assert(st.lv > 1 || Math.abs(st.a5 / st.a0 - 2.5) < 0.05, JSON.stringify(st));
  if (process.env.SHOT) for (const k of [['n', 2], ['v', 2], ['adj', 1]]) {
    await p.evaluate(k => { const s = battleSession, u = s.units[0]; s.intent = 'shield'; const fam = POS_SKILLS[k[0]][k[1]]; skillFx(u, Object.assign({ type: 'x' }, fam.high), { shield: true }); }, k);
    await p.waitForTimeout(380); await p.screenshot({ path: process.env.SHOT + '/skfx_' + k[0] + '.png' });
  }
  // ボスのHPが半分を切ると怒り状態に
  const r3 = await p.evaluate(() => new Promise(res => {
    const s = battleSession; s.intent = 'attack'; s.enemyHP = Math.floor(s.enemyMaxHP * 0.4); s.playerHP = s.playerMaxHP; s._guardCut = 0.6;
    const hp0 = s.playerHP; battleEnemyTurn();
    setTimeout(() => res({ rage: s.rage, banner: !!document.getElementById('battle-rage') || s.rage, dmg: hp0 - s.playerHP, atk: s.stage.atk, active: s.active, hp0, ehp: s.enemyHP, log: s.log && s.log.slice(-3) }), 1200);
  }));
  assert(r3.rage && r3.dmg > 0 && r3.dmg < r3.atk * 0.5, JSON.stringify(r3));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('タイトル画面に全手帖（鉄〜白金）のコンプリート率', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 100).concat(ids('card', 1, 50)) } });
  await p.waitForTimeout(2600);
  const r = await p.evaluate(() => { updateCollectionProgress(); const a = allCompletion(); return { have: a.have, total: a.total, txt: document.getElementById('allCp').innerText, segs: document.querySelectorAll('.all-cp-seg').length }; });
  assert(r.have === 150 && r.total === 8324 && r.segs === 5 && r.txt.includes('1.8%') && r.txt.includes('150 / 8,324'), JSON.stringify(r));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('称号・実績：これまでの記録でまとめて解除・報酬・称号の表示・新しい解除の通知', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 100), playStats: { battleWins: 1 }, gold: '0' } });
  await p.waitForTimeout(4200);
  const r = await p.evaluate(() => ({ a: Object.keys(achv), gold, pop: (document.getElementById('achv-pop') || {}).textContent || '' }));
  assert(r.a.includes('c10') && r.a.includes('c100') && r.a.includes('win1') && !r.a.includes('c500') && r.gold >= 600, JSON.stringify(r));
  const r2 = await p.evaluate(() => { openSettings(); document.querySelector('#settingsBox .set-link').click(); const items = document.querySelectorAll('#achvBox .achv-item').length; const got = document.querySelectorAll('#achvBox .achv-item.done').length; closeAchievements();
    return { items, got, btn: !!document.getElementById('achvBtn') }; });
  assert(r2.items === 34 && r2.got === 3 && !r2.btn, JSON.stringify(r2));
  await p.evaluate(() => { statInc('ultUsed'); }); await p.waitForTimeout(1200);
  const r3 = await p.evaluate(() => ({ ult: !!achv.ult, pop: (document.getElementById('achv-pop') || {}).textContent || '' }));
  assert(r3.ult && r3.pop.includes('合体の極意'), JSON.stringify(r3));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('レイドボス：サーバーにつながっていないときは参加できない旨を表示', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.evaluate(() => openRaid()); await p.waitForTimeout(300);
  assert(await p.evaluate(() => document.getElementById('raidBox').innerText.includes('サーバーにつながっていない')), 'メッセージがない');
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('設定：効果音・演出を減らす・文字を大きく（この端末に保存）／カードの拡大表示に閉じるボタン', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 5) } });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    openSettings();
    const rows = document.querySelectorAll('#settingsBox .set-row').length;
    setSetting('reduce', true); setSetting('big', true); setSetting('se', false);
    return { rows, reduce: document.body.classList.contains('reduce-motion'), big: document.body.classList.contains('text-large'), se: seOn(), saved: JSON.parse(localStorage.getItem('appSettings')) };
  });
  assert(r.rows >= 4 && r.reduce && r.big && r.se === false && r.saved.reduce === true, JSON.stringify(r));
  const k = await p.evaluate(() => ({ key: [...document.querySelectorAll('#settingsBox .set-link')].some(b => b.textContent.includes('秘密の鍵')), header: !!document.querySelector('.header-plate button[title="秘密の鍵"]'), chip: getComputedStyle(document.getElementById('accountChip')).display }));
  assert(k.key && !k.header && k.chip === 'none', '秘密の鍵・ログインが設定画面にない ' + JSON.stringify(k));
  await p.reload(); await p.waitForTimeout(1500);
  assert(await p.evaluate(() => document.body.classList.contains('reduce-motion') && document.body.classList.contains('text-large')), '再読み込みで設定が戻る');
  await p.evaluate(() => { closeSettings(); tapCard(cardsData[0], true); });
  assert(await p.evaluate(() => !!document.querySelector('#zoomContent .zoom-close-bar')), '閉じるボタンがない');
  await p.click('#zoomContent .zoom-close-bar');
  assert(await p.evaluate(() => getComputedStyle(document.getElementById('zoom-overlay')).display === 'none'), '閉じない');
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('カードのイラスト：一覧にある絵を使い、無いカードは文字のカード・読めないときも文字のカードに戻る', async b => {
  const fs = require('fs'), path = require('path');
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.confetti = () => {}; window.alert = () => {}; localStorage.setItem('placementDone', 'test'); localStorage.setItem('cardMergeV1', '1');
    localStorage.setItem('unlockedCards', JSON.stringify(['a1-1', 'a1-2', 'a1-3'])); });
  await ctx.route(/\/index\.html(\?.*)?$/, async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/const GAS_URL = '[^']*';/, "const GAS_URL = '';").replace("const IMG_BASE = '';", "const IMG_BASE = 'http://localhost:8765/__img/';") }); });
  await ctx.route(/\/__img\//, r => {
    const rel = new (require('url').URL)(r.request().url()).pathname.replace('/__img/', '');
    const f = path.join(__dirname, 'fixtures', 'img', rel);
    if (rel.includes('a1-2.webp')) return r.fulfill({ status: 404, body: '' });   // 読めない画像
    fs.existsSync(f) ? r.fulfill({ status: 200, contentType: rel.endsWith('.json') ? 'application/json' : 'image/webp', body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: '' });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(3000);
  const r = await p.evaluate(() => { const c = i => cardsData.find(x => x.id === i); return { a: c('a1-1').thumb, aimg: c('a1-1').img, c3: c('a1-3').thumb.slice(0, 20), saved: !!localStorage.getItem('imgManifest') }; });
  assert(r.a.includes('/__img/A1/t/a1-1.webp?r=1') && r.aimg.includes('/__img/A1/a1-1.webp') && r.c3.startsWith('data:image/svg') && r.saved, JSON.stringify(r));
  const imgs = await p.evaluate(() => [...document.querySelectorAll('img')].filter(i => /a1-[12]\b|a1-[12]\./.test(i.currentSrc || i.src) || (i.dataset.fb && i.closest('.card-item'))).map(i => ({ src: (i.currentSrc || i.src).slice(0, 60), ok: i.naturalWidth > 0, fb: i.dataset.fb || '' })));
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => { const els = [...document.querySelectorAll('img')]; const one = els.find(i => (i.src || '').includes('a1-1.webp')); const two = els.find(i => i.dataset.fb && (i.src || '').startsWith('data:image/svg')); return { one: one && one.naturalWidth > 0, two: !!two }; });
  assert(after.one && after.two, JSON.stringify({ imgs, after }));
  if (process.env.SHOT) { await p.evaluate(() => [...document.querySelectorAll('img')].find(i => (i.src || '').includes('a1-1.webp')).scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); await p.screenshot({ path: process.env.SHOT + '/cardimg_grid.png' });
    await p.evaluate(() => tapCard(cardsData[0], true)); await p.waitForTimeout(800); await p.screenshot({ path: process.env.SHOT + '/cardimg_zoom.png' }); }
  assert(errs.length === 0, errs.join(' / '));
  await ctx.close();
});

test('発音の読み上げ：カード・単語ガイドの🔊ボタン・冒険の聞き取り問題／設定でオフにできる', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 30) } });
  await p.evaluate(() => { window.__said = []; window.speechSynthesis.speak = u => window.__said.push(u.text); window.speechSynthesis.cancel = () => {}; });
  await p.waitForTimeout(1200);
  await p.evaluate(() => tapCard(cardsData[1], true));
  await p.click('#zoomContent .spk-btn'); 
  const z = await p.evaluate(() => ({ said: window.__said.slice(), n: document.querySelectorAll('#zoomContent .spk-btn').length, word: cardsData[1].quiz.answer }));
  assert(z.said[0] === z.word && z.n >= 1, JSON.stringify(z));
  // 聞き取り問題（冒険）：音が流れ、単語は表示しない
  const l = await p.evaluate(async () => {
    closeZoom(); enterAdventureMode(); await new Promise(r => setTimeout(r, 1500)); closeTrainingModal(false); openTrainingMode(); await new Promise(r => setTimeout(r, 500));
    const keep = Math.random; let k = 0; Math.random = () => (k++ < 4 ? 0.1 : keep());
    window.__said = []; const c = cardsData[2]; showQuiz(c); Math.random = keep;
    await new Promise(r => setTimeout(r, 600));
    return { title: document.getElementById('quizTitle').innerText, shown: document.getElementById('quizSentence').innerText.includes(c.quiz.answer), said: window.__said.slice(), word: c.quiz.answer, choices: document.querySelectorAll('#quizChoices .quiz-choice-btn').length };
  });
  assert(l.title.includes('聞き取り') && !l.shown && l.said[0] === l.word && l.choices === 4, JSON.stringify(l));
  // 設定でオフ：ボタンが消える・聞き取り問題も出ない
  const off = await p.evaluate(() => { setSetting('tts', false); closeSettings(); return { on: ttsOn(), btn: spkBtn('test') }; });
  assert(off.on === false && off.btn === '', JSON.stringify(off));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('遊び方の案内：はじめての人に自動で出る・最後まで進める・設定から見直せる', async b => {
  const p = await openApp(b, { seed: { __tutorial: true, cardMergeV1: '1' } });
  await p.waitForTimeout(3500);
  assert(await p.evaluate(() => getComputedStyle(document.getElementById('tutorial')).display === 'flex'), '案内が出ない');
  for (let i = 0; i < 3; i++) await p.click('#tuBox .tu-next');
  assert((await p.evaluate(() => document.querySelector('#tuBox h3').textContent)).includes('覚えるほど'), '最後の画面にならない');
  await p.click('#tuBox .tu-next');
  const r = await p.evaluate(() => ({ shown: getComputedStyle(document.getElementById('tutorial')).display, done: localStorage.getItem('tutorialDone') }));
  assert(r.shown === 'none' && r.done === '1', JSON.stringify(r));
  await p.evaluate(() => { openSettings(); [...document.querySelectorAll('#settingsBox .set-link')].find(b => b.textContent.includes('遊び方')).click(); });
  assert(await p.evaluate(() => getComputedStyle(document.getElementById('tutorial')).display === 'flex'), '設定から開けない');
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('学習レポートは設定画面からだけ開く・力だめしテストはない・苦手な単語の復習', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 30),
    srsData: { 'a1-3': { level: 1, nextReview: 0, correct: 0, incorrect: 3 }, 'a1-5': { level: 1, nextReview: 0, correct: 1, incorrect: 1 } } } });
  await p.waitForTimeout(1500);
  const r0 = await p.evaluate(() => ({ btn: !!document.getElementById('reportBtn'), pt: typeof startPowerTest, link: (() => { openSettings(); return document.getElementById('settings-modal').innerText.includes('学習レポート'); })() }));
  assert(!r0.btn && r0.pt === 'undefined' && r0.link, JSON.stringify(r0));
  const r = await p.evaluate(() => { closeSettings(); updateSRS('a1-7', true); updateSRS('a1-8', false); openReport();
    return { log: studyLog[todayKey()], tiles: document.querySelectorAll('#reportBox .rp-tile').length, charts: document.querySelectorAll('#reportBox svg').length, txt: document.getElementById('reportBox').innerText }; });
  assert(r.log[0] === 2 && r.log[1] === 1 && r.tiles === 4 && r.charts >= 2 && !r.txt.includes('力だめし') && r.txt.includes('文法の試練'), JSON.stringify(r));
  await p.waitForTimeout(800);
  assert((await p.evaluate(() => document.getElementById('reportBox').innerText)).includes('/60'), '文法のクリア数が出ない');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/report.png' });
  // 苦手な単語：まちがえた回数が多い順・復習で★の記録が更新される
  const w = await p.evaluate(() => { closeReport(); openWeak(); const first = document.querySelector('#weakBox .wk-item .w').textContent; startWeakReview(); return { first, word: cardsData.find(c => c.id === 'a1-3').quiz.answer, n: mq.items.length }; });
  assert(w.first === w.word && w.n === 3, JSON.stringify(w));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('レイド画面のボス画像は小さく表示され、画面が左右にはみ出さない', async b => {
  const p = await openApp(b);
  const r = await p.evaluate(async () => {
    raidState = { hp: 30000, dmg: 1200, me: null, maxHits: 3, week: '11/2', ends: '11/9', boss: { nb: 'PT', name: '巨大スライム' }, top: [], reward: 2000, defeated: false };
    document.getElementById('raid-modal').style.display = 'flex'; renderRaid();
    const img = document.querySelector('#raidBox .raid-boss img'); await new Promise(res => img.complete ? res() : (img.onload = res, img.onerror = res));
    const rc = img.getBoundingClientRect(), hp = document.querySelector('#raidBox .raid-hp').getBoundingClientRect();
    return { w: Math.round(rc.width), h: Math.round(rc.height), sw: document.documentElement.scrollWidth, bw: document.getElementById('raidBox').scrollWidth <= document.getElementById('raidBox').clientWidth + 1, hp: Math.round(hp.height) };
  });
  assert(r.w <= 100 && r.h <= 100 && r.sw <= 390 && r.bw && r.hp >= 10, JSON.stringify(r));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/raid-modal.png' });
});

test('文法の試練：冒険の5問に1問・カードは減らない・正解で3倍のXP/G・まちがえると解説', async b => {
  const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'grammar.json'), 'utf8')).items;
  const per = {}; data.forEach(g => { per[g.nb] = (per[g.nb] || 0) + 1; assert(g.c.length === 4 && new Set(g.c).size === 4 && g.q.split('＿＿＿').length === 2 && g.ja && g.ex, g.id); });
  assert(['A1', 'A2', 'B1', 'B2', 'PT'].every(k => per[k] === 60), JSON.stringify(per));
  assert(new Set(data.map(g => g.q)).size === data.length, '同じ問題文がある');
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 20) } });
  assert((await p.evaluate(() => !!document.getElementById('grammarBtn'))) === false, '別ボタンが残っている');
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(2000);
  await p.evaluate(() => { closeTrainingModal(false); openTrainingMode(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { trainingSession.qCount = 2; showTrainingQuiz(); }); await p.waitForTimeout(300);
  const q = await p.evaluate(() => ({ title: document.getElementById('quizTitle').innerText, sent: !!document.querySelector('#quizSentence .gq-sent .bl'), n: document.querySelectorAll('#quizChoices .quiz-choice-btn').length, cards: trainingSession.cards.length }));
  assert(q.title.includes('文法') && q.sent && q.n === 4, JSON.stringify(q));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/adv-grammar-q.png' });
  const x0 = await p.evaluate(() => ({ xp: xpData.totalXP, g: gold, base: Math.round(ADVENTURE_BASE.xp * adventureTier().mult) }));
  await p.evaluate(() => document.querySelector('#quizChoices .quiz-choice-btn[data-correct="1"]').click()); await p.waitForTimeout(1100);
  const r1 = await p.evaluate(() => ({ xp: xpData.totalXP, g: gold, done: Object.keys(grammarDone).length, cards: trainingSession.cards.length, exp: !!document.querySelector('#quizChoices .gq-result.ok'), fill: document.querySelector('#quizSentence .bl').textContent }));
  assert(r1.done === 1 && r1.cards === q.cards && r1.exp && r1.xp - x0.xp >= x0.base * 3, JSON.stringify({ x0, r1 }));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/adv-grammar-ok.png' });
  await p.evaluate(() => [...document.querySelectorAll('#quizChoices .action-btn')].pop().click()); await p.waitForTimeout(400);
  assert(!(await p.evaluate(() => document.getElementById('quizTitle').innerText)).includes('文法'), '文法が続いた');
  await p.evaluate(() => { trainingSession.qCount = 7; showTrainingQuiz(); }); await p.waitForTimeout(300);
  const id2 = await p.evaluate(() => Object.keys(trainingSession.gSeen));
  await p.evaluate(() => document.querySelector('#quizChoices .quiz-choice-btn:not([data-correct])').click()); await p.waitForTimeout(1100);
  const r2 = await p.evaluate(() => ({ ng: !!document.querySelector('#quizChoices .gq-result.ng'), txt: document.querySelector('#quizChoices .gq-result').innerText }));
  assert(id2.length === 2 && id2[0] !== id2[1] && r2.ng && r2.txt.includes('正解は'), JSON.stringify({ id2, r2 }));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/adv-grammar-ng.png' });
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('管理者の全解禁で全手帖・全カード・全タブが開く／アプリ内に管理者キーの文字列がない', async b => {
  const p = await openApp(b);
  // 管理者キーの照合はサーバー側（tests/gas-e2e.js で確認）。ここでは解禁処理そのものを確認
  await p.evaluate(() => { openCouponModal(); adminUnlockAll(); });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ st: notebookState.unlocked.length, owned: unlockedCards.length, tabs: getUnlockedTabCount() }));
  assert(r.st === 5 && r.owned === 8324 && r.tabs === 11, JSON.stringify(r));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert(!src.includes('SHION3215T'), '管理者キーがアプリ内に残っている');
});

test('殿堂入りボスラッシュが開始できる（全手帖コンプリート）', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('a1', 1, 1067).concat(ids('a2', 1, 1352), ids('b1', 1, 2353), ids('b2', 1, 2689), ids('card', 1, 863)) } });
  await p.evaluate(() => startHofBossRush()); await p.waitForTimeout(400);
  assert((await p.evaluate(() => getComputedStyle(document.getElementById('battle-formation-modal')).display)) !== 'none', '編成画面が開かない');
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('殿堂入りへの道は白金の手帖だけに表示・全手帖コンプリートで開く／ボスラッシュはバトル背景', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', unlockedCards: ids('card', 1, 863).concat(['a1-1']),
    notebookState: { unlocked: ['A1', 'PT'], current: 'A1' } } });
  await p.waitForTimeout(1500);
  assert((await p.evaluate(() => getComputedStyle(document.getElementById('hofBtn')).display)) === 'none', '鉄の手帖で殿堂入りボタンが見えている');
  await p.click('#nbChip'); await p.waitForTimeout(300);
  await p.click('.nb-row:has-text("白金の手帖")'); await p.waitForTimeout(2300);
  const h0 = await p.evaluate(() => { updateCollectionProgress(); startHofBossRush(); return { txt: document.getElementById('hofBtn').innerText, shown: getComputedStyle(document.getElementById('hofBtn')).display, alert: (window.__alerts || []).join('|'), rush: hofBossRush.active }; });
  assert(h0.shown !== 'none' && h0.txt.includes('全手帖 残り') && h0.alert.includes('コンプリート') && !h0.rush, JSON.stringify(h0));
  await p.evaluate(() => { adminUnlockAll(); updateCollectionProgress(); });
  assert((await p.evaluate(() => document.getElementById('hofBtn').innerText)).includes('殿堂入りへの道') && !(await p.evaluate(() => document.getElementById('hofBtn').innerText)).includes('残り'), '全コンプで解禁されない');
  await p.evaluate(() => startHofBossRush()); await p.waitForTimeout(400);
  const bg = await p.evaluate(() => getComputedStyle(document.getElementById('bg-layer')).backgroundImage);
  assert(bg.includes('battle/battle.jpg'), '編成中の背景: ' + bg);
  // 歴代の手帖のボス（超強化版）5連戦：鉄→白金の順に強くなる。演出は戦うボスの手帖のもの
  const rush = await p.evaluate(() => ({ list: hofBossRush.bosses.map(b => [b.nb, b.name, b.hp, b.atk, b.img]), fx: battleFxKey() }));
  assert(rush.list.length === 5 && rush.list.map(x => x[0]).join() === 'A1,A2,B1,B2,PT' && rush.list[0][1] === '超・アイアンスライム'
    && rush.list[4][2] > rush.list[0][2] && rush.list[4][3] > rush.list[0][3] && rush.list[2][4].includes('slime_B1') && rush.fx === 'A1', JSON.stringify(rush));
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

test('紙吹雪は新しいカードのときだけ／冒険の道：答えるたびに進み10問で次の地域へ', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.evaluate(() => { window.__cf = 0; window.confetti = () => { window.__cf++; }; });
  const c = await p.evaluate(() => {
    const card = cardsData[0];
    gachaSession.selectedCard = card; evaluateAndShowGachaResult(true);
    return card.id;
  });
  await p.waitForTimeout(700);
  const first = await p.evaluate(() => window.__cf);
  await p.evaluate(() => { closeGacha && document.getElementById('gacha-overlay') && (document.getElementById('gacha-overlay').style.display = 'none');
    window.__cf = 0; gachaSession.selectedCard = cardsData[0]; evaluateAndShowGachaResult(true); });
  await p.waitForTimeout(700);
  const second = await p.evaluate(() => window.__cf);
  assert(first > 0 && second === 0, `紙吹雪 新:${first} 被り:${second}`);
  await p.evaluate(() => { document.getElementById('gacha-overlay').style.display = 'none'; enterAdventureMode(); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { closeTrainingModal(false); openTrainingMode(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { advState().step = 5; });   // 1面は10問：残り5問から
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => { trainingSession.qCount = 0; const btn = document.querySelector('.quiz-choice-btn[data-correct]'); btn.click(); });
    await p.waitForTimeout(1500);
    await p.evaluate(() => { const bs = [...document.querySelectorAll('#quizChoices .action-btn')]; bs[bs.length - 1].click(); });
    await p.waitForTimeout(300);
  }
  const a = await p.evaluate(() => ({ adv: trainingSession.adv, trail: !!document.getElementById('advTrail') && document.getElementById('advTrail').style.display !== 'none' }));
  assert(a.trail && a.adv.area === 1 && a.adv.step === 0 && a.adv.streak === 5, JSON.stringify(a));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('バトル突入・帰還の演出／ボスは下位の手帖ほど小さく白金ほど大きい', async b => {
  const sizes = {};
  for (const nb of (process.env.SHOT ? ['A1', 'A2', 'B1', 'B2', 'PT'] : ['A1', 'PT'])) {
    const p = await openApp(b, { seed: { cardMergeV1: '1', notebookState: { unlocked: ['A1', 'A2', 'B1', 'B2', 'PT'], current: nb } } });
    await p.evaluate(() => { cardsData.slice(0, 30).forEach(c => { if (!unlockedCards.includes(c.id)) unlockedCards.push(c.id); }); });
    await formParty(p, 0);
    await p.evaluate(() => confirmFormationAndStart());
    await p.waitForTimeout(300);
    const cls = await p.evaluate(() => document.getElementById('battle-trans').className);
    assert(cls.includes('enter'), '突入演出なし: ' + cls);
    await p.waitForTimeout(1600);
    sizes[nb] = await p.evaluate(() => parseInt(document.getElementById('battleEnemyImg').style.maxHeight, 10));
    // 手帖ごとの演出（鉄＝火花…白金＝雷とオーロラ）
    const fx = await p.evaluate(() => { const f = document.getElementById('battle-fx'); return { cls: f.className, n: f.querySelectorAll('.p').length, aurora: !!f.querySelector('.bfx-aurora'), shown: getComputedStyle(f).display }; });
    assert(fx.cls === nb && fx.n >= 10 && fx.aurora === (nb === 'PT') && fx.shown === 'block', JSON.stringify(fx));
    if (process.env.SHOT) { await p.waitForTimeout(1500); await p.screenshot({ path: process.env.SHOT + '/bfx_' + nb + '.png' }); }
    await p.evaluate(() => confirmCloseBattle());
    await p.waitForTimeout(300);
    assert((await p.evaluate(() => document.getElementById('battle-trans').className)).includes('flee'), '逃げる演出なし');
    await p.waitForTimeout(1500);
    assert(await p.evaluate(() => getComputedStyle(document.getElementById('battle-fx')).display === 'none'), 'バトル後も演出が残る');
    await p.waitForTimeout(1300);
    assert(await p.evaluate(() => document.getElementById('battle-overlay').style.display === 'none' && !document.body.classList.contains('battle-mode')), '帰還後にバトル画面が残っている');
    assert(p.__errors.length === 0, p.__errors.join(' / '));
  }
  assert(sizes.A1 < sizes.PT, JSON.stringify(sizes));
});

test('カードを探す：名称・新カードは1日100枚まで（探す回数は無制限）・40分で休憩のすすめ', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.waitForTimeout(2600);
  assert((await p.evaluate(() => document.getElementById('gachaBtn').innerText)).includes('カードを探す'), 'ボタン名');
  // 探した回数が多くても、新カードの残りがあれば探せる
  const r = await p.evaluate(() => { gold = 99999; dailyGachaStorage.draws = 500; newCardsLeftToday(); dailyGachaStorage.newCount = 98;
    window.__alerts = []; const before = gold; drawCard('normal'); return { spent: before - gold, alerts: window.__alerts.slice() }; });
  assert(r.spent === 50 && r.alerts.length === 0, JSON.stringify(r));
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => { dailyGachaStorage.newCount = 97; return [multiDrawCount('normal'), multiDrawCount('premium')]; });
  assert(m[0] === 3 && m[1] === 3, 'まとめて探す回数: ' + m);
  const r2 = await p.evaluate(() => { dailyGachaStorage.newCount = 100; window.__alerts = []; const before = gold; drawCard('premium'); startGachaViaButton();
    return { spent: before - gold, alerts: window.__alerts.slice(), multi: multiDrawCount('normal') }; });
  assert(r2.spent === 0 && r2.alerts.length === 2 && r2.alerts[0].includes('100 枚まで') && r2.multi === 0, JSON.stringify(r2));
  const toast = await p.evaluate(() => { _playStart = Date.now() - 41 * 60000; _lastActive = Date.now(); wellbeingTick(); return document.getElementById('challengeToast').textContent; });
  assert(toast.includes('目を休めよう'), toast);
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('穴埋め問題：例文ごとに確認した固定ダミーから選ぶ（どちらでも正解になる選択肢を出さない）', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.waitForTimeout(2600);
  const r = await p.evaluate(() => {
    const card = cardsData.find(c => c.id === 'a1-605');
    const fixed = fbDistractors(card);
    let seen = 0, bad = [];
    for (let i = 0; i < 30 && seen < 5; i++) {
      showQuiz(card);
      if (!document.getElementById('quizTitle').innerText.includes('穴埋め')) continue;
      seen++;
      [...document.querySelectorAll('#quizChoices .quiz-choice-btn')].map(b => b.textContent.toLowerCase())
        .forEach(w => { if (w !== card.quiz.answer.toLowerCase() && !fixed.map(x => x.toLowerCase()).includes(w)) bad.push(w); });
    }
    document.getElementById('quiz-overlay').style.display = 'none';
    return { n: fixed && fixed.length, seen, bad };
  });
  assert(r.n >= 3 && r.seen >= 1 && r.bad.length === 0, JSON.stringify(r));
  // 俗語の意味（real＝本当に〈口語〉）は穴埋めに出さない／書き直した例文（light）は新しい文と手で選んだダミー
  const r2 = await p.evaluate(() => {
    const real = cardsData.find(c => c.id === 'a1-745'); real._si = 1; const skip1 = fbSkip(real); real._si = 0; const skip0 = fbSkip(real);
    const light = cardsData.find(c => c.id === 'a1-536'); light._si = 0;
    return { skip1, skip0, ex: light.quiz.example, d: fbDistractors(light) };
  });
  assert(r2.skip1 && !r2.skip0 && r2.ex.includes('only one small book') && r2.d.includes('hungry'), JSON.stringify(r2));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('まとめて探す：最大10回・ゴールドと今日の残り回数を消費・結果一覧', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.waitForTimeout(2600);
  const r = await p.evaluate(() => { gold = 1200; saveGold(); const before = unlockedCards.length; drawMulti('normal');
    return { gold, cards: document.querySelectorAll('#mdGrid .md-card').length, shown: document.getElementById('multi-draw-overlay').style.display, gained: unlockedCards.length - before }; });
  assert(r.gold === 700 && r.cards === 10 && r.shown === 'flex' && r.gained >= 1, JSON.stringify(r));
  // 演出：最初は裏向き・OKは隠れている → 順にめくれて、最後にOKが出る。タップで全部めくれる
  const s0 = await p.evaluate(() => ({ open: document.querySelectorAll('#mdGrid .md-card.open').length, sum: document.getElementById('multi-draw-overlay').classList.contains('summoning'), circle: !!document.querySelector('.md-circle') }));
  assert(s0.open === 0 && s0.sum && s0.circle, '開始 ' + JSON.stringify(s0));
  await p.waitForTimeout(3300);   // SR/URの「ため」があっても最初の1枚はめくれている
  const s1 = await p.evaluate(() => document.querySelectorAll('#mdGrid .md-card.open').length);
  assert(s1 >= 1, '順にめくれない ' + s1);
  await p.click('#mdGrid'); await p.waitForTimeout(100);
  const s2 = await p.evaluate(() => ({ open: document.querySelectorAll('#mdGrid .md-card.open').length, sum: document.getElementById('multi-draw-overlay').classList.contains('summoning') }));
  assert(s2.open === 10 && !s2.sum, 'タップで全部 ' + JSON.stringify(s2));
  const r2 = await p.evaluate(() => { gold = 250; dailyGachaStorage.draws = 0; return multiDrawCount('premium'); });
  assert(r2 === 2, 'premium count ' + r2);
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('存在しないタブの撃破記録を削除（鉄のタブ12など）／出典表記', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', battleProgress: { defeated: ['a1_tab3_mid', 'a1_tab10_final', 'a1_tab11_final', 'a1_tab11_mid', 'tab8_final', 'tab9_final', 'b2_tab26_final', 'b2_tab27_final', 'hof_tab8_final'] } } });
  const d = await p.evaluate(() => JSON.parse(localStorage.getItem('battleProgress')).defeated.sort());
  assert(JSON.stringify(d) === JSON.stringify(['a1_tab10_final', 'a1_tab3_mid', 'b2_tab26_final', 'hof_tab8_final', 'tab8_final']), JSON.stringify(d));
  const credit = await p.evaluate(() => document.getElementById('nb-picker').innerText);
  assert(credit.includes('CEFR-J Wordlist') && credit.includes('投野'), '出典表記がない');
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('レベル判定テスト：はじめての人に自動で出る／全問正解で白金まで開く／スキップできる', async b => {
  const p = await openApp(b, { seed: { __placement: true, cardMergeV1: '1' } });
  await p.waitForTimeout(1500);
  assert(await p.evaluate(() => getComputedStyle(document.getElementById('placement-overlay')).display === 'flex'), '自動で出ない');
  await p.click('#placementBox .pl-start');
  for (let i = 0; i < 30; i++) {
    await p.waitForTimeout(700);
    const done = await p.evaluate(() => !!document.querySelector('#placementBox .pl-result-nb'));
    if (done) break;
    await p.evaluate(() => { const it = placement.queue[placement.qi]; const k = it.choices.indexOf(it.q.meaning);
      document.querySelectorAll('#placementBox .pl-choices button')[k].click(); });
  }
  const r = await p.evaluate(() => ({ nb: document.querySelector('#placementBox .pl-result-nb').textContent, asked: placement.asked }));
  assert(r.nb === '白金の手帖' && r.asked === 18, JSON.stringify(r));
  await p.click('#placementBox .pl-start'); await p.waitForTimeout(2600);
  const st = await p.evaluate(() => ({ cur: currentNB.key, un: notebookState.unlocked.join(','), done: localStorage.getItem('placementDone') }));
  assert(st.cur === 'PT' && st.un === 'A1,A2,B1,B2,PT' && st.done === '1', JSON.stringify(st));
  // スキップ
  const p2 = await openApp(b, { seed: { __placement: true, cardMergeV1: '1' } });
  await p2.waitForTimeout(1500);
  await p2.click('#placementBox .pl-skip'); await p2.waitForTimeout(300);
  const s2 = await p2.evaluate(() => ({ shown: getComputedStyle(document.getElementById('placement-overlay')).display, cur: currentNB.key, done: localStorage.getItem('placementDone') }));
  assert(s2.shown === 'none' && s2.cur === 'A1' && s2.done === 'skip', JSON.stringify(s2));
  // 問題・選択肢はランダムで、同じ問題の選択肢に「どちらでも正解」になる組み合わせがない
  const amb = await p2.evaluate(async () => {
    let bad = [], firsts = new Set();
    for (const k of ['A1', 'B1', 'PT']) {
      const items = await placementItems(k);
      for (let n = 0; n < 15; n++) {
        const qs = await placementQuestions(k);
        firsts.add(qs[0].q.answer);
        qs.forEach(x => { const its = x.choices.map(m => items.find(i => i.meaning === m));
          for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (plClash(its[i], its[j])) bad.push(its[i].answer + '/' + its[j].answer); });
      }
    }
    return { bad, variety: firsts.size };
  });
  assert(amb.bad.length === 0 && amb.variety >= 20, JSON.stringify(amb));
  // カードが0枚のままなら、次に開いたとき（別のタブ）にまた出る。カードを持っていれば出ない
  const p4 = await openApp(b, { seed: { __placement: true, cardMergeV1: '1', placementDone: 'skip' } });
  await p4.waitForTimeout(1500);
  assert(await p4.evaluate(() => getComputedStyle(document.getElementById('placement-overlay')).display !== 'none'), 'カード0枚で出ない');
  const p5 = await openApp(b, { seed: { __placement: true, cardMergeV1: '1', placementDone: 'skip', unlockedCards: ['a1-1'] } });
  await p5.waitForTimeout(1500);
  assert(await p5.evaluate(() => getComputedStyle(document.getElementById('placement-overlay')).display === 'none'), 'カードがあるのに出る');
  // 全問「わからない」→ 鉄
  const p3 = await openApp(b, { seed: { __placement: true, cardMergeV1: '1' } });
  await p3.waitForTimeout(1500);
  await p3.click('#placementBox .pl-start');
  // 1問目は時間切れ（12秒）→ 不正解あつかい。残りは「わからない」
  await p3.waitForTimeout(800);
  assert(await p3.evaluate(() => !!document.querySelector('#placementBox .qt-wrap')), '制限時間のバーがない');
  await p3.waitForTimeout(12600);
  assert(await p3.evaluate(() => placement.asked === 1 && placement.correct === 0), '時間切れが不正解にならない');
  for (let i = 0; i < 30; i++) { await p3.waitForTimeout(700); if (await p3.evaluate(() => !!document.querySelector('#placementBox .pl-result-nb'))) break; await p3.evaluate(() => { const x = document.querySelector('#placementBox .pl-idk'); x && !x.disabled && x.click(); }); }
  assert((await p3.evaluate(() => document.querySelector('#placementBox .pl-result-nb').textContent)) === '鉄の手帖', '鉄にならない');
  assert(p.__errors.length + p2.__errors.length + p3.__errors.length === 0, [...p.__errors, ...p2.__errors].join(' / '));
});

test('冒険：地域ごとに背景が変わる・正解で演出が出る／時間ボーナスは「時間をあけて」の表記', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1', advArea: '3' } });
  await p.evaluate(() => enterAdventureMode()); await p.waitForTimeout(2000);
  const txt = await p.evaluate(() => document.getElementById('trainingModalContent').innerText);
  assert(txt.includes('時間をあけて') && !txt.includes('8時間後冒険'), '時間ボーナスの表記');
  await p.evaluate(() => { closeTrainingModal(false); openTrainingMode(); }); await p.waitForTimeout(500);
  const bg = await p.evaluate(() => getComputedStyle(document.getElementById('bg-layer')).backgroundImage);
  // 以前の3＝遺跡（草原を先頭に足して4）だが、鉄の手帖は1〜3面までなので3面（洞窟）にとどまる
  assert(bg.includes('adv_cave_'), '背景（鉄の手帖は洞窟まで）: ' + bg);
  // 天空の城：夜（22時）は夜の絵、色合いはかけない
  await p.evaluate(() => { window.__todHour = 22; advSetBackground(6); }); await p.waitForTimeout(1400);
  const c = await p.evaluate(() => ({ bg: document.body.style.getPropertyValue('--adv-bg'), op: document.body.style.getPropertyValue('--tod-op') }));
  assert(c.bg.includes('adv_castle_night.jpg') && c.op === '0', '天空の城の夜: ' + JSON.stringify(c));
  // 時間帯ごとの絵がある「はじまりの草原」は、絵が切り替わり色合いはかけない
  await p.evaluate(() => { window.__todHour = 22; advSetBackground(0); });
  const mid = await p.evaluate(() => document.getElementById('bg-layer').style.opacity);
  await p.waitForTimeout(1400);
  const m = await p.evaluate(() => ({ bg: document.body.style.getPropertyValue('--adv-bg'), op: document.body.style.getPropertyValue('--tod-op'), layer: document.getElementById('bg-layer').style.opacity }));
  assert(mid === '0' && m.layer === '1', `フェードアウト→イン ${mid} → ${m.layer}`);
  assert(m.bg.includes('adv_meadow_night.jpg') && m.op === '0', JSON.stringify(m));
  await p.evaluate(() => { window.__todHour = 17; advApplyTimeOfDay(); });
  await p.waitForTimeout(1400);
  const e = await p.evaluate(() => document.body.style.getPropertyValue('--adv-bg'));
  assert(e.includes('adv_meadow_evening.jpg'), e);
  await p.evaluate(() => { trainingSession.qCount = 0; document.querySelector('.quiz-choice-btn[data-correct]').click(); }); await p.waitForTimeout(150);
  assert(await p.evaluate(() => !!document.querySelector('#advFx .fx-word')), '正解の演出が出ない');
  // 不正解では進まない／必要な正解数は10問ずつ増える（草原10・森20・城70）／進み具合は保存される
  const r = await p.evaluate(() => {
    const a = advState(); a.area = 1; a.step = 3; a.miss = 0; advRender('');
    const before = document.querySelector('#advTrail .adv-count').textContent;
    advAfterAnswer(false);
    const afterNg = document.querySelector('#advTrail .adv-count').textContent;
    advAfterAnswer(true);
    return { before, afterNg, afterOk: document.querySelector('#advTrail .adv-count').textContent, saved: JSON.parse(localStorage.getItem('advProg')).A1.step, miss: JSON.parse(localStorage.getItem('advProg')).A1.miss, need: [0,1,6].map(advNeed) };
  });
  assert(r.before === '3 / 20' && r.afterNg === '3 / 20' && r.afterOk === '4 / 20' && r.saved === 4 && r.miss === 1, JSON.stringify(r));
  assert(r.need.join() === '10,20,70', r.need.join());
  // 長い道はゲージ表示。鉄の手帖の最終面（3面・洞窟）を踏破しても、その地にとどまる
  const g = await p.evaluate(() => {
    const a = advState(); a.area = 2; a.step = 29; advRender('');
    const fill = !!document.querySelector('#advTrail .adv-fill') && document.querySelectorAll('#advTrail .adv-node').length === 0;
    advAfterAnswer(true); advBeforeQuestion();
    return { fill, area: advState().area, step: JSON.parse(localStorage.getItem('advProg')).A1.step, t: (document.querySelector('#advClear .t3') || {}).textContent };
  });
  assert(g.fill && g.area === 2 && g.step === 0 && g.t.includes('最終地点'), JSON.stringify(g));
  // 金の手帖は6面まで行ける（進み具合は手帖ごと）。4面→5面へ進む
  const g2 = await p.evaluate(() => {
    currentNB = NB_BY_KEY.B2; const a = advState(); const fresh = a.area === 0 && a.step === 0;
    a.area = 3; a.step = 39; advRender(''); advAfterAnswer(true); advBeforeQuestion();
    const r = { fresh, area: advState().area, last: advLast(), t: document.querySelector('#advClear .t3').textContent };
    currentNB = NB_BY_KEY.A1; r.a1 = advState().area; return r;
  });
  assert(g2.fresh && g2.area === 4 && g2.last === 5 && g2.t.includes('50問') && g2.a1 === 2, JSON.stringify(g2));
  // 冒険をやめると、次はまた1面から（今の手帖の進み具合を0に）
  const q = await p.evaluate(() => { const a = advState(); a.area = 2; a.step = 7; advSave(a); adventureActive = true; exitAdventureMode();
    return { p: JSON.parse(localStorage.getItem('advProg')).A1, s: trainingSession.adv, castle: advBgmSrc(6), mountain: advBgmSrc(5), ruins: advBgmSrc(4), hill: advBgmSrc(3), forest: advBgmSrc(1), meadow: advBgmSrc(0), cave: advBgmSrc(2) }; });
  assert(q.p.area === 0 && q.p.step === 0 && q.s === null && q.castle === './bgm/adv/bgm_castle.mp3' && q.forest === './bgm/adv/bgm_forest.mp3' && q.meadow === './bgm/adv/bgm_meadow.mp3' && q.cave === './bgm/adv/bgm_cave.mp3' && q.hill === './bgm/adv/bgm_hill.mp3' && q.ruins === './bgm/adv/bgm_ruins.mp3' && q.mountain === './bgm/adv/bgm_mountain.mp3', JSON.stringify(q));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('バトルの問題に制限時間：時間切れは不正解あつかいでバトルに戻る', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.evaluate(() => { cardsData.slice(0, 30).forEach(c => { if (!unlockedCards.includes(c.id)) unlockedCards.push(c.id); }); });
  await formParty(p, 0);
  await p.evaluate(() => confirmFormationAndStart());
  await p.waitForTimeout(2000);
  await p.evaluate(() => { BATTLE_TIME.normal = 2; BATTLE_TIME.fillBlank = 2; });
  await p.evaluate(() => { document.querySelectorAll('.bplan-col').forEach((c, i) => setBattlePlan(i, 'attack')); confirmBattlePlan(); });
  await p.waitForTimeout(400);
  assert(await p.evaluate(() => !!document.querySelector('#quiz-overlay .qt-wrap')), 'バーがない');
  await p.waitForTimeout(4500);
  const r = await p.evaluate(() => ({ quiz: getComputedStyle(document.getElementById('quiz-overlay')).display, bar: !!document.querySelector('.qt-wrap') }));
  assert(r.quiz === 'none' && !r.bar, JSON.stringify(r));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('バトルの問題で「わからない」を押しても進行不能にならない（不正解あつかいで次のターンへ）／冒険は終わらない', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  await p.evaluate(() => { cardsData.slice(0, 30).forEach(c => { if (!unlockedCards.includes(c.id)) unlockedCards.push(c.id); }); });
  await formParty(p, 0);
  await p.evaluate(() => { adventureActive = true; confirmFormationAndStart(); });
  await p.waitForTimeout(2000);
  const turn0 = await p.evaluate(() => battleSession.turnCount);
  await p.evaluate(() => { document.querySelectorAll('.bplan-col').forEach((c, i) => setBattlePlan(i, 'attack')); confirmBattlePlan(); });
  await p.waitForTimeout(400);
  const lbl = await p.evaluate(() => document.getElementById('quizQuitBtn').textContent);
  assert(lbl.includes('わからない'), lbl);
  await p.evaluate(() => document.getElementById('quizQuitBtn').click());
  await p.waitForTimeout(4500);
  const r = await p.evaluate(() => ({ quiz: getComputedStyle(document.getElementById('quiz-overlay')).display, active: battleSession.active, turn: battleSession.turnCount,
    adv: adventureActive, plan: !!document.querySelector('.bplan-col') || battleSession.enemyHP <= 0 || battleSession.playerHP <= 0, lbl: document.getElementById('quizQuitBtn').textContent }));
  assert(r.quiz === 'none' && r.adv === true && r.lbl === 'やめる' && (r.turn > turn0 || !r.active) && r.plan, JSON.stringify({ turn0, r }));
  assert(p.__errors.length === 0, p.__errors.join(' / '));
});

test('バトル突入：ボスの絵の準備ができるまで帯は閉じたまま（遅いときは読み込み中の表示）→ 準備ができたら開く', async b => {
  const p = await openApp(b, { seed: { cardMergeV1: '1' } });
  // ボスの絵の読み込みを2.5秒遅らせる（通信が遅い端末のつもり）
  await p.__ctx.route(/\/boss\/slime_.*\.webp/, async r => { await new Promise(res => setTimeout(res, 2500)); await r.continue(); });
  await p.evaluate(() => { cardsData.slice(0, 30).forEach(c => { if (!unlockedCards.includes(c.id)) unlockedCards.push(c.id); }); });
  await formParty(p, 0);
  await p.evaluate(() => confirmFormationAndStart());
  await p.waitForTimeout(1700);
  const s1 = await p.evaluate(() => { const el = document.getElementById('battle-trans'); return { enter: el.classList.contains('enter'), open: el.classList.contains('open'), loading: el.classList.contains('loading'), active: battleSession.active }; });
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/battle-loading.png' });
  assert(s1.enter && !s1.open && s1.loading && s1.active, '準備中なのに帯が開いた／読み込み中が出ない ' + JSON.stringify(s1));
  await p.waitForTimeout(2600);
  const s2 = await p.evaluate(() => { const el = document.getElementById('battle-trans'), img = document.getElementById('battleEnemyImg'); return { cls: el.className, img: getComputedStyle(img).display, loaded: !!img.getAttribute('data-loaded-src') }; });
  assert(!s2.cls.includes('enter') && s2.loaded && s2.img === 'block', JSON.stringify(s2));
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
  for (const t of tests.filter(t => !process.env.ONLY || t.name.includes(process.env.ONLY))) {
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
