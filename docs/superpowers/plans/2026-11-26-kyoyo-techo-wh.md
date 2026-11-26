# 教養の手帖 第1弾「時の回廊の手帖（世界史）」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 世界史の知識を例文と絵に埋め込んだ100枚の独立した手帖（key `WH`）を作り、アプリに追加する。

**Architecture:** カードデータは新しいCSV `data/kyoyo_WH.csv` に作り、既存の `tools/build_notebooks.py` を拡張して `data/nb_WH.json` を出力する。アプリ側は `NOTEBOOKS` に `side: true` の手帖を1つ足し、鉄〜白金の解禁の連鎖・全手帖コンプリート・殿堂入り・通しタブ番号からは外す。背景・ボス・BGMなどの素材は銀（B1）のものを流用する。

**Tech Stack:** 単一ファイルの `index.html`（素のJS）、Python 3（データ生成）、Playwright（`tests/regression.js`）、GAS（`gas/Code.gs`）。

**Spec:** `docs/superpowers/specs/2026-11-26-kyoyo-techo-design.md`（承認済み 2026-11-26、世界観A＝各科目が世界地図の1地方）

## Global Constraints

- 既存5手帖（A1/A2/B1/B2/PT）のデータ・例文・絵・カードIDは変更しない。`data/cefrj_notebooks.csv` も触らない。
- 1枚＝ターゲット単語1つ＋知識項目1つ（1文1事実）。全100枚。
- ターゲット単語は銀・金・白金の語彙から選ぶ。
- 和訳に教科書どおりの用語を必ず入れ、カード上で強調表示する。
- カード番号は年代順。古代・中世・近世・近代・現代の5時代×20枚（No.1〜20＝古代 … No.81〜100＝現代）。
- 全カードの事実を2つ以上の信頼できる情報源で確認し、出典を残す。
- 絵画の実物は作者の死後70年を過ぎた作品のみ。存命の実在人物は描かない。
- 竜・魔法使いなど架空の存在は、科目のカードの例文にも絵にも出さない（金の手帖の世界観例外語は使わない）。
- 将来の科目（地理・生物など）も同じ仕組みで足せるよう、手帖固有の値（名前・色・時代名など）は `NOTEBOOKS` の1項目にまとめ、`WH` を名指しする分岐を書かない。
- 例文・画像生成用の文言は既存カードと重複させない。市販教材の文章は使わない。
- 出題はターゲット単語を英語で問う。知識は問わない。
- WH は銀の手帖が開いた時点で開く。
- 日本語の確認問題：4択10問、学習前と100枚収集後の2回、任意。普段のクイズ・バトルには出さない。
- 画像生成用エクセルは1ファイル50語まで。
- 利用者向けの文言は「先生」ではなく「管理者」。

## Review Focus

1. **すでに銀を開いている既存ユーザー** — 保存済みの `notebookState` に WH がなくても、起動時に WH が開く。（Task 5 にテスト）
2. **全手帖コンプリート・殿堂入り・実績「8,324枚」** — WH を足しても条件と表示が変わらない。（Task 5 にテスト）
3. **WH を開いたまま再読み込み** — 起動時に `nb_WH.json` を読み、読めなければ従来どおり警告して他の手帖で起動する。（Task 5 にテスト）
4. **既存手帖と同じ単語**（例：abolish が金にも WH にもある）— カードIDが別（`wh-`）で、★の記録や所持が混ざらない。（Task 5 にテスト）
5. **クラウド保存** — `wh-` のカードIDが GAS 側で「存在しないカード番号」に数えられない。（Task 8 にテスト）

---

### Task 1: カードデータの検証スクリプト

データの契約を先に固める。以降の作成はすべてこれを通す。

**Files:**
- Create: `tools/check_kyoyo.py`
- Test: `tools/test_check_kyoyo.py`
- Create: `tools/kyoyo_fixtures/`（テスト用の小さいCSV）

