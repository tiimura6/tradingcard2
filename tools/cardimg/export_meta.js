// カード画像の合成に使う情報（単語・品詞・意味・レアリティ・手帖の色）をアプリから書き出す
// 使い方: python3 -m http.server 8765 を起動してから
//   NODE_PATH=$(npm root -g) node tools/cardimg/export_meta.js tools/cardimg/card_meta.json
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route(/fonts\.googleapis|fonts\.gstatic/, r => r.abort());
  await p.route('**/index.html', async r => { const res = await r.fetch(); let t = await res.text(); t = t.replace(/const GAS_URL\s*=\s*'[^']*'/, "const GAS_URL = ''"); r.fulfill({ response: res, body: t }); });
  await p.addInitScript(() => { localStorage.setItem('placementDone', 'test'); localStorage.setItem('cardMergeV1', '1'); });
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2500);
  const out = await p.evaluate(() => {
    const res = [], keep = currentNB;
    for (const nb of NOTEBOOKS) {
      currentNB = nb;   // レアリティは手帖ごとの決め方があるので、その手帖を開いた状態で計算する
      const cards = nb.key === 'PT' ? buildCardsFor(nb) : buildCardsFor(nb, loadNotebookRows(nb));
      for (const c of cards) {
        const q = c.quiz || {}, ss = cardSenses(c);
        const ja = ss.length > 1 ? ss.slice(0, 3).map(x => String(x.meaning || '').split(/[／\/]/)[0])
                                 : String(q.meaning || '').split(/[／\/]/).filter(Boolean).slice(0, 3);
        res.push({ id: c.id, nb: nb.key, no: c.no, word: q.answer || '', pos: posAll(c), ja, rarity: getRarity(c.no), nbName: nb.name, colors: nb.c });
      }
    }
    currentNB = keep;
    return res;
  });
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
  console.log(out.length + ' cards');
  await b.close();
})();
