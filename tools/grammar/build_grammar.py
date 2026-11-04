# -*- coding: utf-8 -*-
"""文法の試練の問題データを作る。
出典の考え方：文法項目の範囲は学習指導要領（中学・高校）と CEFR-J の段階を目安に独自に設定。
問題文・選択肢・解説はすべてこのアプリのために独自に作成したもの（市販教材の例文・問題は使っていない）。
各問：(タグ, 問題文(＿＿＿が空所), [正解, 誤答, 誤答, 誤答], 和訳, 解説)
使い方: python3 tools/grammar/build_grammar.py  → data/grammar.json
"""
import json, os, sys

B = '＿＿＿'
Q = {}

Q['A1'] = [
 ('be動詞', f'Kotoha {B} the keeper of the old word shop.', ['is', 'are', 'am', 'be'], 'コトハは古い言葉の店の店主です。', '主語 Kotoha は3人称単数なので be動詞は is。'),
 ('be動詞', f'These cards {B} very rare.', ['are', 'is', 'am', 'be'], 'これらのカードはとても珍しい。', '主語 These cards は複数なので are。'),
 ('be動詞', f'"{B} you a new adventurer?" "Yes, I am."', ['Are', 'Is', 'Do', 'Does'], '「あなたは新しい冒険者ですか。」「はい、そうです。」', 'a new adventurer（名詞）が続く be動詞の疑問文。主語 you には Are。'),
 ('三単現', f'Ren {B} his notebook to school every day.', ['brings', 'bring', 'bringing', 'is bring'], 'レンは毎日学校に手帖を持っていく。', '主語が3人称単数で毎日の習慣なので、動詞に -s を付けて brings。'),
 ('三単現', f'My owl Pip {B} fish. He likes nuts.', ['doesn\'t like', 'don\'t like', 'isn\'t like', 'not likes'], '私のフクロウのピップは魚が好きではない。木の実が好きだ。', '3人称単数の一般動詞の否定は doesn\'t ＋原形。'),
 ('三単現', f'"{B} Mina read English books?" "Yes, she does."', ['Does', 'Do', 'Is', 'Are'], '「ミナは英語の本を読みますか。」「はい、読みます。」', '答えが she does なので、3人称単数の一般動詞の疑問文 Does。'),
 ('現在進行形', f'Look! The slime {B} toward the door.', ['is moving', 'moves', 'move', 'moving'], '見て！スライムがドアのほうへ動いている。', 'Look! で「今まさに」している動作を表すので現在進行形 is moving。'),
 ('現在進行形', f'"What are you doing now?" "I {B} new words in my notebook."', ['am writing', 'write', 'writes', 'was write'], '「今何をしているの。」「手帖に新しい単語を書いているよ。」', 'now の動作を聞かれているので、am writing で答える。'),
 ('can', f'Leo {B} read this old letter. It is in French.', ['can\'t', 'don\'t', 'isn\'t', 'aren\'t'], 'レオはこの古い手紙が読めない。フランス語で書かれているのだ。', '「〜できない」は can\'t ＋動詞の原形。主語が3人称単数でも can の形は変わらない。'),
 ('can', f'"Can you open this box?" "Yes, I {B}."', ['can', 'do', 'am', 'open'], '「この箱を開けられる？」「うん、できるよ。」', 'Can you 〜? には Yes, I can. で答える。'),
 ('命令文', f'{B} quiet in the library, please.', ['Be', 'Are', 'Is', 'Being'], '図書室では静かにしてください。', '形容詞 quiet を使う命令文は Be で始める。'),
 ('命令文', f'{B} touch the red card. It is very hot!', ['Don\'t', 'Not', 'No', 'Doesn\'t'], '赤いカードに触ってはいけない。とても熱いよ！', '「〜してはいけない」は Don\'t ＋動詞の原形。'),
 ('命令文', f'It is a nice day. {B} go to the forest together.', ['Let\'s', 'Let', 'Going', 'Shall'], 'いい天気だ。一緒に森へ行こう。', '「（一緒に）〜しよう」は Let\'s ＋動詞の原形。'),
 ('疑問詞', f'"{B} is your favorite card?" "The golden dragon."', ['Which', 'Who', 'Where', 'When'], '「どれがあなたのお気に入りのカード？」「金色のドラゴンだよ。」', 'いくつかある中の「どれ」を聞くので Which。'),
 ('疑問詞', f'"{B} is the shop?" "It is next to the bakery."', ['Where', 'When', 'Who', 'How'], '「お店はどこ？」「パン屋のとなりだよ。」', '答えが場所なので Where。'),
 ('疑問詞', f'"{B} cards do you have?" "I have twelve."', ['How many', 'How much', 'How old', 'What time'], '「カードを何枚持っているの？」「12枚だよ。」', '数えられるものの数を聞くので How many。'),
 ('疑問詞', f'"{B} notebook is this?" "It\'s Mina\'s."', ['Whose', 'Who', 'Who\'s', 'Where'], '「これは誰の手帖？」「ミナのだよ。」', '答えが「ミナの」なので、持ち主を聞く Whose ＋名詞。'),
 ('過去形', f'We {B} a strange key in the garden yesterday.', ['found', 'find', 'finds', 'are finding'], '私たちは昨日、庭で不思議な鍵を見つけた。', 'yesterday があるので過去形。find の過去形は found（不規則変化）。'),
 ('過去形', f'"Did you see the shooting star last night?" "No, I {B}."', ['didn\'t', 'don\'t', 'wasn\'t', 'haven\'t'], '「昨夜、流れ星を見た？」「ううん、見なかった。」', 'Did you 〜? には did / didn\'t で答える。'),
 ('過去形', f'The old lamp {B} in the shop window last week.', ['was', 'were', 'is', 'be'], 'その古いランプは先週、店の窓辺にあった。', 'last week があり主語は単数なので was。'),
 ('There is', f'There {B} three cats on the roof of the shop.', ['are', 'is', 'be', 'am'], '店の屋根の上にネコが3匹いる。', 'There is / are は後ろの名詞で決まる。three cats は複数なので are。'),
 ('There is', f'"Is there a map in your bag?" "No, there {B}."', ['isn\'t', 'aren\'t', 'doesn\'t', 'not'], '「かばんの中に地図はある？」「ううん、ないよ。」', 'Is there 〜? には there is / isn\'t で答える。'),
 ('代名詞', f'This is Leo. I often play cards with {B}.', ['him', 'he', 'his', 'he\'s'], 'こちらはレオ。私はよく彼とカードで遊ぶ。', '前置詞 with の後ろは目的格 him。'),
 ('代名詞', f'Mina and I are friends. {B} notebooks are the same color.', ['Our', 'We', 'Us', 'Ours'], 'ミナと私は友だち。私たちの手帖は同じ色だ。', '名詞 notebooks の前なので所有格 Our。'),
 ('代名詞', f'"Is this pen yours?" "Yes, it\'s {B}."', ['mine', 'my', 'me', 'I'], '「このペンはあなたの？」「うん、私のだよ。」', '「私のもの」は所有代名詞 mine。'),
 ('前置詞', f'The shop opens {B} nine in the morning.', ['at', 'on', 'in', 'to'], 'お店は朝9時に開く。', '時刻の前は at。'),
 ('前置詞', f'Ren\'s birthday is {B} May 3.', ['on', 'in', 'at', 'for'], 'レンの誕生日は5月3日だ。', '日付の前は on。'),
 ('前置詞', f'The cat is sleeping {B} the box.', ['in', 'at', 'to', 'from'], 'ネコが箱の中で眠っている。', '「〜の中で」は in。'),
 ('名詞・冠詞', f'I want {B} umbrella. It is raining.', ['an', 'a', 'some', 'two'], '傘が1本ほしい。雨が降っているから。', 'umbrella は母音の音で始まるので an。'),
 ('名詞・冠詞', f'There are many {B} in the old castle.', ['boxes', 'box', 'boxs', 'a box'], '古い城にはたくさんの箱がある。', 'many の後は複数形。x で終わる語は -es を付けて boxes。'),
]

