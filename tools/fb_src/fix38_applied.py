import csv, json, re, io
S = '/tmp/claude-0/-home-claude/bd8809dc-b381-5b5f-adba-1de8b45514fc/scratchpad'
d = json.load(open(f'{S}/fb/all.json'))
by = {c['id']: c for v in d.values() for c in v}
# key: (new example, new JA, form, distractors)
A = {
 'a1-536#0': ('The bag is very light because there is only one small book in it.', '小さな本が1冊しか入っていないので、そのかばんはとても軽い。', 'light', ['hungry', 'angry', 'kind', 'busy', 'sorry', 'tired']),
 'a1-771#0': ('The little girl was sad when her red balloon flew away.', '赤い風船が飛んでいってしまい、女の子は悲しかった。', 'sad', ['tall', 'free', 'square', 'cheap', 'empty', 'rich']),
 'a1-836#0': ('The village smith made horseshoes and nails in his hot workshop.', '村の鍛冶屋は、暑い仕事場で蹄鉄や釘を作った。', 'smith', ['baby', 'student', 'singer', 'nurse', 'dentist', 'pilot']),
 'a2-22#0': ('My aunt works in advertising and makes TV commercials for new snacks.', 'おばは広告業界で働いていて、新しいお菓子のテレビCMを作っている。', 'advertising', ['agriculture', 'surgery', 'farming', 'astronomy', 'plumbing', 'fishing']),
 'a2-106#0': ('She banks half of her pay every month to save money for a trip abroad.', '彼女は海外旅行のお金をためるため、毎月給料の半分を預金している。', 'banks', ['wastes', 'burns', 'hides', 'loses', 'steals', 'borrows']),
 'a2-124#0': ('This gentle hill is perfect for beginners on skis.', 'このなだらかな丘は、スキーの初心者にぴったりだ。', 'beginners', ['grandparents', 'experts', 'champions', 'professionals', 'babies', 'fish']),
 'a2-484#0': ('The fisherman watched his red float move up and down on the water, waiting for a fish to bite.', '釣り人は魚が食いつくのを待ちながら、水面で上下する赤い浮きを見つめていた。', 'float', ['tent', 'sofa', 'pillow', 'ladder', 'kettle', 'carpet']),
 'a2-534#0': ('The good-looking actor smiled at the camera, and all his fans screamed with joy.', '顔立ちのよいその俳優がカメラに笑いかけると、ファンはみんな大喜びで叫んだ。', 'good-looking', ['ugly', 'unknown', 'boring', 'dull', 'unpopular', 'rude']),
 'b1-414#0': ('Mozart composed his first piece of music when he was only five.', 'モーツァルトはわずか5歳で最初の曲を作曲した。', 'composed', ['erased', 'destroyed', 'swallowed', 'arrested', 'harvested', 'vacuumed']),
 'b1-1903#0': ('The children drew pictures of dragons on the sidewalk with colored chalk.', '子どもたちは色チョークで歩道に竜の絵を描いた。', 'sidewalk', ['ceiling', 'sky', 'river', 'soup', 'cloud', 'moon']),
 'b1-1917#0': ('She won the women\'s singles at the tennis tournament last summer.', '彼女は去年の夏、テニス大会の女子シングルスで優勝した。', 'singles', ['receipts', 'spoons', 'curtains', 'umbrellas', 'pillows', 'socks']),
 'b2-248#0': ('Write the Japanese meaning in brackets after each new word, like this: apple (りんご).', '新しい単語のあとに、apple（りんご）のように日本語の意味をかっこに入れて書きなさい。', 'brackets', ['buckets', 'pockets', 'tunnels', 'envelopes', 'drawers', 'baskets']),
 'b2-288#0': ('The workers laid a thick cable under the sea to carry electricity to the island.', '作業員たちは島へ電気を送るため、海底に太いケーブルを敷いた。', 'cable', ['carpet', 'blanket', 'mirror', 'statue', 'cushion', 'painting']),
 'b2-622#0': ('The mayor dignified the small ceremony by attending in his formal robes.', '市長が正装で出席したことで、その小さな式典に威厳が加わった。', 'dignified', ['cancelled', 'ruined', 'mocked', 'disturbed', 'insulted', 'spoiled']),
 'b2-1882#0': ('The ravages of the long war could still be seen in the ruined buildings of the old city.', '長い戦争による荒廃の跡は、古い都市の崩れた建物にまだ見ることができた。', 'ravages', ['blessings', 'celebrations', 'rewards', 'harvests', 'festivals', 'luxuries']),
 'card-644#0': ('The simple tools on the old workbench were not beautiful, but they were very practical for daily work.', '古い作業台の上の簡素な道具は美しくはなかったが、毎日の仕事にはとても実用的だった。', 'practical', ['useless', 'decorative', 'fragile', 'imaginary', 'broken', 'invisible']),
 'card-664#0': ('The old wooden door was prone to stick in wet weather, so we had to push it hard.', 'その古い木の扉は雨の日にはひっかかりがちだったので、強く押さなければならなかった。', 'prone to stick', ['refuse to', 'manage to do', 'pretend to do', 'happen to do', 'be eager to do', 'fail to do']),
 'card-668#0': ('The mother bird was very protective of her eggs and chased away every cat that came near.', '母鳥は卵をとても守ろうとして、近づいてくる猫をすべて追い払った。', 'protective', ['careless', 'tired', 'ignorant', 'jealous', 'forgetful', 'ashamed']),
 'card-726#0': ('The farm sells most of its vegetables to restaurants, but it also sells some by retail at a small shop near the gate.', 'その農場は野菜の大半をレストランに卸しているが、門の近くの小さな店で小売りもしている。', 'retail', ['surgery', 'gravity', 'poetry', 'grammar', 'weather', 'geometry']),
 'card-749#0': ('The fossils on the table were arranged in sequence, from the oldest to the newest.', 'テーブルの上の化石は、古いものから新しいものへと順序どおりに並べられていた。', 'sequence', ['danger', 'silence', 'debt', 'tears', 'trouble', 'vain']),
 'card-802#0': ('Students who sleep well tend to remember more of what they study.', 'よく眠る生徒は、勉強した内容をより多く覚えている傾向がある。', 'tend to remember', ['refuse to', 'pretend to do', 'fail to do', 'hesitate to do', 'be reluctant to do', 'forget to do']),
}
SKIP = ['a1-745#1', 'a2-1317#0', 'b1-1431#1', 'b1-1933#0', 'b1-2334#0', 'b2-221#1', 'b2-230#0', 'b2-249#0', 'b2-363#0',
        'b2-537#0', 'b2-984#0', 'b2-1023#0', 'b2-1059#0', 'b2-1066#0', 'b2-1858#0', 'b2-2061#0', 'b2-2219#0']