**Interfaces:**
- Produces: `check(csv_path: str, final: bool) -> list[str]`（エラー文の一覧。空なら合格）。`final=False`（見本）は枚数・連番の検査を飛ばす。CLI：`python3 tools/check_kyoyo.py data/kyoyo_WH.csv --final`（不合格なら終了コード1）
- Produces: `load_vocab() -> set[str]`（B1/B2 は `data/cefrj_notebooks.csv` の `word`、PT は `index.html` の `const quizList = {` 内の `answer: '…'` を正規表現で取り出す。小文字化）
- CSVの列（この順）：既存の15列 `notebook,image_url,image,No,word,pos,japanese,example,example_ja,answers,level,category,level_badge,level_color,synonym` ＋ `subject,era,term,sources`
  - `notebook`=`WH`、`subject`=`世界史`、`era` は `古代|中世|近世|近代|現代`、`term`＝教科書用語（例：`宗教改革`）、`sources`＝URLを ` | ` で区切る

- [ ] **Step 1: 失敗するテストを書く** — 各テストは fixtures の1つのCSVを読み、エラー文に次の語が含まれることを確かめる
  - `test_ok_sample`：No.1,2,21,22,41,42,61,62,81,82 の正しい10行 → `check(..., final=False) == []`
  - `test_count`：`final=True` で10行 → `"枚数"`（100行でないと不合格）
  - `test_no_sequence`：`final=True` で No が 1,2,4… → `"No"`（重複・欠番も不合格）
  - `test_era_order`：No.21 に `古代` → `"時代"`（`era` は No で決まる：`["古代","中世","近世","近代","現代"][(No-1)//20]`）
  - `test_word_in_example`：例文にターゲット単語（活用形を含む）がない → `"例文"`
  - `test_term_in_ja`：`term` が `example_ja` に含まれない → `"教科書用語"`
  - `test_sources`：URLが1つ → `"出典"`
  - `test_level`：ターゲット単語が `load_vocab()` にない → `"語彙"`
  - `test_dup_word`：同じ単語・品詞が WH の中で2行 → `"重複"`
  - `test_fantasy`：例文か `image` に dragon/wizard/knight/giant/elf/fairy/magic/spell（活用形・複数形含む）→ `"架空"`
  - `test_dup_example`：`example` か `image` が既存CSVの行と完全一致 → `"重複"`
- [ ] **Step 2: 実行して失敗を確かめる** — `python3 -m unittest tools/test_check_kyoyo.py -v` → 全件 FAIL（`check` が未定義）
- [ ] **Step 3: `check()` を実装** — 活用形の判定は `tools/build_notebooks.py` の `find_form(word, example)` を import して使う（空文字なら不合格）
- [ ] **Step 4: 実行して合格を確かめる** — 同じコマンド → 全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 教養の手帖のカードデータ検証スクリプト"`

### Task 2: 見本10枚（飯村さんの確認で止まる）

**Files:**
- Create: `data/kyoyo_WH.csv`（この時点では10行。各時代2枚：No.1,2,21,22,41,42,61,62,81,82）
- Create: `docs/kyoyo/WH_sample_review.md`（確認用の一覧表）

**Interfaces:**
- Consumes: Task 1 の `check()` と列の定義

- [ ] **Step 1: 100項目の選定表を作る** — `docs/kyoyo/WH_topics.md` に No・時代・教科書用語・地域を年代順で100行。地域が偏らないように（東アジア・南アジア・西アジア・ヨーロッパ・アメリカ・アフリカがそれぞれ最低5項目）
- [ ] **Step 2: 見本10枚の各行を書く** — 単語の意味と史実が噛み合う組み合わせだけ選ぶ（例：abolish × 奴隷制廃止）。例文は金の手帖と同程度の語彙・長さで、固有名詞は出す。`image` は既存CSVと同じ締めの文言（`timeless hand-painted fantasy storybook world … no text`）に合わせ、存命人物を描かない。パブリックドメインの絵画を使うカードは `image_url` にその絵の出所URLを入れる
- [ ] **Step 3: 事実確認** — 各行について WebSearch/WebFetch で2つ以上の情報源を確かめ、`sources` に記入
- [ ] **Step 4: 検証** — `python3 tools/check_kyoyo.py data/kyoyo_WH.csv` → エラーなし
- [ ] **Step 5: 確認用の一覧を飯村さんに送り、承認を待つ** — 単語・例文・和訳（教科書用語を太字）・知識項目・絵の文言・出典の表。**承認まで Task 3 以降に進まない。** 指摘はCSVと選定表に反映して再提出
- [ ] **Step 6: コミット** — `git commit -m "content: 教養の手帖（世界史）見本10枚"`

### Task 3: 残り90枚

**Files:**
- Modify: `data/kyoyo_WH.csv`（100行に）

