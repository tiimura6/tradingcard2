"""カードのイラストに、枠・英単語・品詞・意味・手帖名を重ねて、アプリ用のカード画像を作る

使い方:
  python3 tools/cardimg/make_card_images.py <イラストのフォルダ> <画像リポジトリのフォルダ> [--refresh]
    --refresh … すでに公開した画像を描き直したとき（利用者の端末に保存された古い画像を読み直させる）
    イラストのファイル名はカードIDか「手帖_番号」: a1-1.png / A1_0001.jpg / card-25.webp など
    （鉄=a1 銅=a2 銀=b1 金=b2 白金=card または pt）
  先に tools/cardimg/export_meta.js で card_meta.json を作っておく

出力（画像リポジトリの中）:
  {手帖}/{カードID}.webp      … 拡大表示用 600×992
  {手帖}/t/{カードID}.webp    … 一覧用   240×397
  manifest.json               … 画像があるカードの一覧（アプリはこれを見て絵を使う。ないカードは今までの文字カード）
イラストは横長〜正方形がおすすめ（カード上部の窓に、中央を基準に切り抜いて入れる。文字は入れない）
"""
import json, os, re, sys, glob, time
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_JA = ('/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', 0)
FONT_EN = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
FONT_IT = '/usr/share/fonts/truetype/dejavu/DejaVuSerifCondensed-Italic.ttf'
W, H = 600, 992          # 拡大表示用（アプリの文字カード 400×661 の1.5倍）
TW = 240                 # 一覧用の幅
S = W / 400              # 400×661 の座標から拡大する倍率
ART = (26, 26, 374, 300) # イラストの窓（400×661 の座標）※今は内側いっぱいに敷く
PANEL_ALPHA = 0.62      # 文字の下の暗い膜の濃さ（0=透明〜1=真っ黒）。上げるほど文字は読みやすく、絵は見えにくい
RARITY_COL = {'UR': '#ff80ff', 'SR': '#f0c840', 'R': '#6aa8ff'}
PREFIX = {'a1': 'A1', 'a2': 'A2', 'b1': 'B1', 'b2': 'B2', 'card': 'PT', 'pt': 'PT'}

def hexrgb(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def font(path, size, index=0): return ImageFont.truetype(path, int(size * S), index=index)
def sc(*v): return [int(round(x * S)) for x in v]

def gradient(size, c0, c1, c2):
    """左上→右下の3色グラデーション"""
    w, h = size
    base = Image.new('RGB', (w, h))
    px = base.load()
    a, b, c = hexrgb(c0), hexrgb(c1), hexrgb(c2)
    for y in range(h):
        for x in range(0, w, 2):
            t = (x / w + y / h) / 2
            if t < .5: k = t / .5; col = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
            else: k = (t - .5) / .5; col = tuple(int(b[i] + (c[i] - b[i]) * k) for i in range(3))
            px[x, y] = col
            if x + 1 < w: px[x + 1, y] = col
    return base

_inner = None
def inner_bg():
    """内側の暗い背景（中心が明るい放射グラデーション）"""
    global _inner
    if _inner is None:
        w, h = sc(372, 633)
        im = Image.new('RGB', (w, h))
        px = im.load(); cx, cy, r = w * .5, h * .38, max(w, h) * .75
        a, b = hexrgb('#2e2456'), hexrgb('#0d0a1e')
        for y in range(h):
            for x in range(w):
                t = min(1, ((x - cx) ** 2 + (y - cy) ** 2) ** .5 / r)
                px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
        _inner = im
    return _inner

def rounded_mask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], int(r), fill=255)
    return m

def fit_text(draw, text, fnt_path, size, max_w, index=0):
    """幅に収まるまで文字を小さくする"""
    while size > 10:
        f = font(fnt_path, size, index)
        if draw.textlength(text, font=f) <= max_w * S: return f
        size -= 2
    return font(fnt_path, size, index)

