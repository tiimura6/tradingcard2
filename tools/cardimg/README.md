# カードのイラスト画像

## イラストの作り方（制作側）
- 形：横長〜正方形（例 1024×1024、1200×900）。カード上部の窓に、中央を基準に切り抜いて入れる
- 文字は入れない（英単語・品詞・意味・手帖名・枠はツールが重ねる）
- 大事なものは中央に。上下左右の端は少し切れることがある
- ファイル名：カードID（`a1-1.png`）か「手帖_番号」（`A1_0001.jpg`）
  - 鉄=a1 銅=a2 銀=b1 金=b2 白金=card（または pt）。番号は手帖のカード番号（No.）
- 形式：PNG / JPG / WebP

## 画像にする（Claude側の作業）
1. `python3 -m http.server 8765` を起動して `NODE_PATH=$(npm root -g) node tools/cardimg/export_meta.js tools/cardimg/card_meta.json`
2. `python3 tools/cardimg/make_card_images.py <イラストのフォルダ> <画像リポジトリ>`（描き直したときは `--refresh`）
3. 画像リポジトリ（tradingcard-img）にコミットして公開 → アプリは manifest.json を見て自動で絵を使う

## 出力
- `{手帖}/{カードID}.webp`（拡大用 600×992、約40KB）／`{手帖}/t/{カードID}.webp`（一覧用 240×397、約9KB）
- `manifest.json`（絵があるカードの一覧。無いカードは今までどおり文字のカード）
- 全8,324枚で約400MB。1つのリポジトリ（GitHub Pages は1GBまで）に収まる見込み
