import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import check_kyoyo  # noqa: E402

FX = os.path.join(HERE, "kyoyo_fixtures")


def run(name, final=False):
    return check_kyoyo.check(os.path.join(FX, name + ".csv"), final)


def has(errors, *words):
    return any(all(w in e for w in words) for e in errors)


class CheckKyoyoTest(unittest.TestCase):
    def test_ok_sample(self):
        self.assertEqual(run("ok_sample", final=False), [])

    def test_count(self):
        self.assertTrue(has(run("ok_sample", final=True), "枚数"))

    def test_no_sequence(self):
        e = run("bad_no_sequence", final=True)
        self.assertTrue(has(e, "No"), e)

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


if __name__ == "__main__":
    unittest.main()
