#!/usr/bin/env python3
"""
data/cefrj_notebooks.csv（鉄・銅・銀・金の4手帖を1つにまとめたCSV）から
アプリ用の軽量JSON data/nb_A1.json 〜 nb_B2.json を作る。

使い方: python3 tools/build_notebooks.py
CSVの例文や訳を直したら、このコマンドを実行してJSONを作り直す。

JSON 1行 = [英単語, 品詞, 日本語, 例文, 例文中の語形, カテゴリ]
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
    "child": ["children"], "man": ["men"], "woman": ["women"], "foot": ["feet"], "tooth": ["teeth"],
    "mouse": ["mice"], "person": ["people"], "goose": ["geese"], "ox": ["oxen"], "knife": ["knives"],
    "leaf": ["leaves"], "life": ["lives"], "wife": ["wives"], "wolf": ["wolves"], "half": ["halves"],
    "shelf": ["shelves"], "thief": ["thieves"], "loaf": ["loaves"], "elf": ["elves"],
    "good": ["better", "best"], "bad": ["worse", "worst"], "far": ["farther", "further", "farthest", "furthest"],
    "i": ["me", "my", "mine"], "he": ["him", "his"], "she": ["her", "hers"], "we": ["us", "our", "ours"],
    "they": ["them", "their", "theirs"],
}

VOWELS = "aeiou"


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
    for lv, items in books.items():
        out = ROOT / "data" / f"nb_{lv}.json"
        out.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        m = miss.get(lv, [])
        print(f"{lv}: {len(items)}語 → {out.name} ({out.stat().st_size // 1024}KB) 穴埋め不可 {len(m)}語 {m[:12]}")


if __name__ == "__main__":
    main()
