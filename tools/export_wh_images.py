"""時の回廊の手帖（世界史）の画像用エクセルを data/kyoyo_WH.csv から作る。

出力（50枚ずつ・白金のときと同じ列）:
  docs/kyoyo/WH_images_001-050.xlsx
  docs/kyoyo/WH_images_051-100.xlsx

列: No・カードID・単語・画像生成用の文言
  - ふつうのカード … CSV の image（Canva で描くための英語の文言）
  - パブリックドメインの絵画を使うカード（CSV の image_url が入っている）
    … 「絵画：作品名・作者・没年・出所URL」。予備の文言（絵画を使わないとき用）は5列目に入れる

絵画の作品名・作者・没年は CSV に列がないので、下の PAINTINGS に書く。
image_url があるのに PAINTINGS に載っていないカードがあると止まる（書き忘れ防止）。
一覧は docs/kyoyo/WH_public_domain.md（手で管理。コンテスト提出前の確認用）。

実行: python3 tools/export_wh_images.py
"""
import csv
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'kyoyo_WH.csv')
OUT_DIR = os.path.join(ROOT, 'docs', 'kyoyo')
PREFIX = 'wh-'     # アプリのカードID（NOTEBOOKS の prefix 'wh' ＋ '-' ＋ 番号）
PER_FILE = 50      # 1ファイル50語まで（飯村さんの決まり）

# No → (作品名, 作者, 作者の没年)。作者の死後70年を過ぎた作品だけ（設計書 6.4）
PAINTINGS = {
    43: ('モナ＝リザ', 'レオナルド＝ダ＝ヴィンチ', 1519),
}

HEAD = ['No', 'カードID', '単語', '画像生成用の文言']
EXTRA = '予備の文言（絵画を使わないとき）'


def load():
    with open(SRC, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    rows.sort(key=lambda r: int(r['No']))
    nos = [int(r['No']) for r in rows]
    if nos != list(range(1, len(rows) + 1)):
        sys.exit('No が 1 から連番になっていません')
    return rows


def prompt_cell(r):
    no, url = int(r['No']), r['image_url'].strip()
    if not url:
        return r['image'].strip(), ''
    if no not in PAINTINGS:
        sys.exit(f'No.{no} に image_url があるのに PAINTINGS に作品名・作者・没年がありません')
    title, artist, died = PAINTINGS[no]
    return f'絵画：{title}・{artist}・{died}年没・{url}', r['image'].strip()


def write(rows, start, end):
    wb = Workbook()
    ws = wb.active
    ws.title = f'{start:03d}-{end:03d}'
    part = [r for r in rows if start <= int(r['No']) <= end]
    has_extra = any(r['image_url'].strip() for r in part)
    head = HEAD + ([EXTRA] if has_extra else [])
    ws.append(head)
    for r in part:
        text, spare = prompt_cell(r)
        line = [int(r['No']), PREFIX + r['No'], r['word'].strip(), text]
        if has_extra:
            line.append(spare)
        ws.append(line)
    bold, fill = Font(bold=True), PatternFill('solid', fgColor='F3E2A9')
    for c in ws[1]:
        c.font, c.fill = bold, fill
        c.alignment = Alignment(vertical='center', wrap_text=True)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical='top', wrap_text=True)
    widths = {'A': 6, 'B': 10, 'C': 16, 'D': 90, 'E': 60}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    ws.freeze_panes = 'A2'
    path = os.path.join(OUT_DIR, f'WH_images_{start:03d}-{end:03d}.xlsx')
    wb.save(path)
    return path, len(part)


def main():
    rows = load()
    for start in range(1, len(rows) + 1, PER_FILE):
        end = min(start + PER_FILE - 1, len(rows))
        path, n = write(rows, start, end)
        print(f'{os.path.relpath(path, ROOT)}: {n}枚')


if __name__ == '__main__':
    main()
