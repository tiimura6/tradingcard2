"""穴埋め問題の固定ダミー（AIが「文脈に入らない」と確認した語）を手帖ごとのJSONにまとめる
入力: tools/fb_src/chunk_*.jsonl（{"k": "カードID#意味番号", "d": [ダミー...], "bad": 例文の弱さ}）
出力: data/fb_A1.json … data/fb_PT.json（{"カードID#意味番号": [ダミー...]}）"""
import json, glob, os
here = os.path.dirname(os.path.abspath(__file__))
pre = {'a1': 'A1', 'a2': 'A2', 'b1': 'B1', 'b2': 'B2', 'card': 'PT'}
out = {v: {} for v in pre.values()}
for f in sorted(glob.glob(os.path.join(here, 'fb_src', 'chunk_*.jsonl'))):
    for line in open(f, encoding='utf-8'):
        if not line.strip(): continue
        o = json.loads(line)
        nb = pre[o['k'].split('-')[0]]
        if len(o['d']) >= 3: out[nb][o['k']] = o['d'][:6]
for nb, m in out.items():
    json.dump(m, open(os.path.join(here, '..', 'data', f'fb_{nb}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(nb, len(m))
