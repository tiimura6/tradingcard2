#!/usr/bin/env python3
"""
data/cefrj_notebooks.csv（鉄・銅・銀・金の4手帖を1つにまとめたCSV）から
アプリ用の軽量JSON data/nb_A1.json 〜 nb_B2.json を作る。

使い方: python3 tools/build_notebooks.py
CSVの例文や訳を直したら、このコマンドを実行してJSONを作り直す。

JSON 1行 = [英単語, 品詞, 日本語, 例文, 例文中の語形, カテゴリ, 除外する選択肢の番号リスト, 例文の日本語訳]
  語形: 例文の中で見出し語が変化した形（wind → wound など）。穴埋め問題で隠す部分。
        見つからない場合は空文字（その単語は穴埋めではなく意味問題で出題される）
"""
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "cefrj_notebooks.csv"

IRREGULAR = {
    "be": ["am", "is", "are", "was", "were", "been", "being"], "have": ["has", "had", "having"],
    "do": ["does", "did", "done", "doing"], "go": ["goes", "went", "gone", "going"],
    "arise": ["arose", "arisen"], "awake": ["awoke", "awoken"], "bear": ["bore", "born", "borne"],
    "beat": ["beaten"], "become": ["became"], "begin": ["began", "begun"], "bend": ["bent"],
    "bet": [], "bind": ["bound"], "bite": ["bit", "bitten"], "bleed": ["bled"], "blow": ["blew", "blown"],
    "break": ["broke", "broken"], "breed": ["bred"], "bring": ["brought"], "broadcast": [],
    "build": ["built"], "burn": ["burnt"], "burst": [], "buy": ["bought"], "catch": ["caught"],
    "choose": ["chose", "chosen"], "cling": ["clung"], "come": ["came"], "cost": [], "creep": ["crept"],
    "cut": [], "deal": ["dealt"], "dig": ["dug"], "draw": ["drew", "drawn"], "dream": ["dreamt"],
    "drink": ["drank", "drunk"], "drive": ["drove", "driven"], "eat": ["ate", "eaten"], "fall": ["fell", "fallen"],
    "feed": ["fed"], "feel": ["felt"], "fight": ["fought"], "find": ["found"], "flee": ["fled"],
    "fling": ["flung"], "fly": ["flew", "flown", "flies"], "forbid": ["forbade", "forbidden"],
    "forecast": [], "foresee": ["foresaw", "foreseen"], "forget": ["forgot", "forgotten"],
    "forgive": ["forgave", "forgiven"], "freeze": ["froze", "frozen"], "get": ["got", "gotten"],
    "give": ["gave", "given"], "grind": ["ground"], "grow": ["grew", "grown"], "hang": ["hung"],
    "hear": ["heard"], "hide": ["hid", "hidden"], "hit": [], "hold": ["held"], "hurt": [],
    "keep": ["kept"], "kneel": ["knelt"], "know": ["knew", "known"], "lay": ["laid"], "lead": ["led"],
    "lean": ["leant"], "leap": ["leapt"], "learn": ["learnt"], "leave": ["left"], "lend": ["lent"],
    "let": [], "lie": ["lay", "lain", "lying"], "light": ["lit"], "lose": ["lost"], "make": ["made"],
    "mean": ["meant"], "meet": ["met"], "mislead": ["misled"], "mistake": ["mistook", "mistaken"],
    "misunderstand": ["misunderstood"], "overcome": ["overcame"], "overhear": ["overheard"],
    "overtake": ["overtook", "overtaken"], "pay": ["paid"], "prove": ["proven"], "put": [],
    "quit": [], "read": [], "rid": [], "ride": ["rode", "ridden"], "ring": ["rang", "rung"],
    "rise": ["rose", "risen"], "run": ["ran"], "say": ["said"], "see": ["saw", "seen"], "seek": ["sought"],
    "sell": ["sold"], "send": ["sent"], "set": [], "sew": ["sewn"], "shake": ["shook", "shaken"],
    "shed": [], "shine": ["shone"], "shoot": ["shot"], "show": ["shown"], "shrink": ["shrank", "shrunk"],
    "shut": [], "sing": ["sang", "sung"], "sink": ["sank", "sunk"], "sit": ["sat"], "sleep": ["slept"],
    "slide": ["slid"], "sling": ["slung"], "smell": ["smelt"], "sow": ["sown"], "speak": ["spoke", "spoken"],
    "speed": ["sped"], "spell": ["spelt"], "spend": ["spent"], "spill": ["spilt"], "spin": ["spun"],
    "spit": ["spat"], "split": [], "spoil": ["spoilt"], "spread": [], "spring": ["sprang", "sprung"],
    "stand": ["stood"], "steal": ["stole", "stolen"], "stick": ["stuck"], "sting": ["stung"],
    "stink": ["stank", "stunk"], "strike": ["struck"], "string": ["strung"], "strive": ["strove", "striven"],
    "swear": ["swore", "sworn"], "sweep": ["swept"], "swell": ["swollen"], "swim": ["swam", "swum"],
    "swing": ["swung"], "take": ["took", "taken"], "teach": ["taught"], "tear": ["tore", "torn"],
    "tell": ["told"], "think": ["thought"], "throw": ["threw", "thrown"], "thrust": [],
    "tread": ["trod", "trodden"], "undergo": ["underwent", "undergone"], "understand": ["understood"],
    "undertake": ["undertook", "undertaken"], "upset": [], "wake": ["woke", "woken"], "wear": ["wore", "worn"],
    "weave": ["wove", "woven"], "weep": ["wept"], "win": ["won"], "wind": ["wound"], "withdraw": ["withdrew", "withdrawn"],
    "withstand": ["withstood"], "wring": ["wrung"], "write": ["wrote", "written"],
    "outshine": ["outshone"], "overthrow": ["overthrew", "overthrown"], "stride": ["strode", "stridden"],
    "repay": ["repaid"], "retell": ["retold"], "workman": ["workmen"], "grandchild": ["grandchildren"],
    "schoolchild": ["schoolchildren"], "equip": ["equipped", "equipping", "equips"],
    "child": ["children"], "man": ["men"], "woman": ["women"], "foot": ["feet"], "tooth": ["teeth"],
    "mouse": ["mice"], "person": ["people"], "goose": ["geese"], "ox": ["oxen"], "knife": ["knives"],
    "leaf": ["leaves"], "life": ["lives"], "wife": ["wives"], "wolf": ["wolves"], "half": ["halves"],
    "shelf": ["shelves"], "thief": ["thieves"], "loaf": ["loaves"], "elf": ["elves"],
    "good": ["better", "best"], "bad": ["worse", "worst"], "far": ["farther", "further", "farthest", "furthest"],
    "i": ["me", "my", "mine"], "he": ["him", "his"], "she": ["her", "hers"], "we": ["us", "our", "ours"],
    "they": ["them", "their", "theirs"],
}

