#!/usr/bin/env python3
"""
カード画像をWebPに変換するスクリプト
使い方: python3 convert_images.py

新しいカードを追加したときも同じコマンドを実行するだけ。
変換済みのファイルはスキップされます（--forceで強制再変換）。
"""
import os
import sys
import argparse
from pathlib import Path
from PIL import Image

PHOTO_DIR = Path(__file__).parent / "photo"
MAX_WIDTH = 400      # 最大幅（px）
QUALITY = 82         # WebP品質（0-100）

def convert(src: Path, force: bool = False) -> tuple[int, int]:
    """変換実行。(元サイズ, 変換後サイズ) をバイトで返す"""
    dst = src.with_suffix(".webp")
    if dst.exists() and not force:
        return 0, 0  # スキップ

    with Image.open(src) as img:
        w, h = img.size
        if w > MAX_WIDTH:
            new_h = int(MAX_WIDTH * h / w)
            img = img.resize((MAX_WIDTH, new_h), Image.LANCZOS)
        img.save(dst, "WEBP", quality=QUALITY)

    return src.stat().st_size, dst.stat().st_size

def main():
    parser = argparse.ArgumentParser(description="PNG→WebP一括変換")
    parser.add_argument("--force", action="store_true", help="変換済みファイルも再変換")
    args = parser.parse_args()

    pngs = sorted(PHOTO_DIR.glob("*.png"))
    if not pngs:
        print("photo/ フォルダにPNGファイルが見つかりません。")
        sys.exit(1)

    total_orig = total_conv = skipped = converted = 0
    for png in pngs:
        orig, conv = convert(png, force=args.force)
        if orig == 0:
            skipped += 1
            continue
        converted += 1
        total_orig += orig
        total_conv += conv
        reduction = round((1 - conv / orig) * 100)
        print(f"  {png.name:12s} → {png.stem}.webp  {orig//1024}KB → {conv//1024}KB ({reduction}%削減)")

    print(f"\n完了: {converted}枚変換, {skipped}枚スキップ")
    if converted > 0:
        total_reduction = round((1 - total_conv / total_orig) * 100)
        print(f"合計: {total_orig//1024//1024}MB → {total_conv//1024//1024}MB ({total_reduction}%削減)")

if __name__ == "__main__":
    main()
