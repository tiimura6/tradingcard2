"""教養の手帖（時の回廊・世界史）のアプリ用データ生成のテスト。
python3 -m unittest tools/test_build_wh.py -v"""
import csv
import glob
import hashlib
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
WH_CSV = os.path.join(DATA, "kyoyo_WH.csv")
WH_FILES = {"nb_WH.json", "fb_WH.json", "detail_WH.json"}


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def existing_files():
    """WH 以外の data/*.json（既存の手帖のデータ）"""
    return sorted(p for p in glob.glob(os.path.join(DATA, "*.json")) if os.path.basename(p) not in WH_FILES)


def full_build():
    for script in ("build_notebooks.py", "build_fb.py"):
        subprocess.run([sys.executable, os.path.join(HERE, script)], check=True, cwd=ROOT,
                       stdout=subprocess.DEVNULL)


def wh_rows():
    with open(WH_CSV, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


class BuildWHTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = {p: md5(p) for p in existing_files()}
        full_build()
        cls.after = {p: md5(p) for p in existing_files()}

    def test_existing_unchanged(self):
        names = {os.path.basename(p) for p in self.before}
        for n in ("nb_A1.json", "nb_A2.json", "nb_B1.json", "nb_B2.json", "idmap.json", "excl_PT.json",
                  "fb_A1.json", "fb_PT.json", "detail_B1.json", "detail_PT.json"):
            self.assertIn(n, names)
        self.assertEqual(self.before, self.after)

    def test_wh_rows(self):
        src = wh_rows()
        with open(os.path.join(DATA, "nb_WH.json"), encoding="utf-8") as f:
            nb = json.load(f)
        self.assertEqual(len(nb), 100)
        for i, (r, c) in enumerate(zip(nb, src)):
            self.assertEqual(int(c["No"]), i + 1)
            self.assertEqual(len(r), 11, r[0])
            self.assertEqual(r[0], c["word"].strip())
            self.assertEqual(r[1], c["pos"].strip())
            self.assertEqual(r[2], c["japanese"].strip())
            self.assertEqual(r[3], c["example"].strip())
            self.assertTrue(r[4], c["word"])
            self.assertIn(r[4].lower(), c["example"].lower())
            self.assertEqual(r[5], c["category"].strip())
            self.assertIsInstance(r[6], list)
            self.assertNotIn(i, r[6])
            self.assertEqual(r[7], c["example_ja"].strip())
            self.assertEqual(r[8], [])
            self.assertEqual(r[9], c["term"].strip())
            self.assertEqual(r[10], c["era"].strip())
        # 除外番号は対称で、100枚の中に収まる
        for i, r in enumerate(nb):
            for j in r[6]:
                self.assertTrue(0 <= j < 100)
                self.assertIn(i, nb[j][6])
        # 類義語は除外される（carve の synonym に engrave、inscribe の synonym に carve）
        words = [r[0] for r in nb]
        self.assertIn(words.index("carve"), nb[words.index("inscribe")][6])

    def test_wh_detail(self):
        src = wh_rows()
        with open(os.path.join(DATA, "detail_WH.json"), encoding="utf-8") as f:
            det = json.load(f)
        self.assertEqual(len(det), 100)
        nb, dd = {}, {}
        for lv in ("B1", "B2"):
            with open(os.path.join(DATA, f"nb_{lv}.json"), encoding="utf-8") as f:
                nb[lv] = [(r[0], r[1]) for r in json.load(f)]
            with open(os.path.join(DATA, f"detail_{lv}.json"), encoding="utf-8") as f:
                dd[lv] = json.load(f)
        for c, d in zip(src, det):
            if c["level"] == "WH":
                self.assertIsNone(d, c["word"])
            else:
                self.assertIsNotNone(d, c["word"])
            if (c["word"], c["pos"]) in nb["B1"]:
                self.assertEqual(d, dd["B1"][nb["B1"].index((c["word"], c["pos"]))])
        words = [c["word"] for c in src]
        # B1 には名詞しかない collapse（動詞）は B2 の動詞のガイドを使う
        self.assertEqual(det[words.index("collapse")], dd["B2"][nb["B2"].index(("collapse", "v."))])
        self.assertIsNotNone(det[words.index("partition")])  # PT にある語

    def test_wh_fb(self):
        with open(os.path.join(DATA, "fb_WH.json"), encoding="utf-8") as f:
            fb = json.load(f)
        with open(os.path.join(DATA, "nb_WH.json"), encoding="utf-8") as f:
            nb = json.load(f)
        keys = [k for k in fb if not k.startswith("_")]
        self.assertEqual(len(keys), 100)
        for i, r in enumerate(nb):
            d = fb[f"wh-{i + 1}#0"]
            self.assertGreaterEqual(len(d), 3)
            self.assertLessEqual(len(d), 6)
            self.assertNotIn(r[0].lower(), [w.lower() for w in d])
            self.assertEqual(len(set(w.lower() for w in d)), len(d))


if __name__ == "__main__":
    unittest.main()
