import csv
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import check_kyoyo  # noqa: E402

FX = os.path.join(HERE, "kyoyo_fixtures")


def run(name, final=False):
    return check_kyoyo.check(os.path.join(FX, name + ".csv"), final)


def has(errors, *words):
    return any(all(w in e for w in words) for e in errors)


def build_rows(nos):
    """ok_sample の行を雛形に、指定した No の行を作る（単語・例文は重複しない）。"""
    template = check_kyoyo._read_csv(os.path.join(FX, "ok_sample.csv"))[0]
    pool, seen = [], set()
    for r in check_kyoyo._read_csv(check_kyoyo.CEFRJ_CSV):
        if r["notebook"] not in ("B1", "B2") or r["word"] in seen:
            continue
        if not check_kyoyo.find_form(r["word"], r["example"]):
            continue
        if check_kyoyo.count_word_family(r["word"], r["example"]) > 1:
            continue
        if check_kyoyo.FANTASY_RE.search(r["example"] + " " + r["image"]):
            continue
        seen.add(r["word"])
        pool.append(r)
        if len(pool) >= 100:
            break
    rows = []
    for i, no in enumerate(nos):
        src = pool[i]
        row = dict(template)
        row.update(
            No=str(no), word=src["word"], pos=src["pos"], japanese=src["japanese"],
            example="In the old port town, " + src["example"][0].lower() + src["example"][1:],
            example_ja="港町では、" + src["example_ja"].rstrip("。") + "（宗教改革）。",
            image=f"a stone monument at a quiet harbor, scene {i}",
            era=check_kyoyo.ERAS[(no - 1) // 20] if isinstance(no, int) else "古代",
            term="宗教改革",
            level=src["notebook"],
        )
        rows.append(row)
    return rows


def run_rows(rows, final):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.csv")
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, check_kyoyo.COLUMNS)
            w.writeheader()
            w.writerows(rows)
        return check_kyoyo.check(path, final)


class CheckKyoyoTest(unittest.TestCase):
    def test_ok_sample(self):
        self.assertEqual(run("ok_sample", final=False), [])

    def test_count(self):
        self.assertTrue(has(run("ok_sample", final=True), "枚数"))

    def test_final_ok_100_rows(self):
        self.assertEqual(run_rows(build_rows(list(range(1, 101))), final=True), [])

    def test_no_sequence(self):
        # No 3 が欠番、No 4 が2回
        nos = [n for n in range(1, 101) if n != 3] + [4]
        e = run_rows(build_rows(nos), final=True)
        self.assertIn("No 3 が欠番です（連番エラー）", e)
        self.assertIn("No 4 が重複しています（連番エラー）", e)
        self.assertFalse(has(e, "枚数"), e)

    def test_no_not_digit(self):
        rows = build_rows(list(range(1, 11)))
        rows[2]["No"] = "x3"
        e = run_rows(rows, final=False)
        self.assertIn("No x3: No が数字ではありません", e)

    def test_era_order(self):
        e = run("bad_era")
        self.assertTrue(has(e, "時代", "21"), e)

    def test_word_in_example(self):
        e = run("bad_word_in_example")
        self.assertTrue(has(e, "例文", "22"), e)

    def test_term_in_ja(self):
        e = run("bad_term_in_ja")
        self.assertTrue(has(e, "教科書用語", "41"), e)

    def test_sources(self):
        e = run("bad_sources")
        self.assertTrue(has(e, "出典", "42"), e)

    def test_level(self):
        e = run("bad_level")
        self.assertTrue(has(e, "語彙", "61"), e)

    def _with_word(self, word, level):
        rows = build_rows(list(range(1, 11)))
        rows[6].update(word=word, pos="n.", level=level,
                       example=f"The {word} of the old harbor was recorded by a careful local scribe.")
        return run_rows(rows, final=False)

    def test_level_non_vocab_wh_ok(self):
        self.assertEqual(self._with_word("zzqxword", "WH"), [])

    def test_level_non_vocab_b2_fails(self):
        e = self._with_word("zzqxword", "B2")
        self.assertTrue(has(e, "語彙", "zzqxword", "WH"), e)

    def test_level_vocab_wh_fails(self):
        e = self._with_word("voyage", "WH")  # B1 の単語
        self.assertTrue(has(e, "語彙", "voyage", "B1"), e)

    def test_level_vocab_wrong_notebook_fails(self):
        e = self._with_word("voyage", "B2")
        self.assertTrue(has(e, "語彙", "voyage", "B1"), e)

    def test_level_vocab_two_notebooks_ok(self):
        # collapse は B1（名詞）と B2（動詞）の両方にある
        self.assertEqual(self._with_word("collapse", "B2"), [])

    def test_vocab_loaded(self):
        v = check_kyoyo.load_vocab()
        self.assertIn("abandon", v)
        self.assertIn("a double line", v)
        self.assertNotIn("zzqxword", v)

    def test_dup_word(self):
        e = run("bad_dup_word")
        self.assertTrue(has(e, "重複", "81"), e)

    def test_fantasy(self):
        for name in ("bad_fantasy_example", "bad_fantasy_image"):
            e = run(name)
            self.assertTrue(has(e, "架空", "2"), (name, e))

    def test_dup_example(self):
        for name in ("bad_dup_example", "bad_dup_image"):
            e = run(name)
            self.assertTrue(has(e, "重複", "62"), (name, e))


    def test_target_word_once(self):
        # 活用形（absorbs / absorbed）が2回出ると、クイズで答えが漏れる
        e = run("bad_dup_target")
        self.assertTrue(has(e, "例文", "82", "1回"), e)

    def test_target_word_once_derivative(self):
        # 同じ語幹の派生語（vote / voters）も数える
        rows = build_rows(list(range(1, 11)))
        rows[6].update(word="vote", pos="v.", level="B1",
                       example="In the old port town, the voters gathered to vote on the new harbor law.")
        e = run_rows(rows, final=False)
        self.assertTrue(has(e, "例文", "vote", "1回"), e)

    def test_target_word_once_ok(self):
        rows = build_rows(list(range(1, 11)))
        rows[6].update(word="vote", pos="v.", level="B1",
                       example="In the old port town, the citizens gathered to vote on the new harbor law.")
        self.assertEqual(run_rows(rows, final=False), [])

if __name__ == "__main__":
    unittest.main()
