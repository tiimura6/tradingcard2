#!/usr/bin/env python3
"""
冒険の背景（bgm/adventure-bg.jpg）から、冒険の道の6つの地域の背景を作る。
地域ごとに「元画像のどこを切り出すか」と「色合い」を変えて、別の場所に見えるようにする。

  bgm/adv_area0.jpg ささやきの森（元の色・左の森）
  bgm/adv_area1.jpg 霧の洞窟（暗い青・森の奥）
  bgm/adv_area2.jpg 星降る丘（夜の紫・空と山）
  bgm/adv_area3.jpg 古代の遺跡（夕暮れの琥珀色・石碑）
  bgm/adv_area4.jpg 竜の山脈（燃える赤・雪山）
  bgm/adv_area5.jpg 天空の城（明るい空色・城）

使い方: python3 tools/make_adventure_backgrounds.py --force
※ 2026-11 から、6地域とも作者が用意した画像（adv_area0〜5.jpg）を使っている。
  このスクリプトは既にある画像を上書きしない（--force を付けたときだけ作り直す）。
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "bgm" / "adventure-bg.jpg"
OUT_W, OUT_H = 1600, 893

def hex2rgb(h):
    h = h.lstrip("#"); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255

# crop = (左, 上, 右, 下) の割合
AREAS = [
    dict(crop=(0.00, 0.10, 0.62, 0.95), shadow=None),
    dict(crop=(0.00, 0.30, 0.45, 1.00), shadow="#02040c", mid="#1c3a6e", high="#9fd0ff", mix=0.80, bright=0.78, glow=1.45, blur=1.0),
    dict(crop=(0.08, 0.00, 0.78, 0.62), shadow="#06021a", mid="#4a2a8a", high="#f0d8ff", mix=0.78, bright=0.72, glow=1.4, stars=True),
    dict(crop=(0.02, 0.38, 0.52, 1.00), shadow="#1a0a02", mid="#9a5a1a", high="#ffe2a0", mix=0.70, bright=0.95, glow=1.25),
    dict(crop=(0.10, 0.08, 0.62, 0.62), shadow="#1a0200", mid="#b0301a", high="#ffd090", mix=0.74, bright=0.9, glow=1.35),
    dict(crop=(0.45, 0.25, 0.85, 0.68), shadow="#203050", mid="#7ab8e8", high="#ffffff", mix=0.55, bright=1.12, glow=1.3),
]

def grade(a, shadow, mid, high, mix, bright, glow, **_):
    luma = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])[..., None]
    s, m, h = hex2rgb(shadow), hex2rgb(mid), hex2rgb(high)
    gm = np.where(luma < .5, s + (m - s) * np.clip(luma * 2, 0, 1), m + (h - m) * np.clip(luma * 2 - 1, 0, 1))
    out = (a * (1 - mix) + gm * mix) * bright
    out = out + np.clip(luma - .65, 0, 1) * (glow - 1) * 2
    return np.clip(out, 0, 1)

def add_stars(a, seed=3):
    rng = np.random.default_rng(seed)
    H, W = a.shape[:2]
    for _ in range(420):
        y, x = rng.integers(0, int(H * .45)), rng.integers(0, W)
        r = rng.choice([1, 1, 1, 2])
        v = rng.uniform(.6, 1)
        a[max(0, y - r):y + r, max(0, x - r):x + r] = np.maximum(a[max(0, y - r):y + r, max(0, x - r):x + r], v)
    return a

def main():
    import sys
    force = '--force' in sys.argv
    src = Image.open(SRC).convert("RGB")
    W, H = src.size
    for i, g in enumerate(AREAS):
        l, t, r, b = g["crop"]
        im = src.crop((int(W * l), int(H * t), int(W * r), int(H * b)))
        # 横長（16:9）にそろえる
        cw, ch = im.size
        target = OUT_W / OUT_H
        if cw / ch > target:
            nw = int(ch * target); im = im.crop(((cw - nw) // 2, 0, (cw - nw) // 2 + nw, ch))
        else:
            nh = int(cw / target); im = im.crop((0, (ch - nh) // 2, cw, (ch - nh) // 2 + nh))
        im = im.resize((OUT_W, OUT_H), Image.LANCZOS)
        if g.get("blur"): im = im.filter(ImageFilter.GaussianBlur(g["blur"]))
        a = np.asarray(im, dtype=np.float32) / 255
        if g["shadow"]: a = grade(a, **g)
        if g.get("stars"): a = add_stars(a)
        dst = ROOT / "bgm" / f"adv_area{i}.jpg"
        if dst.exists() and not force:
            print(dst.name, '既にあるので作らない'); continue
        Image.fromarray((a * 255).astype(np.uint8)).save(dst, "JPEG", quality=84, optimize=True, progressive=True)
        print(dst.name, dst.stat().st_size // 1024, "KB")

if __name__ == "__main__":
    main()
