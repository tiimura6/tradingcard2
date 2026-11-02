"""穴埋め問題のダミー候補を作る（AIで「文脈に入らない」ものを選ぶ前の段階）
入力: アプリから書き出した全カード（all.json）  出力: チャンクごとのTSV
1行 = キー(id#意味番号) / 空欄つき例文 / 正解 / 候補14語（同じ手帖・同じ品詞、類義語・反対語・同じ訳は除く）"""
import json, random, re, sys, os
src, outdir = sys.argv[1], sys.argv[2]
random.seed(20261102)
d = json.load(open(src))
def npos(p): return re.sub(r'[.\s]', '', p or '').lower()
def segs(m): return {re.sub(r'[（(].*?[）)]|[〜～]', '', t).strip() for t in re.split(r'[／/、,;；]', m or '')} - {''}
items = []
for nb, cards in d.items():
    pool = {}
    for c in cards:
        for q in c['senses']:
            pool.setdefault(npos(q['pos']), {})[q['answer']] = segs(q['meaning'])
    allw = {w: s for p in pool.values() for w, s in p.items()}
    for c in cards:
        mysegs = set().union(*[segs(q['meaning']) for q in c['senses']])
        myans = {q['answer'].lower() for q in c['senses']}
        ex = {w.lower() for w in c['excl']}
        for si, q in enumerate(c['senses']):
            exm, form = q['example'], q['form'] or q['answer']
            if not exm or (nb != 'PT' and not q['form']): continue
            m = re.search(r'\b' + re.escape(form) + r'\b', exm, re.I) or re.search(re.escape(form), exm, re.I)
            sent = (exm[:m.start()] + '(___)' + exm[m.end():]) if m else '(___) — ' + exm
            before = exm[:m.start()].lower().rstrip() if m else ''
            art = 'an' if re.search(r'\ban$', before) else 'a' if re.search(r'\ba$', before) else None
            def okw(w):
                if w.lower() in myans or w.lower() in ex: return False
                if allw.get(w, set()) & mysegs: return False
                if art == 'an' and not re.match(r'[aeiou]', w, re.I): return False
                if art == 'a' and re.match(r'[aeiou]', w, re.I): return False
                return True
            same = [w for w in pool.get(npos(q['pos']), {}) if okw(w)]
            random.shuffle(same)
            cands = same[:14]
            if len(cands) < 14:
                other = [w for w in allw if okw(w) and w not in cands]; random.shuffle(other)
                cands += other[:14 - len(cands)]
            items.append((f"{c['id']}#{si}", sent.replace('\t', ' '), q['answer'], cands, nb))
os.makedirs(outdir, exist_ok=True)
N = 350
for k in range(0, len(items), N):
    with open(f'{outdir}/chunk_{k // N:02d}.tsv', 'w') as f:
        for key, sent, ans, cands, nb in items[k:k + N]:
            f.write(f"{key}\t{sent}\t{ans}\t{' | '.join(cands)}\n")
print(len(items), 'items,', (len(items) + N - 1) // N, 'chunks')
