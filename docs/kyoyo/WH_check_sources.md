# 時の回廊の手帖（世界史）日本語の確認問題 — 出典メモ

- データ：`data/kyoyo_check_WH.json`（4択10問。学習前と100枚収集後の2回、任意）
- 作り方：各時代から2問ずつ。1問は1枚のカード（`no`）の事実だけを問う。問題文と選択肢はカードの例文訳をもとに新しく書いた（市販の問題集の文章は使っていない）。
- 誤りの選択肢は、同じ種類の用語（法典どうし、王朝どうし、条約どうしなど）から、その問題では明らかに正解にならないものを選んだ。
- 正解の確認：カードの出典（Task 2 で2つ以上の資料により確認済み）に加え、2026-11-27 に下の「今回読んで確認」の資料を読み直した。
- 画面では選択肢の順番を毎回入れかえる。`answer` は JSON に書いた順番での正解の位置（0〜3）。
- **飯村さんの確認待ち**（問題文・選択肢の言い回し、難しさ）。
- 選択肢には（巡礼）（聖遷）のような言い換えを付けない（正解だけ見覚えのある言葉になり、ヒントになるため）。
- **問題を直したら** `index.html` の `NB_DATA_VERSION` を上げる（上げないと古い問題が端末に残る）。
- **生徒が学習前のチェックを受けはじめたら、問題は変えない**（学習前と学習後の点数が比べられなくなる）。

| # | 時代 | No | 正解 | 出典（カードと同じ） | 今回読んで確認したこと |
|---|---|---|---|---|---|
| 1 | 古代 | 4 | ハンムラビ法典 | https://www.britannica.com/topic/Code-of-Hammurabi ／ https://www.louvre.fr/en/the-code-of-hammurabi | Britannica：バビロン第1王朝のハンムラビ（在位前1792–前1750）の時代の法典、「目には目を、歯には歯を」（同害復讐）を含む。 |
| 2 | 古代 | 15 | 秦 | https://www.britannica.com/place/China/The-Qin-empire-221-207-bce ／ https://whc.unesco.org/en/list/441 | Britannica：秦が前221年に中国を統一し、王が「始皇帝」の称号を名乗った。 |
| 3 | 中世 | 24 | ヒジュラ（聖遷） | https://www.britannica.com/event/Hijrah-Islam ／ https://www.iis.ac.uk/glossary/hijra/ | 今回は読み直せなかった（ページを開く許可が得られなかった）。Task 2 の確認（622年、メッカからメディナへの移住）に基づく。 |
| 4 | 中世 | 33 | マグナ＝カルタ | https://www.parliament.uk/magnacarta ／ https://origins.osu.edu/milestones/january-2015-magna-carta-and-its-legacy | 英国議会：1215年に最初の版が出され、有力者の反乱から生まれ、国王の権力を制限した。ジョン王の名前はカードの例文と OSU の資料による。 |
| 5 | 近世 | 44 | ルター | https://www.britannica.com/print/article/415676 ／ https://ebsco.com/research-starters/history/luther-posts-his-ninety-five-theses | EBSCO：1517年に「九十五カ条の論題」を掲げ、贖宥状の販売に異議を唱え、宗教改革の始まりとなった。 |
| 6 | 近世 | 53 | ウェストファリア条約 | https://britannica.com/event/Peace-of-Westphalia ／ https://blogs.loc.gov/law/2017/10/the-peace-of-westphalia/ | Britannica：1648年のウェストファリア条約で三十年戦争が終わった。 |
| 7 | 近代 | 63 | 人権宣言 | https://www.britannica.com/topic/Declaration-of-the-Rights-of-Man-and-of-the-Citizen ／ https://www.elysee.fr/en/french-presidency/the-declaration-of-the-rights-of-man-and-of-the-citizen | Britannica：1789年8月下旬に国民議会が採択。第1条「人は自由で、権利において平等なものとして生まれ、存在する」。 |
| 8 | 近代 | 73 | スエズ運河 | https://www.history.com/this-day-in-history/november-17/suez-canal-opens ／ https://www.smithsonianmag.com/smart-news/how-the-groundbreaking-suez-canal-forever-transformed-the-worlds-shipping-routes-180985273/ | History.com：1869年11月17日に開通、地中海と紅海を結ぶ。 |
| 9 | 現代 | 81 | サライェヴォ事件 | https://britannica.com/biography/Franz-Ferdinand-Archduke-of-Austria ／ https://nzhistory.govt.nz/page/assassination-archduke-ferdinand | NZHistory：1914年6月28日、オーストリア＝ハンガリーの帝位継承者フランツ＝フェルディナントがサライェヴォで暗殺され、第一次世界大戦につながった。暗殺者はボスニアのセルビア人民族主義の団体の一員。 |
| 10 | 現代 | 95 | キューバ危機 | https://www.jfklibrary.org/JFK/JFK-in-History/Cuban-Missile-Crisis.aspx ／ https://www.smithsonianmag.com/air-space-magazine/kennedys-evidence-39798668/ | JFK図書館：1962年10月、キューバでソ連が建設中の核ミサイル基地が撮影され、世界は核戦争の瀬戸際に立った。 |

## 弱いところ・確認してほしいこと

- 第3問（ヒジュラ）は今回の読み直しができていない。事実は広く知られたもので、カード作成時に2つの資料で確認済み。
- 第9問の「セルビア系の青年」はカードの例文訳の表現に合わせた（NZHistory は「ボスニアのセルビア人民族主義の団体の一員」）。
- 第3問の選択肢（ハッジ／ヒジュラ／ジハード／ラマダーン）はイスラーム用語どうしにしたが、「ハッジ」「ラマダーン」は教科書によって扱いが小さい。別の用語にしたいときは JSON の choices を直し、`NB_DATA_VERSION` を上げる（学習前のチェックが始まる前に）。