Q['A2'] = [
 ('過去進行形', f'I {B} a book when the bell rang.', ['was reading', 'am reading', 'was read', 'have read'], 'ベルが鳴ったとき、私は本を読んでいた。', 'ベルが鳴った「その時」に続いていた動作なので過去進行形。'),
 ('過去進行形', f'What {B} you doing at eight last night?', ['were', 'did', 'are', 'was'], '昨夜8時に何をしていたの？', 'doing と last night から過去進行形 were you doing。'),
 ('未来', f'Look at those dark clouds. It {B} rain soon.', ['is going to', 'is', 'was', 'goes to'], 'あの黒い雲を見て。もうすぐ雨が降りそうだ。', '目の前の様子から判断する近い未来は be going to。'),
 ('未来', f'"The phone is ringing." "OK, I {B} answer it."', ['will', 'am', 'was', 'did'], '「電話が鳴っているよ。」「わかった、ぼくが出るよ。」', 'その場で決めたことは will。'),
 ('未来', f'If it {B} sunny tomorrow, we will go to the lake.', ['is', 'will be', 'was', 'be'], '明日晴れたら、湖に行こう。', '条件を表す if の中では、未来のことでも現在形を使う。'),
 ('比較', f'This dragon card is {B} than that one.', ['stronger', 'strong', 'strongest', 'more strong'], 'このドラゴンのカードはあのカードより強い。', 'than があるので比較級。strong は -er を付けて stronger。'),
 ('比較', f'This is the {B} map in the shop.', ['oldest', 'older', 'old', 'most old'], 'これは店でいちばん古い地図だ。', 'the と in the shop から最上級 oldest。'),
 ('比較', f'Mina can run as {B} as Ren.', ['fast', 'faster', 'fastest', 'more fast'], 'ミナはレンと同じくらい速く走れる。', 'as 〜 as の間は形容詞・副詞の原級。'),
 ('比較', f'This question is {B} difficult than the last one.', ['more', 'most', 'much', 'very'], 'この問題は前の問題より難しい。', 'difficult のような長い語の比較級は more ＋原級。'),
 ('不定詞', f'I went to the shop {B} a new notebook.', ['to buy', 'buy', 'buying', 'bought'], '新しい手帖を買うために店へ行った。', '「〜するために」は to ＋動詞の原形（目的）。'),
 ('不定詞', f'Ren wants {B} a famous adventurer.', ['to become', 'become', 'becoming', 'became'], 'レンは有名な冒険者になりたいと思っている。', 'want は後ろに to 不定詞をとる。'),
 ('不定詞', f'I have a lot of homework {B} today.', ['to do', 'doing', 'do', 'done'], '今日はやるべき宿題がたくさんある。', '「〜するための・〜すべき」と名詞を後ろから説明する to 不定詞。'),
 ('動名詞', f'Mina enjoys {B} old stories.', ['reading', 'to read', 'read', 'reads'], 'ミナは古い物語を読むのを楽しんでいる。', 'enjoy の後ろは動名詞（-ing）。'),
 ('動名詞', f'Thank you for {B} me the way.', ['showing', 'show', 'to show', 'showed'], '道を教えてくれてありがとう。', '前置詞 for の後ろは動名詞。'),
 ('動名詞', f'Leo finished {B} his report before dinner.', ['writing', 'to write', 'write', 'wrote'], 'レオは夕食の前にレポートを書き終えた。', 'finish の後ろは動名詞。'),
 ('受動態', f'This old book {B} by a famous poet.', ['was written', 'wrote', 'was writing', 'writes'], 'この古い本は有名な詩人によって書かれた。', 'by 〜「〜によって」があり、本は「書かれた」側なので受動態 was written。'),
 ('受動態', f'English {B} in many countries.', ['is spoken', 'speaks', 'is speaking', 'spoke'], '英語は多くの国で話されている。', '英語は「話される」側なので受動態 is spoken。'),
 ('受動態', f'The window {B} by the strong wind last night.', ['was broken', 'broke', 'is broken', 'breaks'], '昨夜、強風で窓が割れた。', 'by the strong wind と last night から過去の受動態 was broken。'),
 ('接続詞', f'I like this card {B} it is very beautiful.', ['because', 'but', 'or', 'if'], 'とてもきれいなので、私はこのカードが好きだ。', '後ろが理由なので because。'),
 ('接続詞', f'Hurry up, {B} you will miss the bus.', ['or', 'and', 'because', 'so'], '急ぎなさい、さもないとバスに乗り遅れますよ。', '命令文＋or で「さもないと」。'),
 ('接続詞', f'I think {B} Kotoha knows the answer.', ['that', 'what', 'which', 'if'], 'コトハは答えを知っていると思う。', 'I think の後ろに「〜ということ」を続ける接続詞 that。'),
 ('接続詞', f'{B} I got home, my sister was cooking.', ['When', 'Because', 'But', 'So'], '私が帰宅したとき、姉は料理をしていた。', '「〜したとき」は When。'),
 ('助動詞', f'You {B} run in the shop. Many glass bottles are on the shelves.', ['must not', 'don\'t have to', 'can', 'will'], '店の中で走ってはいけません。棚にガラスびんがたくさんあります。', '理由が後ろにあり「〜してはいけない」という禁止なので must not。'),
 ('助動詞', f'It is Sunday. You {B} get up early today.', ['don\'t have to', 'must not', 'must', 'have to'], '日曜日だ。今日は早起きしなくていいよ。', '「〜する必要はない」は don\'t have to。'),
 ('助動詞', f'"{B} I open the window?" "Yes, please."', ['Shall', 'Must', 'Have', 'Am'], '「窓を開けましょうか。」「はい、お願いします。」', '「（私が）〜しましょうか」と申し出る Shall I 〜?。'),
 ('文型', f'Kotoha gave {B} an old compass.', ['me', 'I', 'my', 'mine'], 'コトハは私に古い方位磁石をくれた。', 'give ＋人＋物。人の部分は目的格 me。'),
 ('文型', f'The news made everyone {B}.', ['happy', 'happily', 'happiness', 'to happy'], 'その知らせはみんなを幸せな気持ちにした。', 'make ＋O＋C「OをCにする」。C は形容詞 happy。'),
 ('文型', f'This soup smells {B}.', ['good', 'well', 'goodly', 'to good'], 'このスープはいいにおいがする。', 'smell ＋形容詞「〜なにおいがする」。'),
 ('There・there', f'There {B} a big festival in our town last year.', ['was', 'is', 'were', 'has'], '去年、私たちの町で大きなお祭りがあった。', 'last year と単数の a big festival から was。'),
 ('疑問・付加', f'You are from Osaka, {B} you?', ['aren\'t', 'don\'t', 'isn\'t', 'weren\'t'], 'あなたは大阪出身ですよね？', '肯定文 you are の後ろの付加疑問は aren\'t you?。'),
]

