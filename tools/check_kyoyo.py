#!/usr/bin/env python3
"""教養の手帖（世界史）カードCSVの検証スクリプト。

使い方: python3 tools/check_kyoyo.py data/kyoyo_WH.csv [--final]
--final なしは見本用で、枚数・連番の検査を飛ばす。
"""
import csv
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from build_notebooks import find_form  # noqa: E402

CEFRJ_CSV = os.path.join(ROOT, "data", "cefrj_notebooks.csv")
INDEX_HTML = os.path.join(ROOT, "index.html")

COLUMNS = ("notebook,image_url,image,No,word,pos,japanese,example,example_ja,answers,"
           "level,category,level_badge,level_color,synonym,subject,era,term,sources").split(",")
ERAS = ["古代", "中世", "近世", "近代", "現代"]
FANTASY = ("dragon dragons wizard wizards knight knights giant giants elf elves "
           "fairy fairies magic spell spells spelled spelling").split()
FANTASY_RE = re.compile(r"(?<![A-Za-z])(" + "|".join(FANTASY) + r")(?![A-Za-z])", re.I)


def _read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _quizlist_block():
    with open(INDEX_HTML, encoding="utf-8") as f:
        html = f.read()
    start = html.find("const quizList = {")
    if start < 0:
        return ""
    end = html.find("\n    };", start)
    return html[start:end if end > 0 else len(html)]


def _quiz_strings(key):
    return re.findall(key + r": '((?:[^'\\]|\\.)*)'", _quizlist_block())


def load_vocab_levels():
    """単語（小文字）→ その単語がある手帖の集合（B1/B2 は cefrj_notebooks.csv、PT は quizList）。"""
    levels = {}
    for r in _read_csv(CEFRJ_CSV):
        w = r["word"].strip().lower()
        if r["notebook"] in ("B1", "B2") and w:
            levels.setdefault(w, set()).add(r["notebook"])
    for a in _quiz_strings("answer"):
        if a.strip():
            levels.setdefault(a.strip().lower(), set()).add("PT")
    return levels


def load_vocab():
    """B1/B2 の単語（cefrj_notebooks.csv）と PT の answer（index.html の quizList）。小文字。"""
    return set(load_vocab_levels())


def _load_existing_texts():
    texts = set()
    for r in _read_csv(CEFRJ_CSV):
        for k in ("example", "image"):
            if r[k].strip():
                texts.add(r[k].strip())
    texts.update(s.strip() for s in _quiz_strings("example") if s.strip())
    return texts


def check(csv_path, final):
    errors = []
    rows = _read_csv(csv_path)
    vocab_levels = load_vocab_levels()
    existing = _load_existing_texts()

    if final:
        if len(rows) != 100:
            errors.append(f"枚数が100枚ではありません（{len(rows)}枚）")
        nos = [r.get("No", "").strip() for r in rows]
        seen = set()
        for n in nos:
            if n in seen:
                errors.append(f"No {n} が重複しています（連番エラー）")
            seen.add(n)
        for n in range(1, 101):
            if str(n) not in seen:
                errors.append(f"No {n} が欠番です（連番エラー）")

    seen_words = {}
    for r in rows:
        no = r.get("No", "").strip()
        word = r.get("word", "").strip()
        pos = r.get("pos", "").strip()
        example = r.get("example", "").strip()
        image = r.get("image", "").strip()
        label = f"No {no}"

        miss = [c for c in COLUMNS if c not in r or r[c] is None]
        if miss:
            errors.append(f"{label}: 列が足りません（{','.join(miss)}）")
            continue

        if r["notebook"].strip() != "WH":
            errors.append(f"{label}: notebook が WH ではありません")
        if r["subject"].strip() != "世界史":
            errors.append(f"{label}: subject が 世界史 ではありません")

        # 時代は No で決まる
        if no.isdigit() and 1 <= int(no) <= 100:
            want = ERAS[(int(no) - 1) // 20]
            if r["era"].strip() != want:
                errors.append(f"{label}: 時代が違います（{r['era'].strip()} → {want}）")
        elif r["era"].strip() not in ERAS:
            errors.append(f"{label}: 時代が不正です（{r['era'].strip()}）")
        if not no.isdigit():
            errors.append(f"{label}: No が数字ではありません")

        # 例文にターゲット単語（活用形含む）
        if not find_form(word, example):
            errors.append(f"{label}: 例文に単語 {word} が見つかりません")

        # 教科書用語が日本語訳に入っている
        term = r["term"].strip()
        if not term or term not in r["example_ja"]:
            errors.append(f"{label}: 教科書用語 {term or '(空)'} が例文訳にありません")

        # 出典は2つ以上
        urls = [u.strip() for u in r["sources"].split(" | ") if u.strip()]
        if len(urls) < 2 or not all(re.match(r"https?://", u) for u in urls):
            errors.append(f"{label}: 出典のURLが2つ以上ありません（{len(urls)}件）")

        # 語彙レベル：B1/B2/PT の単語なら level はその手帖、手帖専用の単語なら WH
        level = r["level"].strip()
        have = vocab_levels.get(word.lower())
        if have:
            if level not in have:
                errors.append(f"{label}: 語彙 {word} は {'/'.join(sorted(have))} の単語です"
                              f"（level が {level or '(空)'}）")
        elif level != "WH":
            errors.append(f"{label}: 語彙 {word} は B1/B2/PT にない手帖専用の単語なので level は WH にしてください"
                          f"（level が {level or '(空)'}）")

        # 重複（WH内の単語＋品詞）
        key = (word.lower(), pos)
        if key in seen_words:
            errors.append(f"{label}: 重複 単語 {word}（{pos}）が No {seen_words[key]} と同じです")
        else:
            seen_words[key] = no

        # 架空の語
        for field, text in (("例文", example), ("image", image)):
            m = FANTASY_RE.search(text)
            if m:
                errors.append(f"{label}: 架空の語 {m.group(0)} が{field}に含まれています")

        # 既存カードとの重複
        for field, text in (("例文", example), ("image", image)):
            if text and text in existing:
                errors.append(f"{label}: 重複 {field}が既存カードと完全一致しています")

    return errors


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    final = "--final" in argv
    if len(args) != 1:
        print("使い方: python3 tools/check_kyoyo.py <csv> [--final]", file=sys.stderr)
        return 2
    errors = check(args[0], final)
    if errors:
        for e in errors:
            print(e)
        return 1
    print(f"OK: {args[0]} は検査に合格しました" + ("（最終）" if final else "（見本）"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