- [ ] **Step 1: Task 2 の承認内容と選定表に沿って90枚を書き、事実確認する**（Task 2 の Step 2〜3 と同じ基準）
- [ ] **Step 2: 検証** — `python3 tools/check_kyoyo.py data/kyoyo_WH.csv --final` → エラーなし
- [ ] **Step 3: 抜き取り確認用の20枚（各時代4枚、無作為）を飯村さんに送る** — 指摘があれば同種の誤りを全行で見直す
- [ ] **Step 4: コミット** — `git commit -m "content: 教養の手帖（世界史）100枚"`

### Task 4: アプリ用データの生成

**Files:**
- Modify: `tools/build_notebooks.py`
- Create: `data/nb_WH.json`、`data/fb_WH.json`、`data/detail_WH.json`
- Test: `tools/test_build_wh.py`

**Interfaces:**
- Produces: `data/nb_WH.json` の1行 ＝ 既存の9要素 `[英単語, 品詞, 日本語, 例文, 語形, カテゴリ, 除外番号, 例文訳, ほかの品詞の意味]` ＋ `r[9]=教科書用語`、`r[10]=時代`。WH は品詞ごとにまとめない（1行＝1枚、`r[8]` は空配列）
- Produces: `data/detail_WH.json` ＝ WH の No 順の配列。各要素は既存手帖（B1→B2→PTの順に探す）の同じ単語の単語ガイドの要素をコピーし、見つからなければ `null`

- [ ] **Step 1: 失敗するテストを書く** — `test_wh_rows`：生成後の `nb_WH.json` が100行、各行の長さ11、`r[9]` が CSV の `term` と一致、`r[10]` が `era` と一致、`r[4]` が空でない。`test_existing_unchanged`：生成前後で `nb_A1.json`〜`nb_B2.json`・`idmap.json`・`excl_PT.json` のハッシュが変わらない
- [ ] **Step 2: 実行して失敗を確かめる** — `python3 -m unittest tools/test_build_wh.py -v` → FAIL
- [ ] **Step 3: `build_notebooks.py` に `build_side(key: str, csv_path: Path) -> None` を足し、`main()` の最後で `build_side('WH', ROOT/'data'/'kyoyo_WH.csv')` を呼ぶ** — 除外番号は既存の `exclusions()` を WH の100行の中で使う
- [ ] **Step 4: 実行して合格を確かめる** — 同じコマンド → PASS
- [ ] **Step 5: 穴埋めのダミーを作る** — `tools/fb_src/INSTRUCTIONS.md` の手順で WH の100問を候補出し → 確認 → `tools/build_fb.py` が `fb_WH.json` も出すようにする。出力が100件あることを確かめる
- [ ] **Step 6: コミット** — `git commit -m "feat: 教養の手帖のアプリ用データ生成"`

### Task 5: 手帖の追加と解禁

**Files:**
- Modify: `index.html`（`NOTEBOOKS` 4593行付近、`notebookState` の初期化 4660行付近、`allCompletion` 5651行、`NB_TAB_OFFSET` 6045行、`adminUnlockAll` 6545行、`openNotebookPicker`・`checkNotebookUnlocks` 10630〜10690行、`getRarity` 3677行、`setImgManifest` 4702行、素材を手帖キーで引く箇所）
- Test: `tests/regression.js`

**Interfaces:**
- Consumes: `data/nb_WH.json`（Task 4）
- Produces:
  - `NOTEBOOKS` の末尾に `{ key: 'WH', name: '時の回廊の手帖（世界史）', level: '世界史 × CEFR-J B1〜', sub: '時の回廊　歴史をめぐる英単語', count: 100, prefix: 'wh', c: [...], gem: '🏺', side: true, opensWith: 'B1', asset: 'B1' }`（色は仮。飯村さんがあとで変えられるよう定数1か所）。冒険の面の見出しに使う `stageNames: ['古代','中世','近世','近代','現代']` もこの項目に持たせる
  - `MAIN_NOTEBOOKS = NOTEBOOKS.filter(n => !n.side)`：連鎖解禁・全手帖コンプリート・通しタブ番号・殿堂入り・ボスラッシュ・レイド・実力診断（`PL_ORDER`）はこちらを使う
  - `nbAssetKey(key = currentNB.key) -> string`：`NB_BY_KEY[key].asset || key`。背景・スライム画像・`BOSS_SIZE`・`PARTICLE_COUNT`・`BATTLE_FX_COUNT`・`ADV_LAST`・バトルの強さ（`globalTab`）など、手帖キーで素材や数値を引くすべての箇所でこれを通す
  - カードのステータス：WH は `globalTab(nbAssetKey('WH'), 0)` ＝ 銀のタブ1と同じ強さ
  - レアリティ：鉄〜金と同じ番号による決め方

