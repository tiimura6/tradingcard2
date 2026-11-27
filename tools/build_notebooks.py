#!/usr/bin/env python3
"""
data/cefrj_notebooks.csv（鉄・銅・銀・金の4手帖を1つにまとめたCSV）から
アプリ用の軽量JSON data/nb_A1.json 〜 nb_B2.json を作る。
教養の手帖 data/kyoyo_WH.csv からは data/nb_WH.json・detail_WH.json も作る（build_side）。

使い方: python3 tools/build_notebooks.py
CSVの例文や訳を直したら、このコマンドを実行してJSONを作り直す。

JSON 1行 = [英単語, 品詞, 日本語, 例文, 例文中の語形, カテゴリ, 除外する選択肢の番号リスト, 例文の日本語訳, ほかの品詞の意味]
  ほかの品詞の意味: 同じつづりの語（about 副詞／前置詞 など）は1枚のカードにまとめる。
        2つ目以降の意味を [[品詞, 日本語, 例文, 語形, 例文の日本語訳], ...] で持つ（1つだけの語は省略）
  CSV は1行＝1つの品詞のまま。まとめるのはこのスクリプト（CSVの No とカード番号の対応は data/idmap.json）
  単語ガイドの元データ tools/detail_src/detail_*.json（CSV の No 順）も、まとめたカード順の data/detail_*.json にする
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


POS_JA = {"n.": "名", "v.": "動", "adj.": "形", "adv.": "副", "prep.": "前", "conj.": "接", "pron.": "代",
          "det.": "限", "aux.": "助", "interj.": "間", "num.": "数", "int.": "間"}


def _uniq(xs):
    out = []
    for x in xs:
        if x and x not in out:
            out.append(x)
    return out


def merge_detail(word, poses, ds):
    """同じつづりの複数の品詞の単語ガイドを1つにまとめる"""
    if len(ds) == 1:
        return ds[0]
    g = lambda k: [d.get(k) for d in ds]
    out = {}
    ipas = g("i")
    if len(set(x for x in ipas if x)) > 1:
        out["i"] = " ・ ".join(f"{POS_JA.get(p, p)} {i}" for p, i in zip(poses, ipas) if i)
    elif any(ipas):
        out["i"] = next(x for x in ipas if x)
    for k, sep in (("p", " ／ "), ("m", " ／ "), ("n", " ／ ")):
        v = _uniq(g(k))
        if v:
            out[k] = sep.join(v)
    for k in ("e", "a"):
        v = _uniq(g(k))
        if v:
            out[k] = v[0]
    t = _uniq(g("t"))
    if t:
        out["t"] = " ／ ".join(t[:2])
    s = _uniq([x for d in ds for x in (d.get("s") or [])])
    if s:
        out["s"] = s[:5]
    c = _uniq([x for d in ds for x in (d.get("c") or [])])
    if c:
        out["c"] = c[:5]
    dv = [x for x in _uniq([x for d in ds for x in (d.get("d") or [])])
          if re.sub(r"（.*", "", x).strip().lower() != word.lower()]
    if dv:
        out["d"] = dv[:5]
    return out


def pt_words():
    """白金の手帖（index.html 内の quizList）の [(番号, 日本語, 英単語), ...]"""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    pt = []
    for mm in re.finditer(r"^\s*(\d+): \{ meaning: '((?:[^'\\]|\\.)*)', answer: '((?:[^'\\]|\\.)*)'", html, re.M):
        pt.append((int(mm.group(1)), mm.group(2).replace("\\'", "'"), mm.group(3).replace("\\'", "'")))
    return pt


def detail_lookup():
    """既存手帖の単語ガイドを引く関数 look(英単語, 品詞) を返す。B1→B2→PT の順に探す。
    同じ品詞を持つカードを先に探し（collapse は B1 の名詞より B2 の動詞）、無ければ品詞を問わず最初に見つかったもの。
    白金（PT）は品詞を持たないので品詞を問わない扱い。どこにも無ければ None"""
    entries = []   # (英単語の小文字, 品詞の集合, ガイド)
    for lv in ("B1", "B2"):
        nb_path, det_path = ROOT / "data" / f"nb_{lv}.json", ROOT / "data" / f"detail_{lv}.json"
        if not (nb_path.exists() and det_path.exists()):
            continue
        nb = json.loads(nb_path.read_text(encoding="utf-8"))
        det = json.loads(det_path.read_text(encoding="utf-8"))
        for row, d in zip(nb, det):
            poses = {row[1]} | {s[0] for s in (row[8] if len(row) > 8 else [])}
            entries.append((row[0].lower(), poses, d))
    det_path = ROOT / "data" / "detail_PT.json"
    if det_path.exists():
        det = json.loads(det_path.read_text(encoding="utf-8"))
        for no, _, ans in pt_words():
            if 0 < no <= len(det):
                entries.append((ans.lower(), set(), det[no - 1]))

    def look(word, pos):
        w = word.lower()
        for ew, poses, d in entries:
            if ew == w and pos in poses:
                return d
        for ew, _, d in entries:
            if ew == w:
                return d
        return None
    return look


def build_side(key: str, csv_path: Path) -> None:
    """教養の手帖（WH など）の nb_{key}.json と detail_{key}.json を作る。
    既存の手帖と違い、品詞ごとにまとめない（CSV の1行＝1枚、No 順）。
    1行 = 既存の9要素（ほかの品詞の意味 r[8] は常に []）＋ r[9]=教科書用語(term)、r[10]=時代(era)
    単語ガイドは既存手帖（B1→B2→PT、同じ品詞のカードを優先）の同じ単語のものをコピーし、無ければ null"""
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8-sig")))
    rows.sort(key=lambda r: int(r["No"]))
    ex = exclusions(rows, lambda r: r["word"].strip(), lambda r: r["japanese"].strip(), lambda r: r.get("synonym", ""))
    out_items, miss = [], []
    for k, r in enumerate(rows):
        word, exm = r["word"].strip(), r["example"].strip()
        form = find_form(word, exm)
        if not form:
            miss.append(word)
        out_items.append([word, r["pos"].strip(), r["japanese"].strip(), exm, form, r["category"].strip(),
                          ex[k], r.get("example_ja", "").strip(), [], r["term"].strip(), r["era"].strip()])
    out = ROOT / "data" / f"nb_{key}.json"
    out.write_text(json.dumps(out_items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    look = detail_lookup()
    det = [look(r["word"].strip(), r["pos"].strip()) for r in rows]
    (ROOT / "data" / f"detail_{key}.json").write_text(json.dumps(det, ensure_ascii=False, separators=(",", ":")),
                                                      encoding="utf-8")
    nulls = [r["word"].strip() for r, d in zip(rows, det) if d is None]
    print(f"{key}: {len(out_items)}枚 {out.name} ({out.stat().st_size // 1024}KB) 穴埋め不可 {len(miss)} {miss[:8]} "
          f"単語ガイドなし {len(nulls)} {nulls}")


def main():
    rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
    by_nb = {}
    for r in rows:
        by_nb.setdefault(r["notebook"], []).append(r)
    idmap = {}
    for lv, rs in by_nb.items():
        # 同じつづり（大文字小文字も同じ）の行を1枚にまとめる（CSVでは隣り合っている）
        groups, pos_of = [], {}
        for r in rs:
            w = r["word"].strip()
            if w in pos_of:
                groups[pos_of[w]].append(r)
            else:
                pos_of[w] = len(groups)
                groups.append([r])
        idmap[lv] = [0] * len(rs)
        items, miss, meanings, syns = [], [], [], []
        for gi, grp in enumerate(groups):
            senses = []
            for r in grp:
                idmap[lv][int(r["No"]) - 1] = gi + 1
                word, ex = r["word"].strip(), r["example"].strip()
                form = find_form(word, ex)
                if not form:
                    miss.append(word)
                senses.append([r["pos"].strip(), r["japanese"].strip(), ex, form, r.get("example_ja", "").strip()])
            p0 = senses[0]
            item = [grp[0]["word"].strip(), p0[0], p0[1], p0[2], p0[3], grp[0]["category"].strip()]
            items.append((item, p0[4], senses[1:]))
            meanings.append("／".join(s[1] for s in senses))
            syns.append("|".join(r.get("synonym", "") for r in grp))
        ex = exclusions(list(range(len(items))), lambda k: items[k][0][0], lambda k: meanings[k], lambda k: syns[k])
        out_items = []
        for k, (item, exja, extra) in enumerate(items):
            row = item + [ex[k], exja]
            if extra:
                row.append(extra)
            out_items.append(row)
        out = ROOT / "data" / f"nb_{lv}.json"
        out.write_text(json.dumps(out_items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        # 単語ガイド
        src = ROOT / "tools" / "detail_src" / f"detail_{lv}.json"
        if src.exists():
            det = json.loads(src.read_text(encoding="utf-8"))
            merged = []
            for grp in groups:
                merged.append(merge_detail(grp[0]["word"].strip(), [r["pos"].strip() for r in grp],
                                           [det[int(r["No"]) - 1] if int(r["No"]) - 1 < len(det) else {} for r in grp]))
            (ROOT / "data" / f"detail_{lv}.json").write_text(json.dumps(merged, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{lv}: {len(rs)}行 → {len(out_items)}枚（{len(rs) - len(out_items)}語をまとめた） {out.name} "
              f"({out.stat().st_size // 1024}KB) 穴埋め不可 {len(miss)} {miss[:8]}")
    (ROOT / "data" / "idmap.json").write_text(json.dumps(idmap, separators=(",", ":")), encoding="utf-8")

    # 白金の手帖（index.html 内の quizList）の除外リスト → data/excl_PT.json
    pt = pt_words()
    ex = exclusions(pt, lambda t: t[2], lambda t: t[1])
    excl = {str(pt[i][0]): [pt[j][0] for j in e] for i, e in enumerate(ex) if e}
    (ROOT / "data" / "excl_PT.json").write_text(json.dumps(excl, separators=(",", ":")), encoding="utf-8")
    print(f"PT: {len(pt)}語 → excl_PT.json ({(ROOT / 'data' / 'excl_PT.json').stat().st_size // 1024}KB)")

    # 教養の手帖（時の回廊・世界史）：既存の手帖のデータには触れない
    build_side("WH", ROOT / "data" / "kyoyo_WH.csv")


if __name__ == "__main__":
    main()