Q['B1'] = [
 ('現在完了', f'I {B} this card since I was ten.', ['have had', 'had', 'have', 'am having'], '10歳のときからずっとこのカードを持っている。', 'since 〜「〜以来ずっと」と状態の継続を表すので現在完了 have had。'),
 ('現在完了', f'"Have you ever {B} to Kyoto?" "Yes, twice."', ['been', 'visited', 'went', 'go'], '「京都に行ったことある？」「うん、2回。」', '「行ったことがある」は have been to。'),
 ('現在完了', f'The train {B} left. We have to wait for the next one.', ['has already', 'have already', 'has yet', 'is already'], '電車はもう出てしまった。次の電車を待たなければならない。', '「もう〜してしまった」という完了。has already ＋過去分詞。'),
 ('現在完了', f'I {B} the movie yet.', ['haven\'t seen', 'haven\'t saw', 'don\'t see', 'wasn\'t seen'], 'その映画はまだ見ていない。', '否定文の yet「まだ」は現在完了と使う。'),
 ('現在完了', f'Ren {B} his homework two hours ago.', ['finished', 'has finished', 'has been finishing', 'have finished'], 'レンは2時間前に宿題を終えた。', '〜 ago は過去の一時点なので、現在完了ではなく過去形。'),
 ('現在完了', f'Mina has been {B} the piano for an hour.', ['practicing', 'practiced', 'practice', 'to practice'], 'ミナは1時間ずっとピアノの練習をしている。', '動作の継続は現在完了進行形 has been ＋ -ing。'),
 ('現在完了', f'"How long {B} you lived in this town?" "For five years."', ['have', 'do', 'did', 'are'], '「この町にどのくらい住んでいるの？」「5年だよ。」', '期間を聞く How long と「今まで」の継続は現在完了。'),
 ('関係代名詞', f'I have a friend {B} can speak three languages.', ['who', 'which', 'whose', 'where'], '私には3か国語を話せる友だちがいる。', '先行詞が人（a friend）で、後ろに主語がないので主格の who。'),
 ('関係代名詞', f'This is the key {B} opens the secret door.', ['which', 'who', 'whose', 'what'], 'これが秘密の扉を開ける鍵だ。', '先行詞が物（the key）で、後ろに主語がないので主格の which。'),
 ('関係代名詞', f'The card {B} I bought yesterday was a fake.', ['that', 'what', 'who', 'whose'], '昨日私が買ったカードは偽物だった。', '先行詞が物で、bought の目的語にあたる目的格の関係代名詞 that。'),
 ('関係代名詞', f'I met a girl {B} brother is a famous magician.', ['whose', 'who', 'which', 'that'], '私は兄が有名な魔術師である女の子に会った。', '「その子の兄」なので所有格の whose。'),
 ('分詞', f'Who is the boy {B} under the tree?', ['sleeping', 'slept', 'sleeps', 'to sleeping'], '木の下で眠っている男の子は誰？', '「〜している」と名詞を後ろから説明する現在分詞 sleeping。'),
 ('分詞', f'Kotoha showed me a letter {B} in old English.', ['written', 'writing', 'wrote', 'writes'], 'コトハは古い英語で書かれた手紙を見せてくれた。', '手紙は「書かれた」側なので過去分詞 written。'),
 ('分詞', f'The story was so {B} that I read it twice.', ['exciting', 'excited', 'excite', 'excitement'], 'その物語はとてもわくわくするものだったので、2回読んだ。', '物語は人を「わくわくさせる」側なので exciting。'),
 ('間接疑問', f'Do you know where {B}?', ['Leo lives', 'does Leo live', 'lives Leo', 'Leo does live'], 'レオがどこに住んでいるか知ってる？', '文の中に入った疑問文は〈疑問詞＋主語＋動詞〉の語順。'),
 ('間接疑問', f'I don\'t know {B} Kotoha came back from her trip.', ['when', 'who', 'what', 'which'], 'コトハがいつ旅から帰ってきたのか知らない。', '「いつ〜か」を表す間接疑問の when。後ろは主語も目的語もそろった完全な文なので who・what・which は入らない。'),
 ('不定詞', f'Kotoha told me {B} the box until midnight.', ['not to open', 'to not opening', 'don\'t open', 'not opening'], 'コトハは真夜中まで箱を開けないようにと私に言った。', 'tell ＋人＋to 〜の否定は not to 〜。'),
 ('不定詞', f'I don\'t know {B} use this machine.', ['how to', 'what to', 'how', 'to how'], 'この機械の使い方がわからない。', '「〜のしかた」は how to ＋動詞の原形。'),
 ('不定詞', f'This box is too heavy {B} carry.', ['for me to', 'for me', 'to me', 'me to'], 'この箱は重すぎて私には運べない。', 'too 〜 for 人 to …「重すぎて人には…できない」。'),
 ('不定詞', f'It is important {B} every day.', ['to practice', 'practice', 'practiced', 'practices'], '毎日練習することが大切だ。', 'It is 〜 to …「…することは〜だ」。'),
 ('使役・知覚', f'My mother made me {B} my room.', ['clean', 'to clean', 'cleaning', 'cleaned'], '母は私に部屋を掃除させた。', 'make ＋人＋動詞の原形「人に〜させる」。'),
 ('使役・知覚', f'I heard someone {B} my name in the dark.', ['call', 'to call', 'to calling', 'calls'], '暗やみの中で誰かが私の名前を呼ぶのが聞こえた。', 'hear ＋人＋動詞の原形「人が〜するのが聞こえる」。'),
 ('仮定法過去', f'If I {B} a bird, I could fly over the mountain.', ['were', 'am', 'will be', 'have been'], 'もし私が鳥なら、あの山を飛び越えられるのに。', '今の事実とちがうことを想像するときは仮定法過去。be動詞はふつう were。'),
 ('仮定法過去', f'If I had more time, I {B} read all these books.', ['would', 'will', 'can', 'am'], 'もっと時間があれば、ここの本を全部読むのに。', '仮定法過去の主節は would ＋動詞の原形。'),
 ('仮定法過去', f'I wish I {B} play the guitar like you.', ['could', 'can', 'will', 'am'], 'あなたのようにギターが弾けたらいいのに。', 'I wish の後ろは仮定法なので can ではなく could。'),
 ('助動詞', f'Leo looks very tired. He {B} have studied all night.', ['must', 'can\'t', 'should', 'need'], 'レオはとても疲れて見える。一晩中勉強したにちがいない。', '「〜したにちがいない」は must have ＋過去分詞。'),
 ('助動詞', f'You {B} have told me earlier. Now it\'s too late.', ['should', 'need', 'can', 'had'], 'もっと早く言ってくれればよかったのに。もう手遅れだ。', '「〜すべきだったのに（しなかった）」は should have ＋過去分詞。'),
 ('受動態', f'The festival {B} canceled because of the rain.', ['has been', 'has', 'have been', 'is being to'], 'お祭りは雨のために中止になってしまった。', '現在完了の受動態は has been ＋過去分詞。'),
 ('受動態', f'Many stars can {B} from this hill at night.', ['be seen', 'see', 'seen', 'be seeing'], '夜にはこの丘から多くの星が見える。', '助動詞の受動態は助動詞＋be＋過去分詞。'),
 ('比較', f'This is the most beautiful card I have {B} seen.', ['ever', 'never', 'yet', 'already'], 'これは今までに見た中でいちばん美しいカードだ。', '最上級＋I have ever 〜「今までに〜した中で」。'),
]