- [ ] **Step 1: 失敗するテストを `tests/regression.js` に足す**
  - `教養の手帖：銀が開いていれば開く（保存済みの状態に WH がなくても）` — `notebookState={unlocked:['A1','A2','B1'],current:'B1'}` で起動 → `notebookState.unlocked` に `WH`、手帖一覧に「時の回廊の手帖」
  - `教養の手帖：銀が未開なら鍵つきで「銀の手帖を開くと開く」` — `unlocked:['A1']` → 一覧の WH 行が `locked`、説明に「銀の手帖」
  - `教養の手帖：切り替え・再読み込みで100枚が出る` — WH に切り替え → `cardsData.length===100`、`cardsData[0].id==='wh-1'`、再読み込み後も同じ
  - `教養の手帖：全手帖コンプリート・殿堂入りの条件は変わらない` — `allCompletion().total===8324`、タイトル画面の表示が「鉄〜白金」のまま、殿堂入りの開く条件が既存テストと同じ値
  - `教養の手帖：同じ単語でも金のカードと記録が混ざらない` — WH の abolish を所持・★2 → 金に切り替えて金の abolish は未所持・★0
  - `教養の手帖：データが読めないときは警告して他の手帖で起動` — `nb_WH.json` を 404 にして `current:'WH'` で起動 → alert が出て、`currentNB.key!=='WH'`
- [ ] **Step 2: 実行して失敗を確かめる** — `node tests/regression.js 教養` → 6件 FAIL
- [ ] **Step 3: 上の Interfaces どおりに実装する** — 解禁は `checkNotebookUnlocks()` と `notebookState` の初期化の両方で「`opensWith` の手帖が開いていれば side の手帖も開く」。`NB_DATA_VERSION` を上げる
- [ ] **Step 4: 実行して合格を確かめる** — `node tests/regression.js 教養` → PASS。続けて `npm test` で既存の全テストも PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 教養の手帖（世界史）を独立した手帖として追加"`

### Task 6: 教科書用語の強調と冒険の時代表示

**Files:**
- Modify: `index.html`（カード拡大表示・単語ガイドの例文訳の描画、`ADV_AREAS` を使う冒険の見出し 9723行付近）
- Test: `tests/regression.js`

**Interfaces:**
- Consumes: `nb_WH.json` の `r[9]`（教科書用語）・`r[10]`（時代）。`buildCardsFor` で `quiz.term`・`quiz.era` に入れる
- Produces: `highlightTerm(ja: string, term: string) -> string`（`term` の最初の出現を `<b class="kyo-term">` で囲む。HTMLの特殊文字はエスケープしてから囲む）

- [ ] **Step 1: 失敗するテストを足す**
  - `教養の手帖：例文訳の教科書用語が強調される` — WH の1枚を拡大 → 例文訳に `.kyo-term` があり、中身が `r[9]`。架空の存在（dragon, wizard, knight, giant, elf, fairy, magic, spell）が WH の例文・絵の文言に1つもない（`tools/check_kyoyo.py` でも検査する）
  - `教養の手帖：冒険の各面に時代名が出る` — WH で冒険を開始 → 1面の見出しに「古代」。進み具合を4面に設定 → 「近代」。WH の最終面は5面（`ADV_LAST` は銀と同じ4）
  - `教養の手帖：幅360pxで強調・時代名がはみ出さない` — 既存の幅360pxのテストと同じ確かめ方
- [ ] **Step 2: 実行して失敗を確かめる** — `node tests/regression.js 教養` → 新しい3件 FAIL
- [ ] **Step 3: 実装** — 手帖に `stageNames` があれば、その `[面の番号]` を地域名の前に「古代・はじまりの草原」の形で付ける。背景・BGMは既存の面のまま
- [ ] **Step 4: 実行して合格を確かめる** — `npm test` → 全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 教養の手帖の教科書用語強調と冒険の時代表示"`

### Task 7: 日本語の確認問題

