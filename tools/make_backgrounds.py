#!/usr/bin/env python3
"""
鉄の手帖の背景（オリジナル background/bg.jpg）から、各手帖の色合いに合わせた背景を作る。

  銅の手帖 → background/bg_A2.jpg（夕焼けの銅色）
  銀の手帖 → background/bg_B1.jpg（月光の銀色）
  金の手帖 → background/bg_B2.jpg（黄金の光）
  白金の手帖 → background/bg_PT.jpg（白金のオーロラ）

使い方: python3 tools/make_backgrounds.py
オリジナルの bg.jpg を差し替えたら、このコマンドを実行し直すだけで4枚とも作り直される。

しくみ：明るさに応じて色を割り当てる「グラデーションマップ」を元の色と混ぜる。
  暗い所 → shadow 色、中間 → mid 色、明るい所 → high 色
  mix   = グラデーションの効き具合（0=元のまま、1=完全に置き換え）
  glow  = 明るい部分（ランタン・魔法の光）を少し強めて、その手帖らしい輝きを出す
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "background" / "bg.jpg"

GRADES = {
    "A2": dict(shadow="#1c0904", mid="#a8522a", high="#ffd9b0", mix=0.62, glow=1.08, sat=1.05),   # 銅
    "B1": dict(shadow="#06080b", mid="#6d7680", high="#e6eaee", mix=0.92, glow=1.06, sat=0.15),   # 銀（冷たい鋼のモノトーン）
    "B2": dict(shadow="#1a0d02", mid="#c4891a", high="#fff3c0", mix=0.68, glow=1.12, sat=0.85),   # 金
    "PT": dict(shadow="#0d0a26", mid="#8a7fe0", high="#ffffff", mix=0.66, glow=1.38, sat=0.6, aurora=0.78),   # 白金（最上位：虹色のオーロラ＋真珠の輝き）
}


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def grade(img: np.ndarray, shadow, mid, high, mix, glow, sat, aurora=0.0):
    luma = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2])[..., None]
    s, m, h = hex2rgb(shadow), hex2rgb(mid), hex2rgb(high)
    lo = np.clip(luma * 2, 0, 1)            # 0〜0.5 の明るさ → shadow→mid
    hi = np.clip(luma * 2 - 1, 0, 1)        # 0.5〜1 の明るさ → mid→high
    gmap = np.where(luma < 0.5, s + (m - s) * lo, m + (h - m) * hi)
    # 彩度の調整（元画像の色をどれだけ残すか）
    gray = np.repeat(luma, 3, axis=2)
    base = gray + (img - gray) * sat
    out = base * (1 - mix) + gmap * mix
    # 明るい部分をほんのり持ち上げる（光の演出）
    out = out + np.clip(luma - 0.6, 0, 1) * (glow - 1.0) * 2.0
    if aurora:
        # 白金だけ：場所によって色相が流れる虹色（シアン→紫→桃→金）を中間〜明部にのせ、真珠のような輝きにする
        H, W = luma.shape[:2]
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        t = (xx / W * 0.9 + yy / H * 0.6 + 0.15 * np.sin(xx / W * 6.0 + yy / H * 3.0))[..., None]
        ph = 2 * np.pi * t
        rainbow = 0.58 + 0.42 * np.concatenate([np.cos(ph), np.cos(ph - 2.1), np.cos(ph - 4.2)], axis=2)
        w = np.clip((luma - 0.12) * 1.6, 0, 1) * aurora
        out = out * (1 - w) + (out * 0.45 + rainbow * 0.55 * np.clip(luma * 1.4 + 0.25, 0, 1.15)) * w
        out = out + np.clip(luma - 0.7, 0, 1) * 0.6        # 強い光は白く飛ばして輝きを出す
    return np.clip(out, 0, 1)


def main():
    src = Image.open(SRC).convert("RGB")
    arr = np.asarray(src, dtype=np.float32) / 255.0
    for key, g in GRADES.items():
        out = grade(arr, **g)
        dst = ROOT / "background" / f"bg_{key}.jpg"
        Image.fromarray((out * 255).astype(np.uint8)).save(dst, "JPEG", quality=86, optimize=True, progressive=True)
        print(f"{dst.name}: {dst.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