VOWELS = "aeiou"

# 同じ文脈に入れ替えて入り得る語のグループ（同じグループの語はダミー選択肢にしない）
SWAP_GROUPS = [
    "a.m. p.m. morning afternoon evening night midnight noon tonight",
    "monday tuesday wednesday thursday friday saturday sunday weekend weekday",
    "january february march april may june july august september october november december",
    "spring summer autumn fall winter",
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion dozen half",
    "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth twentieth hundredth last next",
    "red blue green yellow black white brown pink purple orange grey gray gold silver dark light",
    "north south east west northern southern eastern western left right up down",
    "yesterday today tomorrow now then soon later already yet still ago before after",
    "breakfast lunch dinner supper snack meal",
    "sunny rainy cloudy snowy windy foggy stormy hot cold warm cool",
    "alone together",
    "mother father mom dad mum parent brother sister son daughter aunt uncle cousin grandmother grandfather grandparent wife husband baby child",
    "in on at under above below behind beside between near over across through into onto from to by with without around along inside outside off out up down toward towards past beyond within against among opposite",
    "and but or so because if when while although though unless until since as than",
    "can could may might must shall should will would",
    "what who whom whose which where when why how",
    "i you he she it we they me him her us them my your his its our their mine yours hers ours theirs myself yourself himself herself itself ourselves themselves",
    "a an the this that these those some any many much few little several all every each both either neither no none more most less least enough",
    "always usually often sometimes rarely seldom never ever",
    "very quite really too so rather pretty extremely",
    "here there everywhere somewhere anywhere nowhere",
    "big large small little huge tiny tall short long high low",
    "good bad better best worse worst",
]
GROUP_OF = {}
for gi, g in enumerate(SWAP_GROUPS):
    for w in g.split():
        GROUP_OF.setdefault(w, set()).add(gi)

LEXREL = {}
_lex_path = Path(__file__).resolve().parent.parent / "data" / "lexrel.json"
if _lex_path.exists():
    LEXREL = json.loads(_lex_path.read_text(encoding="utf-8"))


def ja_segments(meaning: str):
    """日本語訳を「／」などで区切った意味のまとまり（〜や括弧は除く）"""
    segs = set()
    for t in re.split(r"[／/、,;；]", meaning or ""):
        t = re.sub(r"[（(].*?[）)]", "", t).replace("〜", "").replace("～", "").strip()
        if len(t) >= 1:
            segs.add(t)
    return segs