Q['B2'] = [
 ('過去完了', f'When we got to the station, the last train {B}.', ['had already left', 'has already left', 'had already leave', 'already leaves'], '駅に着いたとき、最終電車はもう出てしまっていた。', '過去のある時点（着いたとき）までに完了していたことは過去完了。'),
 ('過去完了', f'I lost the pen that my grandfather {B} me.', ['had given', 'has given', 'gives', 'was giving'], '祖父がくれたペンをなくしてしまった。', 'なくした時点より前にもらっているので、より前の出来事を過去完了で表す。'),
 ('過去完了', f'She {B} the castle before, so she knew the way.', ['had visited', 'has visited', 'visits', 'would visit'], '彼女は以前その城を訪れたことがあったので、道を知っていた。', '過去の時点までの経験は過去完了 had visited。'),
 ('仮定法過去完了', f'If I had left home earlier, I {B} the bus.', ['would have caught', 'would catch', 'will catch', 'had caught'], 'もっと早く家を出ていたら、バスに間に合ったのに。', '過去の事実に反する仮定は、主節が would have ＋過去分詞。'),
 ('仮定法過去完了', f'If Ren {B} the map, he would not have gotten lost.', ['had brought', 'brought', 'has brought', 'would bring'], 'もしレンが地図を持ってきていたら、道に迷わなかっただろうに。', '主節が would have 〜なので、if 節は過去完了 had ＋過去分詞。'),
 ('仮定法過去完了', f'If you had taken the medicine, you {B} better now.', ['would feel', 'would have felt', 'will feel', 'felt'], 'あのとき薬を飲んでいたら、今ごろは気分がよくなっているだろうに。', 'if 節は過去のこと、主節は now があり今のことなので would ＋原形。'),
 ('仮定法', f'I wish I {B} harder when I was young.', ['had studied', 'studied', 'have studied', 'would study'], '若いころにもっと勉強していればよかったなあ。', 'when I was young と過去のことなので I wish ＋過去完了。'),
 ('仮定法', f'He talks as if he {B} everything about dragons.', ['knew', 'know', 'had been knowing', 'will know'], '彼はまるでドラゴンのことなら何でも知っているかのように話す。', '今の事実と違う「まるで〜かのように」は as if ＋過去形。'),
 ('仮定法', f'{B} your help, I could not have finished the work.', ['Without', 'With', 'Unless', 'Except'], 'あなたの助けがなかったら、その仕事を終えられなかっただろう。', '「〜がなかったら」は Without ＋名詞。'),
 ('分詞構文', f'{B} the letter, Mina began to cry.', ['Reading', 'Read', 'To reading', 'Being read'], '手紙を読みながら、ミナは泣き出した。', 'ミナが「読む」側なので現在分詞の分詞構文 Reading。'),
 ('分詞構文', f'{B} from the hill, the town looks like a toy.', ['Seen', 'Seeing', 'See', 'Saw'], '丘から見ると、町はおもちゃのように見える。', '町は「見られる」側なので過去分詞の分詞構文 Seen。'),
 ('分詞構文', f'{B} the book, I returned it to the library.', ['Having finished', 'Finishing having', 'Finished', 'Have finished'], 'その本を読み終えたので、図書館に返した。', '返すより前に読み終えているので、完了形の分詞構文 Having ＋過去分詞。'),
 ('関係副詞', f'This is the village {B} the legend began.', ['where', 'which', 'when', 'what'], 'ここがその伝説が始まった村だ。', '後ろが完全な文で、場所を表す先行詞 the village なので関係副詞 where。'),
 ('関係副詞', f'I still remember the day {B} I met Kotoha.', ['when', 'where', 'which', 'what'], 'コトハに出会った日のことを今でも覚えている。', '時を表す先行詞 the day で、後ろは完全な文なので when。'),
 ('関係副詞', f'This is the town {B} we visited last summer.', ['which', 'where', 'when', 'what'], 'これが去年の夏に私たちが訪れた町だ。', 'visit は目的語が必要な動詞。後ろに目的語が欠けているので関係代名詞 which。'),
 ('関係詞', f'{B} you need now is a good rest.', ['What', 'That', 'Which', 'It'], '今あなたに必要なのは十分な休息だ。', '「〜すること・もの」と先行詞を含む関係代名詞 what。'),
 ('関係詞', f'I have two cousins, {B} live in Canada.', ['who', 'that', 'whom', 'which'], '私にはいとこが2人いて、2人ともカナダに住んでいる。', 'コンマの後ろで人を補足説明する非限定用法は who。that は非限定用法に使えない。'),
 ('関係詞', f'Ren said he had won the lottery, {B} was not true.', ['which', 'what', 'who', 'that'], 'レンは宝くじに当たったと言ったが、それは本当ではなかった。', '前の節の内容を受ける非限定用法の which。'),
 ('強調構文', f'It was in this shop {B} I found the magic card.', ['that', 'which', 'when', 'what'], '私が魔法のカードを見つけたのは、この店でだった。', 'It was 〜 that … の強調構文。in this shop を強調している。'),
 ('倒置', f'Never {B} such a beautiful sunset.', ['have I seen', 'I have seen', 'I saw', 'seen I have'], 'こんなに美しい夕日は一度も見たことがない。', '否定語 Never が文頭に出ると、後ろは疑問文の語順になる。'),
 ('倒置', f'"I can\'t swim." "{B} I."', ['Neither can', 'So can', 'Either can', 'Neither I can'], '「ぼくは泳げないんだ。」「ぼくもだよ。」', '否定文を受けて「〜もそうだ」は Neither ＋助動詞＋主語。'),
 ('話法', f'Leo asked me {B}.', ['where I was going', 'where was I going', 'where am I going', 'where I am go'], 'レオは私にどこへ行くのかとたずねた。', '間接話法の疑問文は〈疑問詞＋主語＋動詞〉。asked に合わせて時制は過去。'),
 ('話法', f'Kotoha told us {B} quiet.', ['to be', 'be', 'being', 'that be'], 'コトハは私たちに静かにするように言った。', '命令文の間接話法は tell ＋人＋to 〜。'),
 ('否定', f'Rich people are not {B} happy.', ['always', 'never', 'every', 'hardly'], 'お金持ちがいつも幸せだとは限らない。', 'not always「いつも〜とは限らない」（部分否定）。'),
 ('否定', f'There was {B} water left in the bottle, so I was very thirsty.', ['little', 'few', 'a little', 'many'], 'びんには水がほとんど残っていなかったので、とてものどがかわいていた。', '数えられない water に「ほとんどない」は little（a little は「少しある」）。'),
 ('比較', f'The more you practice, the {B} you will become.', ['better', 'good', 'best', 'well'], '練習すればするほど、上手になる。', 'the ＋比較級, the ＋比較級「〜すればするほど…」。'),
 ('比較', f'This bridge is three times {B} that one.', ['as long as', 'as longer as', 'longer as', 'long as'], 'この橋はあの橋の3倍の長さだ。', '倍数は〜 times as 原級 as。'),
 ('比較', f'No other card in the shop is {B} this one.', ['as valuable as', 'valuable than', 'most valuable', 'the more valuable'], 'この店で、このカードほど価値のあるカードはほかにない。', 'No other 〜 is as 原級 as …「…ほど〜なものはない」（最上級の意味）。'),
 ('動名詞', f'I\'m looking forward to {B} you again.', ['seeing', 'see', 'seen', 'be seeing'], 'またお会いできるのを楽しみにしています。', 'look forward to の to は前置詞なので、後ろは動名詞。'),
 ('接続詞', f'Take an umbrella {B} it rains.', ['in case', 'unless', 'so that', 'as if'], '雨が降るといけないから、傘を持っていきなさい。', '「〜するといけないから」は in case。'),
]