def compose(meta, art_path):
    c0, c1, c2 = meta['colors']
    card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    card.paste(gradient((W, H), c0, c1, c2), (0, 0), rounded_mask((W, H), 28 * S))
    ib = inner_bg()
    card.paste(ib, tuple(sc(14, 14)), rounded_mask(ib.size, 20 * S))
    # イラスト：カードの内側いっぱいに敷く（中央を基準に切り抜き）。2026-11-06 Takaの指示で、文字の下も絵が透けて見える形に
    ix0, iy0 = sc(14, 14); iw, ih = ib.size
    art = Image.open(art_path).convert('RGB')
    r = max(iw / art.width, ih / art.height)
    art = art.resize((max(iw, int(art.width * r + .5)), max(ih, int(art.height * r + .5))), Image.LANCZOS)
    l, t = (art.width - iw) // 2, int((art.height - ih) * .35)   # 少し上寄り（主役が上の窓に入るように）
    art = art.crop((l, t, l + iw, t + ih)).convert('RGBA')
    # 文字の下だけ暗い半透明の膜を重ねる：上の窓（〜y=250）は透明、そこから徐々に濃く（最大で不透明度 PANEL_ALPHA）
    veil = Image.new('RGBA', (iw, ih), hexrgb('#0d0a1e') + (0,))
    va = Image.new('L', (iw, ih), 0); vd = ImageDraw.Draw(va)
    y0, y1 = int((236 - 14) * S), int((340 - 14) * S)
    for y in range(ih):
        k = 0 if y < y0 else min(1, (y - y0) / (y1 - y0))
        vd.line([(0, y), (iw, y)], fill=int(255 * PANEL_ALPHA * (k ** 1.3)))
    veil.putalpha(va)
    art.alpha_composite(veil)
    art.putalpha(rounded_mask((iw, ih), 20 * S))
    card.alpha_composite(art, (ix0, iy0))
    d = ImageDraw.Draw(card)
    # 枠（手帖の色・レアリティの色）
    d.rounded_rectangle(sc(26, 26, 374, 635), int(14 * S), outline=hexrgb(c1) + (140,), width=int(2 * S))
    rc = RARITY_COL.get(meta['rarity'])
    if rc: d.rounded_rectangle(sc(26, 26, 374, 635), int(14 * S), outline=hexrgb(rc) + (210,), width=int(4 * S))
    # 英単語・品詞・意味・手帖名
    word = meta['word']
    base = 72 if len(word) <= 5 else 64 if len(word) <= 7 else 54 if len(word) <= 9 else 44 if len(word) <= 12 else 36 if len(word) <= 16 else 28
    fw = fit_text(d, word, FONT_EN, base, 330)
    d.text((200 * S, 338 * S), word, font=fw, fill='#ffffff', anchor='mm', stroke_width=int(2 * S), stroke_fill=(10, 6, 24))
    d.text((200 * S, 380 * S), meta['pos'], font=fit_text(d, meta['pos'], FONT_IT, 22, 320), fill='#d8ceef', anchor='mm', stroke_width=int(1.5 * S), stroke_fill=(10, 6, 24))
    d.line(sc(90, 400, 310, 400), fill=hexrgb(c1) + (150,), width=max(1, int(1.5 * S)))
    for i, t in enumerate(meta['ja'][:3]):
        sz = 38 if len(t) <= 6 else 32 if len(t) <= 9 else 27 if len(t) <= 12 else 22
        d.text((200 * S, (446 + i * 52) * S), t, font=fit_text(d, t, FONT_JA[0], sz, 330, FONT_JA[1]), fill='#f3ead6', anchor='mm', stroke_width=int(2 * S), stroke_fill=(10, 6, 24))
    d.text((200 * S, 608 * S), meta['nbName'], font=font(FONT_JA[0], 17, FONT_JA[1]), fill=hexrgb(c1) + (240,), anchor='mm', stroke_width=int(1.2 * S), stroke_fill=(10, 6, 24))
    return card

def card_id(fname):
    m = re.match(r'(?i)^(a1|a2|b1|b2|card|pt)[-_ ]?0*(\d+)$', os.path.splitext(os.path.basename(fname))[0])
    if not m: return None
    p = m.group(1).lower()
    return ('card' if p in ('card', 'pt') else p) + '-' + str(int(m.group(2)))

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    refresh = '--refresh' in sys.argv   # すでにある画像を描き直したとき：端末に保存された古い画像を読み直させる
    src, out = args[0], args[1]
    metas = {m['id']: m for m in json.load(open(os.path.join(HERE, 'card_meta.json'), encoding='utf-8'))}
    done, skipped = 0, []
    for f in sorted(glob.glob(os.path.join(src, '*'))):
        if not re.search(r'(?i)\.(png|jpe?g|webp)$', f): continue
        cid = card_id(f)
        if not cid or cid not in metas: skipped.append(os.path.basename(f)); continue
        meta = metas[cid]
        im = compose(meta, f).convert('RGB')
        os.makedirs(os.path.join(out, meta['nb'], 't'), exist_ok=True)
        im.save(os.path.join(out, meta['nb'], cid + '.webp'), 'WEBP', quality=80, method=6)
        im.resize((TW, round(H * TW / W)), Image.LANCZOS).save(os.path.join(out, meta['nb'], 't', cid + '.webp'), 'WEBP', quality=74, method=6)
        done += 1
    # 画像リポジトリにあるカードの一覧（手帖ごとの番号）
    have = {}
    for f in glob.glob(os.path.join(out, '*', '*.webp')):
        cid = os.path.splitext(os.path.basename(f))[0]
        if cid in metas and os.path.exists(os.path.join(os.path.dirname(f), 't', cid + '.webp')):
            have.setdefault(metas[cid]['nb'], []).append(metas[cid]['no'])
    for k in have: have[k].sort()
    old = {}
    try: old = json.load(open(os.path.join(out, 'manifest.json')))
    except Exception: pass
    rev = int(old.get('rev', 1)) + (1 if refresh else 0)
    json.dump({'ver': time.strftime('%Y%m%d%H%M%S'), 'rev': rev, 'have': have}, open(os.path.join(out, 'manifest.json'), 'w'), separators=(',', ':'))
    print(f'作成 {done}枚 / 画像があるカード 合計{sum(len(v) for v in have.values())}枚' + (f' / 名前が分からず飛ばした {len(skipped)}件: {skipped[:10]}' if skipped else ''))

if __name__ == '__main__':
    main()