def exclusions(items, get_word, get_meaning, get_syn=None):
    """各語について、ダミー選択肢にしてはいけない語（反対語・類義語・同じ意味・入れ替え可能な語）の番号リスト"""
    words = [get_word(x).lower() for x in items]
    idx_by_word = {}
    for i, w in enumerate(words):
        idx_by_word.setdefault(w, []).append(i)
    segs = [ja_segments(get_meaning(x)) for x in items]
    seg_index = {}
    for i, ss in enumerate(segs):
        for t in ss:
            seg_index.setdefault(t, []).append(i)
    out = []
    for i, x in enumerate(items):
        w = words[i]
        ex = set()
        rel = set(LEXREL.get(w, []))
        if get_syn:
            rel |= {t.strip().lower() for t in re.split(r"[|,/]", get_syn(x) or "") if t.strip()}
        for g in GROUP_OF.get(w, ()):
            rel |= set(SWAP_GROUPS[g].split())
        for r in rel:
            ex.update(idx_by_word.get(r, []))
        for t in segs[i]:
            ex.update(seg_index.get(t, []))
        ex.update(idx_by_word.get(w, []))      # 同じつづり（品詞違いのカード）
        ex.discard(i)
        out.append(sorted(ex))
    # 関係は対称にする
    for i, ex in enumerate(out):
        for j in ex:
            if i not in out[j]:
                out[j].append(i)
    return [sorted(set(e)) for e in out]


def candidates(word: str):
    """見出し語から考えられる語形（長い順）"""
    w = word.lower()
    forms = {w}
    forms.update(IRREGULAR.get(w, []))
    if " " in w:
        # 句: 先頭語だけ変化させる（look after → looked after）
        head, rest = w.split(" ", 1)
        for f in candidates(head):
            forms.add(f + " " + rest)
        # 名詞句の複数形（martial art → martial arts、video game → video games）
        forms.add(w + "s")
        return sorted(forms, key=len, reverse=True)
    forms.update({w + "s", w + "es", w + "ed", w + "d", w + "ing", w + "er", w + "est", w + "ly", w + "'s"})
    if w.endswith("e"):
        forms.update({w[:-1] + "ing", w[:-1] + "ed", w[:-1] + "er", w[:-1] + "est"})
    if w.endswith("y") and len(w) > 2 and w[-2] not in VOWELS:
        forms.update({w[:-1] + "ies", w[:-1] + "ied", w[:-1] + "ier", w[:-1] + "iest", w[:-1] + "ily"})
    if w.endswith("ie"):
        forms.add(w[:-2] + "ying")
    if w.endswith(("f",)):
        forms.add(w[:-1] + "ves")
    if w.endswith("fe"):
        forms.add(w[:-2] + "ves")
    if len(w) >= 3 and w[-1] not in VOWELS + "wxy" and w[-2] in VOWELS and w[-3] not in VOWELS:
        c = w[-1]
        forms.update({w + c + "ed", w + c + "ing", w + c + "er", w + c + "est"})
    if w.endswith("ic"):
        forms.update({w + "ked", w + "king"})
    if w.endswith("le"):
        forms.add(w[:-1] + "y")
    return sorted(forms, key=len, reverse=True)


def find_form(word: str, example: str) -> str:
    for f in candidates(word):
        m = re.search(r"(?<![A-Za-z])" + re.escape(f) + r"(?![A-Za-z])", example, re.I)
        if m:
            return m.group(0)
    return ""


def main():
    rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
    books = {}
    miss = {}
    for r in rows:
        lv = r["notebook"]
        word = r["word"].strip()
        ex = r["example"].strip()
        form = find_form(word, ex)
        if not form:
            miss.setdefault(lv, []).append(word)
        books.setdefault(lv, []).append([word, r["pos"].strip(), r["japanese"].strip(), ex, form, r["category"].strip()])
    syn_by = {}
    for r in rows:
        syn_by.setdefault(r["notebook"], []).append(r.get("synonym", ""))
    for lv, items in books.items():
        ex = exclusions(list(range(len(items))), lambda k: items[k][0], lambda k: items[k][2], lambda k: syn_by[lv][k])
        exja = [r.get("example_ja", "").strip() for r in rows if r["notebook"] == lv]
        for k, e in enumerate(ex):
            items[k].append(e)
            items[k].append(exja[k] if k < len(exja) else "")
        out = ROOT / "data" / f"nb_{lv}.json"
        out.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        m = miss.get(lv, [])
        print(f"{lv}: {len(items)}語 → {out.name} ({out.stat().st_size // 1024}KB) 穴埋め不可 {len(m)}語 {m[:12]}")

    # 白金の手帖（index.html 内の quizList）の除外リスト → data/excl_PT.json
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    pt = []
    for mm in re.finditer(r"^\s*(\d+): \{ meaning: '((?:[^'\\]|\\.)*)', answer: '((?:[^'\\]|\\.)*)'", html, re.M):
        pt.append((int(mm.group(1)), mm.group(2).replace("\\'", "'"), mm.group(3).replace("\\'", "'")))
    ex = exclusions(pt, lambda t: t[2], lambda t: t[1])
    excl = {str(pt[i][0]): [pt[j][0] for j in e] for i, e in enumerate(ex) if e}
    (ROOT / "data" / "excl_PT.json").write_text(json.dumps(excl, separators=(",", ":")), encoding="utf-8")
    print(f"PT: {len(pt)}語 → excl_PT.json ({(ROOT / 'data' / 'excl_PT.json').stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