assert len(A) + len(SKIP) == 38
for k, (ex, ja, form, ds) in A.items():
    assert re.search(r'(?<![A-Za-z])' + re.escape(form) + r'(?![A-Za-z])', ex, re.I) or k.startswith('card'), k
# CSV (A1–B2)
nbk = {'a1': 'A1', 'a2': 'A2', 'b1': 'B1', 'b2': 'B2'}
raw = open('data/cefrj_notebooks.csv', encoding='utf-8-sig', newline='').read()
rows = list(csv.DictReader(io.StringIO(raw)))
fields = list(rows[0].keys())
done = set()
for k, (ex, ja, form, ds) in A.items():
    cid, si = k.split('#'); pre = cid.split('-')[0]
    old = by[cid]['senses'][int(si)]
    if pre == 'card': continue
    hit = [r for r in rows if r['notebook'] == nbk[pre] and r['example'].strip() == old['example'] and r['word'].strip() == old['answer']]
    assert len(hit) == 1, (k, len(hit))
    hit[0]['example'] = ex; hit[0]['example_ja'] = ja; done.add(k)
out = io.StringIO(); w = csv.DictWriter(out, fieldnames=fields, lineterminator='\r\n'); w.writeheader(); w.writerows(rows)
open('data/cefrj_notebooks.csv', 'w', encoding='utf-8-sig', newline='').write(out.getvalue())
# PT (index.html)
h = open('index.html', encoding='utf-8').read()
js = lambda s: s.replace('\\', '\\\\').replace("'", "\\'")
for k, (ex, ja, form, ds) in A.items():
    cid = k.split('#')[0]
    if not cid.startswith('card'): continue
    no = int(cid.split('-')[1])
    m = re.search(r"\n(\s+)%d: \{ meaning: .*\n" % no, h)
    line = m.group(0)
    new = re.sub(r"example: '(?:[^'\\]|\\.)*'", "example: '" + js(ex) + "'", line, count=1)
    new = re.sub(r"exMeaning: '(?:[^'\\]|\\.)*'", "exMeaning: '" + js(ja) + "'", new, count=1)
    new = re.sub(r"form: '(?:[^'\\]|\\.)*'", "form: '" + js(form) + "'", new, count=1) if "form: '" in new else new.replace(" }", ", form: '" + js(form) + "' }", 1)
    assert new != line, k
    h = h.replace(line, new); done.add(k)
open('index.html', 'w', encoding='utf-8').write(h)
assert done == set(A), set(A) - done
# 固定ダミー：書き直した例文は手で選んだダミー、穴埋めに出さない語は _skip
src = 'tools/fb_src/manual_fix.jsonl'
with open(src, 'w') as f:
    for k, (ex, ja, form, ds) in A.items(): f.write(json.dumps({'k': k, 'd': ds}, ensure_ascii=False) + '\n')
json.dump(SKIP, open('tools/fb_src/skip.json', 'w'))
print('ok', len(done))