**Files:**
- Create: `data/kyoyo_check_WH.json`
- Modify: `index.html`（設定画面に入口、確認問題の画面、`logEvent`）
- Test: `tests/regression.js`

**Interfaces:**
- `data/kyoyo_check_WH.json` ＝ `{ "items": [ { "q": "問題文", "choices": ["","","",""], "answer": 0, "no": 12 } ×10 ] }`（`no` はその知識を扱うカード番号。出典は Task 2 と同じ基準で確認し、`docs/kyoyo/WH_check_sources.md` に残す）
- localStorage `kyoyoCheck` ＝ `{ WH: { pre: { score, at } | null, post: { score, at } | null } }`
- `logEvent('kyoyo_check', null, null, { nb: 'WH', phase: 'pre'|'post', score })`

- [ ] **Step 1: 10問を作り、飯村さんに確認してもらう** — 問題文は日本語、教科書用語で問う。市販問題集の文章は使わない
- [ ] **Step 2: 失敗するテストを足す**
  - `確認問題：WH を初めて開いたとき「学習前のチェック（任意）」を1回だけ案内し、スキップできる`
  - `確認問題：学習後のチェックは WH を100枚集めるまで押せない／集めると押せる`
  - `確認問題：結果が kyoyoCheck と logEvent に記録され、同じ段階は2回受けられない`
  - `確認問題：普段のクイズ・冒険・バトルには日本語の確認問題が出ない`（WH で冒険20問・バトル1戦を回し、`kyoyo_check_WH.json` の問題文が一度も表示されない）
- [ ] **Step 3: 実行して失敗を確かめる** — `node tests/regression.js 確認問題` → FAIL
- [ ] **Step 4: 実装** — 4択の画面は既存のクイズ画面の見た目に合わせる。結果画面には学習前と学習後の点数を並べるだけで、知識の解説は出さない
- [ ] **Step 5: 実行して合格を確かめる** — `npm test` → 全件 PASS
- [ ] **Step 6: コミット** — `git commit -m "feat: 教養の手帖の日本語確認問題（学習前・後）"`

### Task 8: GAS と画像用エクセル

**Files:**
- Modify: `gas/Code.gs`（`NOTEBOOKS` に `{ key: 'WH', name: '時の回廊（世界史）', prefix: 'wh-', count: 100 }`。`TOTAL_CARDS` は 8324 のまま＝全手帖コンプリートの計算に WH を入れない。効果検証レポートに `kyoyo_check` の集計列を足す）
- Test: `tests/gas-e2e.js`
- Create: `docs/kyoyo/WH_images_001-050.xlsx`、`docs/kyoyo/WH_images_051-100.xlsx`、`docs/kyoyo/WH_public_domain.md`

- [ ] **Step 1: 失敗するテストを足す** — `tests/gas-e2e.js` に `wh-1` を所持したユーザーを保存 → 不正の見える化で `badIds===0`、`nbCounts` に WH の1枚。`kyoyo_check` のログがレポートに出る
- [ ] **Step 2: 実行して失敗を確かめる** — `node tests/gas-e2e.js` → FAIL
- [ ] **Step 3: `Code.gs` を直す**
- [ ] **Step 4: 実行して合格を確かめる** — 同じコマンド → PASS
- [ ] **Step 5: 画像用エクセルを作る** — 既存の白金用エクセルと同じ列（No・カードID・単語・画像生成用の文言）で50枚ずつ。パブリックドメインの絵画を使うカードは文言の代わりに「絵画：作品名・作者・没年・出所URL」と書き、`WH_public_domain.md` に一覧（コンテスト提出前の確認用）
- [ ] **Step 6: コミット** — `git commit -m "feat: GASを教養の手帖に対応／画像用エクセル"`

### Task 9: 引き渡し

- [ ] **Step 1: 最終確認** — `npm test`・`node tests/gas-e2e.js`・`python3 -m unittest discover tools` がすべて PASS
- [ ] **Step 2: 飯村さんへの作業依頼をまとめる** — GAS の貼り替えと「デプロイを管理 → 鉛筆 → 新バージョン」、Canva での絵の作成、絵ができたら `tools/cardimg/README.md` の手順で画像化
- [ ] **Step 3: 反映** — 作業はブランチ `kyoyo-techo` に push する。公開中の main への取り込み（マージ）は、飯村さんの確認後に行う
