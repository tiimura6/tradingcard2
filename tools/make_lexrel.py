#!/usr/bin/env python3
"""
4択のダミー選択肢から「正解になり得る語」を外すための語彙関係データ data/lexrel.json を作る。
（反対語・類義語。WordNet 3.0 から抽出。普段は実行不要。単語を大きく増やしたときだけ実行）

必要なもの: pip install nltk、WordNet 3.0 データ（NLTK_DATA で場所を指定）
使い方: NLTK_DATA=/path/to/nltk_data python3 tools/make_lexrel.py
"""
import csv, json, re, warnings
from pathlib import Path

warnings.filterwarnings("ignore")
from nltk.corpus import wordnet as wn

ROOT = Path(__file__).resolve().parent.parent


def vocab():
    words = set()
    for r in csv.DictReader(open(ROOT / "data" / "cefrj_notebooks.csv", encoding="utf-8-sig")):
        words.add(r["word"].strip().lower())
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for m in re.finditer(r"^\s*\d+: \{ meaning: '(?:[^'\\]|\\.)*', answer: '((?:[^'\\]|\\.)*)'", html, re.M):
        words.add(m.group(1).replace("\\'", "'").strip().lower())
    return words


def related(w):
    key = w.replace(" ", "_")
    out = set()
    for s in wn.synsets(key):
        mine = [l for l in s.lemmas() if l.name().lower() == key]
        if not mine:
            continue
        # 類義語（同じ意味グループの語）
        for l in s.lemmas():
            out.add(l.name())
        # 反対語（直接）
        for l in mine:
            for a in l.antonyms():
                out.add(a.name())
        # 形容詞の間接的な反対語（warm → cold など）と、似た意味の形容詞
        if s.pos() in ("a", "s"):
            for h in s.similar_tos():
                for hl in h.lemmas():
                    out.add(hl.name())
                    for a in hl.antonyms():
                        out.add(a.name())
    out = {o.replace("_", " ").lower() for o in out}
    out.discard(w)
    return out


def main():
    V = vocab()
    rel = {}
    for w in sorted(V):
        r = sorted(x for x in related(w) if x in V)
        if r:
            rel[w] = r
    (ROOT / "data" / "lexrel.json").write_text(json.dumps(rel, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"語彙 {len(V)}語中 {len(rel)}語に関係語あり")


if __name__ == "__main__":
    main()