Q['PT'] = [
 ('倒置', f'No sooner {B} the door than the lights went out.', ['had I opened', 'I had opened', 'did I opened', 'I opened'], 'ドアを開けたとたん、明かりが消えた。', 'No sooner が文頭に出ると倒置。had ＋主語＋過去分詞 〜 than …。'),
 ('倒置', f'Hardly had she sat down {B} the phone rang.', ['when', 'than', 'that', 'then'], '彼女が座るとすぐに電話が鳴った。', 'Hardly 〜 when …「〜するとすぐに…」。No sooner と組むのは than。'),
 ('倒置', f'Not until he lost his notebook {B} how important it was.', ['did he realize', 'he realized', 'he did realize', 'realized he'], '手帖をなくして初めて、彼はそれがどれほど大切だったかに気づいた。', 'Not until 〜 が文頭に出ると、主節は疑問文の語順になる。'),
 ('倒置', f'Only after the storm passed {B} leave the cave.', ['could we', 'we could', 'we can', 'can we be'], '嵐が過ぎ去ってようやく、私たちは洞窟を出ることができた。', 'Only ＋副詞句・節が文頭に来ると、後ろは倒置。過去の話なので could we。'),
 ('倒置', f'{B} I known the truth, I would have helped him.', ['Had', 'If', 'Have', 'Did'], '真実を知っていたら、彼を助けていたのに。', 'If I had known の if を省略すると Had I known と倒置する。'),
 ('倒置', f'{B} you need any help, please call me at once.', ['Should', 'Would', 'Unless', 'Had'], '万一助けが必要になったら、すぐに私に電話してください。', 'If you should need の if を省略した倒置 Should you need。'),
 ('仮定法現在', f'The doctor suggested that he {B} more vegetables.', ['eat', 'to eat', 'eating', 'will eat'], '医者は彼にもっと野菜を食べるよう提案した。', 'suggest など提案・要求の動詞に続く that 節では、動詞の原形（または should ＋原形）。'),
 ('仮定法現在', f'It is essential that every member {B} the rules.', ['follow', 'to follow', 'followed', 'following'], 'すべてのメンバーが規則に従うことが不可欠だ。', 'essential など必要性を表す形容詞に続く that 節も動詞の原形。'),
 ('仮定法', f'It\'s high time you {B} to bed.', ['went', 'go', 'will go', 'are going'], 'もうとっくに寝る時間だよ。', 'It\'s (high) time ＋主語＋過去形「もう〜してよいころだ」。'),
 ('仮定法', f'If it {B} for the map, we would have been lost forever.', ['had not been', 'were not', 'was not', 'has not been'], 'もしあの地図がなかったら、私たちは永遠に迷っていただろう。', '主節が would have been なので過去のこと。If it had not been for 〜。'),
 ('仮定法', f'I\'d rather you {B} anyone about this secret.', ['didn\'t tell', 'not to tell', 'to not tell', 'won\'t tell'], 'この秘密は誰にも話さないでほしいのですが。', 'would rather ＋主語＋過去形「〜してほしい」。'),
 ('複合関係詞', f'{B} hard it may be, I will never give up.', ['However', 'Whatever', 'Whenever', 'No matter'], 'どんなにつらくても、決してあきらめない。', '〈However ＋形容詞＋主語＋動詞〉「どんなに〜でも」。No matter なら how が必要。'),
 ('複合関係詞', f'You can choose {B} card you like from this box.', ['whichever', 'however', 'whoever', 'wherever'], 'この箱から好きなカードをどれでも選んでいい。', '名詞 card の前に置いて「どれでも」を表す whichever。'),
 ('複合関係詞', f'{B} happens, keep this notebook safe.', ['Whatever', 'However', 'Whichever', 'Whoever'], '何が起ころうとも、この手帖を大切に守りなさい。', '主語になる「何が〜しようとも」は Whatever。'),
 ('関係詞', f'He is the boy {B} I thought would win the contest.', ['who', 'whom', 'which', 'whose'], '彼は、コンテストで優勝するだろうと私が思っていた少年だ。', 'I thought を外すと who would win。主語の役割なので who（連鎖関係代名詞）。'),
 ('関係詞', f'She gave away {B} little money she had.', ['what', 'how', 'which', 'all'], '彼女はなけなしのお金をすべて人にあげた。', 'what little ＋名詞「少ないながらもすべての〜」（関係形容詞）。'),
 ('関係詞', f'I have three old maps, none of {B} shows this island.', ['which', 'them', 'that', 'what'], '古い地図を3枚持っているが、どれもこの島は載っていない。', 'コンマで2つの節をつなぐので、代名詞 them ではなく関係代名詞 which（of which）。'),
 ('分詞構文', f'{B}, we will start for the summit tomorrow.', ['Weather permitting', 'The weather permits', 'Permitting weather', 'Weather permitted'], '天気がよければ、明日頂上をめざして出発する。', '文の主語（we）と異なる主語をもつ独立分詞構文。決まった言い方 Weather permitting「天気が許せば」。'),
 ('分詞構文', f'He listened to the old song with his eyes {B}.', ['closed', 'closing', 'close', 'to close'], '彼は目を閉じて、その古い歌に聴き入った。', 'with ＋名詞＋分詞。目は「閉じられた」状態なので closed。'),
 ('分詞構文', f'{B} in plain English, the book is easy to read.', ['Written', 'Writing', 'Having written', 'To write'], 'やさしい英語で書かれているので、その本は読みやすい。', '本は「書かれた」側なので過去分詞で始める分詞構文。'),
 ('準動詞', f'I am proud of my father {B} a doctor.', ['being', 'to be', 'be', 'been'], '私は父が医者であることを誇りに思っている。', '前置詞 of の後ろの動名詞 being。my father は動名詞の意味上の主語。'),
 ('準動詞', f'He seems {B} ill last week.', ['to have been', 'to be', 'being', 'that he was'], '彼は先週、病気だったようだ。', '「seems（今）」より前の「先週」のことは完了不定詞 to have ＋過去分詞。'),
 ('準動詞', f'This room needs {B}.', ['cleaning', 'to clean', 'be cleaned', 'clean'], 'この部屋は掃除する必要がある。', 'need -ing は「〜される必要がある」という受け身の意味（＝ needs to be cleaned）。'),
 ('準動詞', f'I remember {B} this song when I was a child.', ['hearing', 'to hear', 'hear', 'heard'], '子どものころにこの歌を聞いたことを覚えている。', 'remember -ing は「（過去に）〜したことを覚えている」。to 不定詞なら「忘れずに〜する」。'),
 ('否定', f'Kotoha is the last person {B} a lie.', ['to tell', 'telling', 'told', 'tells'], 'コトハは決してうそをつくような人ではない。', 'the last person to 〜「最も〜しそうにない人＝決して〜しない人」。'),
 ('否定', f'Her answer was {B} but correct. It was full of mistakes.', ['anything', 'nothing', 'something', 'everything'], '彼女の答えは決して正しくなかった。まちがいだらけだった。', 'anything but 〜「決して〜ではない」。nothing but は「〜にすぎない」。'),
 ('否定', f'I never pass this shop {B} looking in the window.', ['without', 'with', 'unless', 'except'], 'この店の前を通ると、私は必ず窓をのぞく。', 'never 〜 without -ing「〜すれば必ず…する」（二重否定）。'),
 ('助動詞', f'You may {B} well stay here tonight. The road is closed.', ['as', 'so', 'very', 'such'], '今夜はここに泊まったほうがいいよ。道が通行止めだから。', 'may as well 〜「〜したほうがいい」。'),
 ('助動詞', f'I cannot {B} laughing at his funny story.', ['help', 'stop to', 'avoid to', 'but'], '彼のおもしろい話に笑わずにはいられない。', 'cannot help -ing「〜せずにはいられない」。cannot but の後ろは原形。'),
 ('構文', f'{B} it not been for your advice, I would have failed.', ['Had', 'Were', 'If', 'Should'], 'あなたの助言がなかったら、失敗していただろう。', 'If it had not been for 〜 の if を省略した倒置 Had it not been for 〜。'),
]

NB_IDX = {'A1': 'a1', 'A2': 'a2', 'B1': 'b1', 'B2': 'b2', 'PT': 'pt'}

def main():
    out, errs = [], []
    for nb, items in Q.items():
        if len(items) != 30: errs.append(f'{nb}: {len(items)} items')
        seen = set()
        for i, (tag, q, ch, ja, ex) in enumerate(items, 1):
            gid = f'g-{NB_IDX[nb]}-{i:02d}'
            if q.count(B) != 1: errs.append(f'{gid}: blank count')
            if len(ch) != 4 or len(set(c.lower() for c in ch)) != 4: errs.append(f'{gid}: choices')
            if q in seen: errs.append(f'{gid}: duplicate')
            seen.add(q)
            out.append({'id': gid, 'nb': nb, 'tag': tag, 'q': q, 'c': ch, 'ja': ja, 'ex': ex})
    if errs:
        print('\n'.join(errs)); sys.exit(1)
    path = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'grammar.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'ver': 1, 'note': '学習指導要領・CEFR-Jを目安に独自作成。c[0]が正解（表示時にシャッフル）。', 'items': out}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'ok: {len(out)} items -> data/grammar.json')

if __name__ == '__main__':
    main()
