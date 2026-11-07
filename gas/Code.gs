/**
 * ハイレベル英単語図鑑（鉄・銅・銀・金・白金の手帖） — バックエンド
 * Google Apps Script（スプレッドシートにバインド）
 *
 * 機能
 *   - 生徒の自己登録（ログインID + ニックネーム + パスワード）とログイン。氏名・クラスは集めない
 *   - セキュリティ：パスワードはソルト付きで繰り返しハッシュ化、失敗が続くと段階的にロック、
 *     送信回数の制限、スプレッドシートへの数式の埋め込み防止、管理者キーはサーバーで照合、不正な記録の検出
 *   - 先生用：毎週の自動バックアップ、生徒のデータ削除、クラス別集計、ランキングに載せない設定
 *   - 進捗データの保存・復元（端末をまたいで続きから遊べる）
 *   - 学習ログの受信（まとめ送信）と日別集計
 *   - 「取り組み状況」シート：先生が生徒ごとの状況を一覧できる
 *   - 殿堂入りランキング（ニックネーム表示）
 *
 * 初回のみ：関数 setup を実行（またはメニュー「英単語図鑑 > 初期セットアップ」）を実行してからデプロイする。
 * 手順の詳細は gas/README.md を参照。
 */

/* ================= 設定 ================= */
const TOTAL_CARDS     = 8324;  // 全手帖の総カード数（収集率の計算用）
// 手帖ごとのカード数と、カードIDの接頭辞（a1-12 / card-5 など）
const NOTEBOOKS = [
  { key: 'A1', name: '鉄',   prefix: 'a1-',   count: 1067 },
  { key: 'A2', name: '銅',   prefix: 'a2-',   count: 1352 },
  { key: 'B1', name: '銀',   prefix: 'b1-',   count: 2353 },
  { key: 'B2', name: '金',   prefix: 'b2-',   count: 2689 },
  { key: 'PT', name: '白金', prefix: 'card-', count: 863 },
];
const TOKEN_DAYS      = 180;   // ログイン状態の有効日数
const MAX_FAIL        = 5;     // パスワードをこの回数続けて間違えるとロック
const LOCK_STEPS      = [10, 60, 1440];  // ロック時間（分）。ロックされるたびに長くなる（10分→1時間→24時間）
const PASSWORD_RE     = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7e]{8,32}$/;   // 英字と数字を含む8〜32文字（空白なし）
const HASH_ROUNDS     = 300;   // パスワードのハッシュの繰り返し回数（総当たりを遅くする）
const DAILY_NEW_LIMIT = 100;   // アプリ側の「1日の新しいカード」上限（不正の検出に使う）
// 送信回数の制限：[最大回数, 秒]（Googleの実行回数の上限やシートの容量を守るため）
const RATE = {
  register:   [20, 600],     // 新規登録：全体で10分に20件
  loginId:    [10, 60],      // ログイン：1つのIDにつき1分に10回
  loginAll:   [200, 60],     // ログイン：全体で1分に200回
  logGuest:   [400, 600],    // ゲストのログ：1人10分に400件
  logGuestAll:[5000, 600],   // ゲストのログ：全体で10分に5000件
  logMember:  [1000, 600],   // 会員のログ：1人10分に1000件
  save:       [20, 60],      // 進捗の保存：1人1分に20回
  admin:      [5, 600],      // 管理者キー：1人10分に5回
  contactOne: [3, 600],      // 問い合わせ：1台10分に3件
  contactAll: [30, 3600],    // 問い合わせ：全体で1時間に30件
  raid:       [10, 600],     // レイドの送信：1人10分に10回
};
/* レイドボス（みんなで倒す週替わりの巨大ボス）
   ・1回の挑戦で与えたダメージは「自分のレベルに合わせたボスのHPの何％を削ったか」を点数にして合算（1回最大 RAID_MAX_HIT 点）
   ・1人1日 RAID_DAILY 回まで。ボスのHPはスクリプトプロパティ RAID_HP で変えられる（既定 RAID_HP_DEFAULT） */
const RAID_DAILY       = 3;
const RAID_MAX_HIT     = 1500;
const RAID_HP_DEFAULT  = 30000;
const RAID_REWARD      = 2000;   // 撃破後に参加者が受け取れるゴールド
const RAID_BOSSES      = [['A1', '巨大アイアンスライム'], ['A2', '巨大カッパースライム'], ['B1', '巨大シルバースライム'], ['B2', '巨大ゴールドスライム'], ['PT', '巨大プラチナスライム']];
const CHUNK_SIZE      = 45000; // 1セルに入れる文字数（上限50,000）
const MAX_CHUNKS      = 20;    // 進捗データの最大分割数（約90万文字まで）
const MASTERED_LEVEL  = 4;     // SRSでこのレベル以上を「習得語」と数える（4=Week2）
const RANKING_LIMIT   = 50;

const SHEET = {
  USERS:    'ユーザー',
  SESSIONS: 'セッション',
  PROGRESS: '進捗データ',
  LOG:      '学習ログ',
  DAILY:    '日別集計',
  STATUS:   '取り組み状況',
  HOF:      '殿堂入り',
  CLASS:    'クラス別集計',
  CONTACT:  '問い合わせ',
  RAID:     'レイド',
};
const LOG_KEEP_DAYS = 90;   // 学習ログのシートに残す日数。これより古い行は別ファイル「英単語図鑑_学習ログ保管」へ移す（効果検証レポートは保管分も読む）
const BACKUP_KEEP = 4;   // バックアップを何回分残すか（毎週なら約1か月）

const HEADERS = {
  USERS:    ['ログインID', 'ニックネーム', 'メモ（先生用）', 'クラス（先生用）', 'パスワードハッシュ', 'ソルト', '登録日時', '最終ログイン', '失敗回数', 'ロック解除時刻',
             '管理者（○で有効）', 'ランキングに載せない'],
  SESSIONS: ['トークンハッシュ', 'ログインID', '有効期限', '発行日時'],
  PROGRESS: ['ログインID', '更新日時', 'リビジョン', '分割数'].concat(
              Array.from({ length: MAX_CHUNKS }, (_, i) => 'データ' + (i + 1))),
  LOG:      ['タイムスタンプ', 'ユーザー', '区分', 'セッションID', 'イベント', 'カードNo', '英単語', '意味',
             'レベル', '正誤', '回答時間(秒)', '取得カード数', '連続正解', '手帖', '苦手度'],
  DAILY:    ['日付', 'ログインID', '回答数', '正解数', 'キー'],
  STATUS:   ['ログインID', 'ニックネーム', 'メモ（先生用）', 'クラス（先生用）', '登録日', '最終利用', '未利用日数', '利用日数',
             '直近7日の回答数', '累計回答数', '正解数', '正答率', '獲得カード', '収集率', 'レベル', '累計XP',
             '連続ログイン', '撃破ボス数', '習得語数', '殿堂入り', '殿堂入り日', '進捗更新',
             '開いている手帖', '鉄（枚）', '銅（枚）', '銀（枚）', '金（枚）', '白金（枚）', '要確認'],
  HOF:      ['達成日時', 'ログインID', 'ニックネーム', '区分'],
  CONTACT:  ['受付日時', '種類', '内容', '返信先', 'ログインID', '端末ID', '対応状況'],
  RAID:     ['キー', '週（月曜日）', 'ログインID', 'ニックネーム', '与えたダメージ', '今日の挑戦回数', '最終挑戦日', '累計挑戦回数', '報酬受取'],
  CLASS:    ['クラス', '人数', '直近7日に利用した人数', '利用率', '直近7日の回答数', '1人あたり累計回答数', '正答率', '1人あたりカード', '1人あたり習得語数'],
};

// 取り組み状況シートの列番号（1始まり）
const ST = {
  ID: 1, NICK: 2, NAME: 3, CLASS: 4, CREATED: 5, LAST: 6, IDLE: 7, DAYS: 8, WEEK: 9,
  TOTAL: 10, CORRECT: 11, RATE: 12, CARDS: 13, CARD_RATE: 14, LEVEL: 15, XP: 16,
  STREAK: 17, BOSSES: 18, MASTERED: 19, HOF: 20, HOF_DATE: 21, PROG_UPDATED: 22,
  NB_CUR: 23, NB_FIRST: 24,   // 24〜28 = 鉄・銅・銀・金・白金の所持枚数
  FLAG: 29,                   // 要確認（不正の疑い・管理者キーの使用）
};

// 回答として数えるイベント
const ANSWER_EVENTS = ['training', 'gacha', 'challenge', 'battle', 'grammar'];

/* ================= エントリーポイント ================= */
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    switch (req.action) {
      case 'register':     return json_(register_(req));
      case 'login':        return json_(login_(req));
      case 'logout':       return json_(logout_(req));
      case 'me':           return json_(me_(req));
      case 'loadProgress': return json_(loadProgress_(req));
      case 'saveProgress': return json_(saveProgress_(req));
      case 'log':          return json_(log_(req));
      case 'adminUnlock':  return json_(adminUnlock_(req));
      case 'setPrefs':     return json_(setPrefs_(req));
      case 'contact':      return json_(contact_(req));
      case 'raidStatus':   return json_(raidStatus_(req));
      case 'raidHit':      return json_(raidHit_(req));
      case 'raidClaim':    return json_(raidClaim_(req));
      default:             return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  try {
    if (action === 'hofRanking') return json_(hofRanking_());
    return json_({ ok: true, service: 'kin-no-techo', time: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

/* ================= 認証 ================= */
function register_(req) {
  const loginId  = normId_(req.loginId);
  const nickname = cleanText_(req.nickname, 12);
  const password = String(req.password || '');

  if (!/^[a-z0-9_]{3,16}$/.test(loginId)) return { ok: false, error: 'invalid_id' };
  if (!nickname)                          return { ok: false, error: 'invalid_nickname' };
  if (!PASSWORD_RE.test(password))        return { ok: false, error: 'invalid_password' };
  if (!rateOk_('reg', RATE.register))     return { ok: false, error: 'rate_limited' };

  return withLock_(() => {
    const users = sheet_(SHEET.USERS);
    if (findRow_(users, 1, loginId))   return { ok: false, error: 'id_taken' };
    if (findRow_(users, 2, nickname))  return { ok: false, error: 'nickname_taken' };

    const salt = Utilities.getUuid();
    const now  = new Date();
    appendRow_(users, [loginId, nickname, '', '', passHash_(salt, password), salt, now, now, 0, '', '', ''], [1, 2, 3, 4, 5, 6]);

    upsertStatus_(loginId, { nickname: nickname, created: now });

    const token = issueToken_(loginId);
    return { ok: true, token: token, loginId: loginId, nickname: nickname };
  });
}

function login_(req) {
  const loginId  = normId_(req.loginId);
  const password = String(req.password || req.pin || '');
  if (!loginId || !password) return { ok: false, error: 'bad_credentials' };
  if (!rateOk_('login:' + loginId, RATE.loginId) || !rateOk_('login', RATE.loginAll)) return { ok: false, error: 'rate_limited' };

  return withLock_(() => {
    const users = sheet_(SHEET.USERS);
    const row = findRow_(users, 1, loginId);
    if (!row) return { ok: false, error: 'bad_credentials' };

    const v = users.getRange(row, 1, 1, HEADERS.USERS.length).getValues()[0];
    const now = new Date();
    const lockUntil = v[9] instanceof Date ? v[9] : null;
    if (lockUntil && lockUntil > now) {
      return { ok: false, error: 'locked', minutes: Math.ceil((lockUntil - now) / 60000) };
    }

    if (!passOk_(String(v[5]), password, String(v[4]))) {
      // 失敗回数は成功するまで数え続け、5回ごとにロック。ロックのたびに長くなる
      const fails = (Number(v[8]) || 0) + 1;
      if (fails % MAX_FAIL === 0) {
        const minutes = LOCK_STEPS[Math.min(fails / MAX_FAIL, LOCK_STEPS.length) - 1];
        users.getRange(row, 9, 1, 2).setValues([[fails, new Date(now.getTime() + minutes * 60000)]]);
        return { ok: false, error: 'locked', minutes: minutes };
      }
      users.getRange(row, 9, 1, 2).setValues([[fails, '']]);
      return { ok: false, error: 'bad_credentials', remaining: MAX_FAIL - (fails % MAX_FAIL) };
    }

    // 古い形式（旧PIN・1回だけのハッシュ）なら、この機会に新しい形式で保存し直す
    if (String(v[4]).indexOf('v2$') !== 0) {
      const salt = Utilities.getUuid();
      users.getRange(row, 5, 1, 2).setValues([[passHash_(salt, password), salt]]);
    }
    users.getRange(row, 8, 1, 3).setValues([[now, 0, '']]);
    const token = issueToken_(loginId);
    return { ok: true, token: token, loginId: loginId, nickname: v[1], hideRanking: String(v[11] || '').trim() !== '' };
  });
}

function logout_(req) {
  if (!req.token) return { ok: true };
  return withLock_(() => {
    const s = sheet_(SHEET.SESSIONS);
    const row = findRow_(s, 1, hash_(req.token));
    if (row) s.deleteRow(row);
    return { ok: true };
  });
}

function me_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };
  const users = sheet_(SHEET.USERS);
  const row = findRow_(users, 1, loginId);
  return { ok: true, loginId: loginId, nickname: row ? users.getRange(row, 2).getValue() : '',
           hideRanking: row ? String(users.getRange(row, 12).getValue() || '').trim() !== '' : false };
}

/** 問い合わせフォーム → 「問い合わせ」シート（通知先が設定されていればメールでも知らせる） */
const CONTACT_TYPES = ['使い方の質問', '不具合の報告', '記録の削除の依頼', 'パスワードを忘れた', 'その他'];
function contact_(req) {
  if (String(req.website || '') !== '') return { ok: true };   // 自動投稿よけ（人には見えない欄が埋まっていたら捨てる）
  const type = CONTACT_TYPES.indexOf(req.type) >= 0 ? req.type : 'その他';
  const message = cleanText_(String(req.message || '').replace(/\r?\n/g, ' ／ '), 2000);
  const email = String(req.email || '').trim().slice(0, 100);
  const loginId = normId_(req.loginId).slice(0, 16);
  const client = cleanText_(req.clientId, 40);
  if (message.length < 5) return { ok: false, error: 'contact_short' };
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return { ok: false, error: 'contact_email' };
  if (!rateOk_('contact:' + (client || 'x'), RATE.contactOne) || !rateOk_('contact', RATE.contactAll)) return { ok: false, error: 'rate_limited' };
  withLock_(() => {
    appendRow_(sheet_(SHEET.CONTACT), [new Date(), type, message, cleanText_(email, 100), loginId, client, '未対応'], [2, 3, 4, 5, 6]);
  });
  const to = PropertiesService.getScriptProperties().getProperty('CONTACT_NOTIFY');
  if (to) {
    try { MailApp.sendEmail(to, '【ひみつ手帖】問い合わせ：' + type, type + '\n\n' + message + '\n\n返信先：' + (email || 'なし') + '\nログインID：' + (loginId || 'なし')); }
    catch (e) { console.error('通知メールを送れませんでした', e); }
  }
  return { ok: true };
}

/** 問い合わせが来たときの通知先メールアドレス（メニューから。空にすると通知しない） */
function setContactNotify() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('問い合わせの通知先', '問い合わせが届いたときに知らせるメールアドレスを入力してください（空欄で通知しない）。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const v = res.getResponseText().trim();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { ui.alert('メールアドレスの形が正しくありません。'); return; }
  const props = PropertiesService.getScriptProperties();
  v ? props.setProperty('CONTACT_NOTIFY', v) : props.deleteProperty('CONTACT_NOTIFY');
  ui.alert(v ? v + ' に通知します。' : '通知しないようにしました。');
}

/** 生徒の設定（いまは「ランキングに載せない」だけ） */
function setPrefs_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };
  return withLock_(() => {
    const users = sheet_(SHEET.USERS);
    const row = findRow_(users, 1, loginId);
    if (!row) return { ok: false, error: 'auth' };
    users.getRange(row, 12).setValue(req.hideRanking ? '○' : '');
    CacheService.getScriptCache().remove('hofRanking');
    return { ok: true, hideRanking: !!req.hideRanking };
  });
}

function issueToken_(loginId) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const now = new Date();
  appendRow_(sheet_(SHEET.SESSIONS), [hash_(token), loginId, new Date(now.getTime() + TOKEN_DAYS * 86400000), now], [1, 2]);
  return token;
}

/** トークン → ログインID（無効なら null） */
function auth_(token) {
  if (!token) return null;
  const s = sheet_(SHEET.SESSIONS);
  const row = findRow_(s, 1, hash_(token));
  if (!row) return null;
  const v = s.getRange(row, 1, 1, 3).getValues()[0];
  if (!(v[2] instanceof Date) || v[2] < new Date()) return null;
  return String(v[1]);
}

/* ================= 進捗データ ================= */
function loadProgress_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };

  const p = sheet_(SHEET.PROGRESS);
  const row = findRow_(p, 1, loginId);
  if (!row) return { ok: true, rev: 0, data: null };

  const v = p.getRange(row, 1, 1, HEADERS.PROGRESS.length).getValues()[0];
  const chunks = Number(v[3]) || 0;
  // 各チャンク先頭の '~' は数式として解釈されるのを防ぐための目印
  const raw = v.slice(4, 4 + chunks).map(c => String(c).replace(/^~/, '')).join('');
  return {
    ok: true,
    rev: Number(v[2]) || 0,
    updatedAt: v[1] instanceof Date ? v[1].toISOString() : null,
    data: raw ? JSON.parse(raw) : null,
  };
}

/**
 * req: { token, rev, data: {key: rawString|null}, force }
 * rev はクライアントが最後に読み込んだ/保存したリビジョン。
 * サーバー側が先に進んでいたら conflict を返す（force=true で上書き）。
 */
function saveProgress_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };
  if (!req.data || typeof req.data !== 'object') return { ok: false, error: 'bad_request' };
  if (!rateOk_('save:' + loginId, RATE.save)) return { ok: false, error: 'rate_limited' };

  const raw = JSON.stringify(req.data);
  const chunks = [];
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) chunks.push('~' + raw.slice(i, i + CHUNK_SIZE));
  if (chunks.length > MAX_CHUNKS) return { ok: false, error: 'too_large' };

  return withLock_(() => {
    const p = sheet_(SHEET.PROGRESS);
    let row = findRow_(p, 1, loginId);
    const now = new Date();
    let rev = 0;

    if (row) {
      const meta = p.getRange(row, 2, 1, 2).getValues()[0];
      rev = Number(meta[1]) || 0;
      if (!req.force && Number(req.rev || 0) !== rev) {
        return {
          ok: false, error: 'conflict', serverRev: rev,
          serverUpdatedAt: meta[0] instanceof Date ? meta[0].toISOString() : null,
        };
      }
    } else {
      row = p.getLastRow() + 1;
    }

    const newRev = rev + 1;
    const values = [loginId, now, newRev, chunks.length].concat(
      Array.from({ length: MAX_CHUNKS }, (_, i) => chunks[i] || ''));
    const range = p.getRange(row, 1, 1, values.length);
    range.setNumberFormat('@');                 // データ列を文字列として扱う
    p.getRange(row, 2, 1, 3).setNumberFormat('General');
    p.getRange(row, 2).setNumberFormat('yyyy/mm/dd hh:mm');
    range.setValues([values]);

    // 進捗から取り組み状況を更新（前回の値と比べて、不自然な記録がないかも確かめる）
    const summary = summarize_(req.data);
    const flags = checkAnomaly_(loginId, summary, now);
    upsertStatus_(loginId, Object.assign({ progressUpdated: now, flags: flags }, summary));

    // 殿堂入りの記録（初回のみ）
    if (summary.hofAchieved) recordHof_(loginId, '白金の手帖');

    return { ok: true, rev: newRev, updatedAt: now.toISOString() };
  });
}

/** 進捗スナップショットから集計値を取り出す */
function summarize_(data) {
  const parse = (k, fb) => { try { return data[k] ? JSON.parse(data[k]) : fb; } catch (e) { return fb; } };
  const unlocked = parse('unlockedCards', []);
  const xp       = parse('xpData', {});
  const streak   = parse('loginStreak', {});
  const battle   = parse('battleProgress', {});
  const hof      = parse('hallOfFame', {});
  const srs      = parse('srsData', {});
  const nbState  = parse('notebookState', {});

  let mastered = 0;
  Object.keys(srs || {}).forEach(k => { if ((srs[k] && srs[k].level || 0) >= MASTERED_LEVEL) mastered++; });

  return {
    cards:       Array.isArray(unlocked) ? unlocked.length : 0,
    level:       Number(xp.level) || 1,
    totalXP:     Number(xp.totalXP) || 0,
    streak:      Number(streak.streak) || 0,
    bosses:      battle && Array.isArray(battle.defeated) ? battle.defeated.length : 0,
    mastered:    mastered,
    // アプリ内部では殿堂入り（白金の手帖のボスラッシュ）のキーが歴史的に「金の手帖」のまま
    hofAchieved: !!(hof && hof['金の手帖'] && hof['金の手帖'].achieved),
    nbCurrent:   ((NOTEBOOKS.find(n => n.key === (nbState && nbState.current)) || {}).name || '') ,
    nbCounts:    NOTEBOOKS.map(n => (Array.isArray(unlocked) ? unlocked : []).filter(id => String(id).indexOf(n.prefix) === 0).length),
    // 存在しないカード番号（a1-99999 など）や知らない形式のID
    badIds:      (Array.isArray(unlocked) ? unlocked : []).filter(id => {
                   const n = NOTEBOOKS.find(nb => String(id).indexOf(nb.prefix) === 0);
                   if (!n) return true;
                   const num = Number(String(id).slice(n.prefix.length));
                   return !(num >= 1 && num <= n.count && Math.floor(num) === num);
                 }).length,
    dupIds:      Array.isArray(unlocked) ? unlocked.length - new Set(unlocked.map(String)).size : 0,
    gold:        Number(data.gold) || 0,
  };
}

/* ================= 学習ログ ================= */
/**
 * req: { token?, guestId, sessionId, events: [{timestamp, eventType, cardNo, word, meaning,
 *        level, isCorrect, responseTime, totalUnlocked, combo}, ...] }
 */
function log_(req) {
  const events = Array.isArray(req.events) ? req.events.slice(0, 200) : [];
  if (events.length === 0) return { ok: true, count: 0 };

  const loginId = auth_(req.token);
  const user = loginId || cleanText_(req.guestId, 40) || 'unknown';
  const kind = loginId ? '会員' : 'ゲスト';
  const okRate = loginId
    ? rateOk_('logm:' + loginId, RATE.logMember, events.length)
    : rateOk_('logg:' + user, RATE.logGuest, events.length) && rateOk_('logg', RATE.logGuestAll, events.length);
  if (!okRate) return { ok: false, error: 'rate_limited' };
  const tz = Session.getScriptTimeZone();

  const rows = events.map(ev => [
    new Date(Number(ev.timestamp) || Date.now()),
    user, kind, cleanText_(req.sessionId, 40),
    cleanText_(ev.eventType, 20),
    ev.cardNo || '', cleanText_(ev.word, 60), cleanText_(ev.meaning, 80), cleanText_(ev.level, 20),
    typeof ev.isCorrect === 'boolean' ? (ev.isCorrect ? '正解' : '不正解') : '-',
    ev.responseTime || '', ev.totalUnlocked || '', ev.combo || '',
    ((NOTEBOOKS.find(n => n.key === ev.notebook) || {}).name || ''),
    (ev.diff === 0 || ev.diff) ? Math.max(0, Math.min(3, Number(ev.diff) || 0)) : '',   // バトルで配られた単語の苦手度（0〜3）
  ]);

  return withLock_(() => {
    // 新しいものが上：見出しのすぐ下に行を差し込む（2026-11-07 Takaの指示）
    const log = sheet_(SHEET.LOG);
    rows.sort((a, b) => b[0] - a[0]);
    insertTopRows_(log, rows, [2, 4], 'yyyy/mm/dd hh:mm:ss');

    if (!loginId) return { ok: true, count: rows.length };   // ゲストは集計対象外

    // 日別集計と累計を更新
    const byDate = {};
    let total = 0, correct = 0, last = null;
    events.forEach(ev => {
      const t = new Date(Number(ev.timestamp) || Date.now());
      if (!last || t > last) last = t;
      if (ANSWER_EVENTS.indexOf(ev.eventType) < 0 || typeof ev.isCorrect !== 'boolean') return;
      const d = Utilities.formatDate(t, tz, 'yyyy-MM-dd');
      byDate[d] = byDate[d] || { n: 0, c: 0 };
      byDate[d].n++; total++;
      if (ev.isCorrect) { byDate[d].c++; correct++; }
    });

    const daily = sheet_(SHEET.DAILY);
    Object.keys(byDate).forEach(d => {
      const key = d + '|' + loginId;
      const row = findRow_(daily, 5, key);
      if (row) {
        const cur = daily.getRange(row, 3, 1, 2).getValues()[0];
        daily.getRange(row, 3, 1, 2).setValues([[(Number(cur[0]) || 0) + byDate[d].n, (Number(cur[1]) || 0) + byDate[d].c]]);
      } else {
        const p = d.split('-').map(Number);
        appendRow_(daily, [new Date(p[0], p[1] - 1, p[2]), loginId, byDate[d].n, byDate[d].c, key], [2, 5]);
      }
    });

    upsertStatus_(loginId, { addTotal: total, addCorrect: correct, lastActive: last });
    return { ok: true, count: rows.length };
  });
}

/* ================= 取り組み状況 ================= */
function upsertStatus_(loginId, f) {
  const s = sheet_(SHEET.STATUS);
  let row = findRow_(s, ST.ID, loginId);
  if (!row) {
    row = s.getLastRow() + 1;
    s.getRange(row, ST.ID).setNumberFormat('@').setValue(loginId);
    s.getRange(row, ST.TOTAL, 1, 2).setValues([[0, 0]]);
    // 自動計算の列（R1C1形式なので行に依存しない）
    s.getRange(row, ST.IDLE).setFormulaR1C1('=IF(RC6="","",TODAY()-INT(RC6))');
    s.getRange(row, ST.DAYS).setFormulaR1C1("=COUNTIF('" + SHEET.DAILY + "'!C2,RC1)");
    s.getRange(row, ST.WEEK).setFormulaR1C1(
      "=SUMIFS('" + SHEET.DAILY + "'!C3,'" + SHEET.DAILY + "'!C2,RC1,'" + SHEET.DAILY + "'!C1,\">=\"&(TODAY()-6))");
    s.getRange(row, ST.RATE).setFormulaR1C1('=IF(N(RC10)=0,"",RC11/RC10)');
    s.getRange(row, ST.CARD_RATE).setFormulaR1C1('=IF(RC13="","",RC13/' + TOTAL_CARDS + ')');
  }

  const set = (col, val) => { if (val !== undefined && val !== null) s.getRange(row, col).setValue(val); };
  set(ST.NICK, f.nickname);
  set(ST.CLASS, f.klass);
  set(ST.CREATED, f.created);
  set(ST.CARDS, f.cards);
  set(ST.LEVEL, f.level);
  set(ST.XP, f.totalXP);
  set(ST.STREAK, f.streak);
  set(ST.BOSSES, f.bosses);
  set(ST.MASTERED, f.mastered);
  set(ST.PROG_UPDATED, f.progressUpdated);
  if (f.nbCurrent) set(ST.NB_CUR, f.nbCurrent);
  // 要確認：新しい指摘だけを追記（先生が消すまで残す）
  if (f.flags && f.flags.length) {
    const prev = String(s.getRange(row, ST.FLAG).getValue() || '');
    const add = f.flags.filter(x => prev.indexOf(x) < 0);
    if (add.length) {
      const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd');
      s.getRange(row, ST.FLAG).setValue((prev ? prev + ' / ' : '') + day + ' ' + add.join('・'));
    }
  }
  if (Array.isArray(f.nbCounts)) s.getRange(row, ST.NB_FIRST, 1, f.nbCounts.length).setValues([f.nbCounts]);

  if (f.addTotal || f.addCorrect) {
    const cur = s.getRange(row, ST.TOTAL, 1, 2).getValues()[0];
    s.getRange(row, ST.TOTAL, 1, 2).setValues([[(Number(cur[0]) || 0) + (f.addTotal || 0),
                                                 (Number(cur[1]) || 0) + (f.addCorrect || 0)]]);
  }
  if (f.lastActive) {
    const prev = s.getRange(row, ST.LAST).getValue();
    if (!(prev instanceof Date) || f.lastActive > prev) s.getRange(row, ST.LAST).setValue(f.lastActive);
  }
  if (f.progressUpdated) {
    const prev = s.getRange(row, ST.LAST).getValue();
    if (!(prev instanceof Date) || f.progressUpdated > prev) s.getRange(row, ST.LAST).setValue(f.progressUpdated);
  }
}

/* ================= 殿堂入り ================= */
function recordHof_(loginId, category) {
  const h = sheet_(SHEET.HOF);
  const last = h.getLastRow();
  if (last > 1) {
    const ids = h.getRange(2, 2, last - 1, 3).getValues();
    if (ids.some(r => String(r[0]) === loginId && r[2] === category)) return;
  }
  const users = sheet_(SHEET.USERS);
  const urow = findRow_(users, 1, loginId);
  const nick = urow ? users.getRange(urow, 2).getValue() : loginId;
  const now = new Date();
  appendRow_(h, [now, loginId, nick, category], [2, 3]);

  const s = sheet_(SHEET.STATUS);
  const srow = findRow_(s, ST.ID, loginId);
  if (srow) s.getRange(srow, ST.HOF, 1, 2).setValues([['🏆', now]]);

  CacheService.getScriptCache().remove('hofRanking');
}

/** 達成が早い順。ニックネームは最新のユーザー情報を使う */
function hofRanking_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('hofRanking');
  if (hit) return JSON.parse(hit);

  const h = sheet_(SHEET.HOF);
  const last = h.getLastRow();
  let ranking = [];
  if (last > 1) {
    const nickById = {}, hidden = {};
    const users = sheet_(SHEET.USERS);
    if (users.getLastRow() > 1) {
      users.getRange(2, 1, users.getLastRow() - 1, 12).getValues()
        .forEach(r => { nickById[String(r[0])] = r[1]; if (String(r[11] || '').trim()) hidden[String(r[0])] = true; });
    }
    const tz = Session.getScriptTimeZone();
    ranking = h.getRange(2, 1, last - 1, 4).getValues()
      .filter(r => r[0] instanceof Date && !hidden[String(r[1])])   // 「ランキングに載せない」生徒は除く
      .sort((a, b) => a[0] - b[0])
      .slice(0, RANKING_LIMIT)
      .map(r => ({
        name:  nickById[String(r[1])] || r[2] || '名無し',
        level: r[3],
        date:  Utilities.formatDate(r[0], tz, 'yyyy/MM/dd'),
      }));
  }
  const result = { ok: true, ranking: ranking };
  cache.put('hofRanking', JSON.stringify(result), 60);
  return result;
}

/* ================= レイドボス ================= */
function raidWeek_(now) {
  const tz = 'Asia/Tokyo';
  const d = new Date(Utilities.formatDate(now || new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00Z');   // 日本時間の日付（UTCの0時として扱う）
  const dow = (d.getUTCDay() + 6) % 7;   // 月曜=0
  const mon = new Date(d.getTime() - dow * 86400000);
  return { key: mon.toISOString().slice(0, 10), index: Math.floor(mon.getTime() / (7 * 86400000)), today: d.toISOString().slice(0, 10),
           ends: new Date(mon.getTime() + 7 * 86400000).toISOString().slice(0, 10) };
}
function raidHp_() { return Number(PropertiesService.getScriptProperties().getProperty('RAID_HP')) || RAID_HP_DEFAULT; }
/** その週の合計ダメージと上位（キャッシュ30秒） */
function raidBoard_(week) {
  const cache = CacheService.getScriptCache();
  const ck = 'raid:' + week.key;
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const sh = sheet_(SHEET.RAID);
  let total = 0, rows = [];
  if (sh.getLastRow() > 1) {
    const hidden = {};
    const users = sheet_(SHEET.USERS);
    if (users.getLastRow() > 1) users.getRange(2, 1, users.getLastRow() - 1, 12).getValues().forEach(r => { if (String(r[11] || '').trim()) hidden[String(r[0])] = true; });
    rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.RAID.length).getValues().filter(r => String(r[1]) === week.key);
    total = rows.reduce((s, r) => s + (Number(r[4]) || 0), 0);
    rows = rows.filter(r => !hidden[String(r[2])]).sort((a, b) => (Number(b[4]) || 0) - (Number(a[4]) || 0)).slice(0, 10)
      .map(r => ({ name: String(r[3] || '名無し'), dmg: Number(r[4]) || 0 }));
  }
  const out = { total: total, top: rows };
  cache.put(ck, JSON.stringify(out), 30);
  return out;
}
function raidMine_(sh, week, loginId) {
  const row = findRow_(sh, 1, week.key + '|' + loginId);
  if (!row) return { row: 0, dmg: 0, hitsToday: 0, claimed: false };
  const v = sh.getRange(row, 1, 1, HEADERS.RAID.length).getValues()[0];
  const last = v[6] instanceof Date ? Utilities.formatDate(v[6], 'Asia/Tokyo', 'yyyy-MM-dd') : String(v[6] || '');
  return { row: row, dmg: Number(v[4]) || 0, hitsToday: last === week.today ? (Number(v[5]) || 0) : 0, claimed: !!String(v[8] || '').trim(), total: Number(v[7]) || 0 };
}
function raidStatus_(req) {
  const week = raidWeek_();
  const boss = RAID_BOSSES[((week.index % RAID_BOSSES.length) + RAID_BOSSES.length) % RAID_BOSSES.length];
  const hp = raidHp_();
  const board = raidBoard_(week);
  const out = { ok: true, week: week.key, ends: week.ends, boss: { nb: boss[0], name: boss[1] }, hp: hp, dmg: Math.min(hp, board.total),
                defeated: board.total >= hp, top: board.top, maxHits: RAID_DAILY, maxHit: RAID_MAX_HIT, reward: RAID_REWARD, me: null };
  const loginId = req && req.token ? auth_(req.token) : null;
  if (loginId) { const m = raidMine_(sheet_(SHEET.RAID), week, loginId); out.me = { dmg: m.dmg, hitsToday: m.hitsToday, claimed: m.claimed }; }
  return out;
}
function raidHit_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };
  if (!rateOk_('raid:' + loginId, RATE.raid)) return { ok: false, error: 'rate' };
  const pts = Math.round(Number(req.points));
  if (!isFinite(pts) || pts < 0 || pts > RAID_MAX_HIT) return { ok: false, error: 'invalid' };
  return withLock_(() => {
    const week = raidWeek_();
    const sh = sheet_(SHEET.RAID);
    const m = raidMine_(sh, week, loginId);
    if (m.hitsToday >= RAID_DAILY) return { ok: false, error: 'limit' };
    const now = new Date();
    if (m.row) {
      sh.getRange(m.row, 5, 1, 4).setValues([[m.dmg + pts, m.hitsToday + 1, now, m.total + 1]]);
    } else {
      const users = sheet_(SHEET.USERS);
      const urow = findRow_(users, 1, loginId);
      const nick = urow ? users.getRange(urow, 2).getValue() : loginId;
      appendRow_(sh, [week.key + '|' + loginId, week.key, loginId, nick, pts, 1, now, 1, ''], [1, 2, 3, 4]);
    }
    CacheService.getScriptCache().remove('raid:' + week.key);
    return raidStatus_(req);
  });
}
function raidClaim_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };
  return withLock_(() => {
    const week = raidWeek_();
    const st = raidStatus_(req);
    if (!st.defeated) return { ok: false, error: 'not_defeated' };
    const sh = sheet_(SHEET.RAID);
    const m = raidMine_(sh, week, loginId);
    if (!m.row || m.dmg <= 0) return { ok: false, error: 'not_joined' };
    if (m.claimed) return { ok: false, error: 'claimed' };
    sh.getRange(m.row, 9).setValue(new Date());
    return { ok: true, reward: RAID_REWARD };
  });
}
/** レイドボスのHPを変える（メニューから） */
function setRaidHp() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('レイドボスのHP', '1回の挑戦で最大' + RAID_MAX_HIT + '点。参加人数×1日の回数×日数を目安に（今：' + raidHp_() + '）', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const n = Math.round(Number(r.getResponseText()));
  if (!(n > 0)) { ui.alert('正の数を入れてください'); return; }
  PropertiesService.getScriptProperties().setProperty('RAID_HP', String(n));
  ui.alert('レイドボスのHPを ' + n + ' にしました（今週の分から反映）');
}

/* ================= 先生用メニュー ================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('英単語図鑑')
    .addItem('初期セットアップ', 'setupFromMenu')
    .addSeparator()
    .addItem('選択中の生徒のパスワードをリセット', 'resetPasswordForSelectedUser')
    .addItem('選択中の生徒のデータをすべて削除', 'deleteSelectedUser')
    .addItem('期限切れのログイン情報を削除', 'cleanupSessions')
    .addSeparator()
    .addItem('今すぐバックアップ', 'backupNow')
    .addItem('毎週の自動バックアップを開始', 'installWeeklyBackup')
    .addSeparator()
    .addItem('管理者キーを設定・変更', 'setAdminKey')
    .addItem('問い合わせの通知先を設定', 'setContactNotify')
    .addItem('レイドボスのHPを設定', 'setRaidHp')
    .addSeparator()
    .addItem('効果検証レポートを作成（学習ログの集計）', 'buildEffectReportFromMenu')
    .addItem('効果検証レポートを毎朝自動で更新', 'installEffectReportTrigger')
    .addSeparator()
    .addItem('古い学習ログを保管ファイルへ移す（' + LOG_KEEP_DAYS + '日より前）', 'archiveOldLogsFromMenu')
    .addItem('古い学習ログの移動を毎日自動で行う', 'installLogArchiveTrigger')
    .addToUi();
}

/** シート作成・見出し・書式・条件付き書式。何度実行しても安全。 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Tokyo');

  Object.keys(SHEET).forEach(k => {
    const sh = sheet_(SHEET[k]);
    const head = HEADERS[k];
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setBackground('#3b2f12').setFontColor('#f3e2a9');
    sh.setFrozenRows(1);
  });

  // 取り組み状況：先頭に配置し、書式を整える
  const st = sheet_(SHEET.STATUS);
  ss.setActiveSheet(st); ss.moveActiveSheet(1);
  st.setFrozenColumns(3);
  st.getRange('E:E').setNumberFormat('yyyy/mm/dd');
  st.getRange('F:F').setNumberFormat('yyyy/mm/dd hh:mm');
  st.getRange('L:L').setNumberFormat('0%');
  st.getRange('N:N').setNumberFormat('0.0%');
  st.getRange('U:U').setNumberFormat('yyyy/mm/dd');
  st.getRange('V:V').setNumberFormat('yyyy/mm/dd hh:mm');
  st.getRange(1, 1, 1, HEADERS.STATUS.length).setWrap(true).setVerticalAlignment('middle');
  st.setColumnWidths(1, HEADERS.STATUS.length, 90);

  const idle = st.getRange('G2:G');
  const rate = st.getRange('L2:L');
  const hof  = st.getRange('T2:U');
  st.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(7)
      .setBackground('#f4c7c3').setFontColor('#a50e0e').setRanges([idle]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(3)
      .setBackground('#fce8b2').setRanges([idle]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.6)
      .setFontColor('#a50e0e').setRanges([rate]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$T2<>""')
      .setBackground('#fff2cc').setRanges([hof]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$AC2<>""')
      .setBackground('#f4c7c3').setFontColor('#a50e0e').setRanges([st.getRange('AC2:AC')]).build(),
  ]);
  st.setColumnWidth(ST.FLAG, 220);
  if (!st.getFilter()) st.getRange(1, 1, Math.max(st.getMaxRows(), 2), HEADERS.STATUS.length).createFilter();

  setupClassSheet_();

  // 内部用シートは隠す（パスワードのハッシュ・トークン・進捗の生データ）
  [SHEET.SESSIONS, SHEET.PROGRESS].forEach(n => sheet_(n).hideSheet());
  sheet_(SHEET.DAILY).getRange('A:A').setNumberFormat('yyyy/mm/dd');
  sheet_(SHEET.HOF).getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  sheet_(SHEET.LOG).getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm:ss');
  // 学習ログ：これまでの行を新しい順に並べ替える（何度実行しても安全）
  const lg = sheet_(SHEET.LOG);
  if (lg.getLastRow() > 2) lg.getRange(2, 1, lg.getLastRow() - 1, HEADERS.LOG.length).sort({ column: 1, ascending: false });

  // 不要なデフォルトシートを削除
  const def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  // エディタから実行したときは画面にダイアログを出さない（スプレッドシート側で OK を押すまで止まり、6分で時間切れになるため）
  console.log('セットアップが完了しました。次は「デプロイ > 新しいデプロイ」でウェブアプリとして公開してください。');
}

/** スプレッドシートのメニューから実行したとき用（その場で完了を知らせる） */
function setupFromMenu() {
  setup();
  SpreadsheetApp.getUi().alert('セットアップが完了しました。次は「デプロイ > 新しいデプロイ」でウェブアプリとして公開してください。');
}

/** 「ユーザー」か「取り組み状況」シートで生徒の行を選んでから実行。仮のパスワードを設定する */
function resetPasswordForSelectedUser() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET.USERS && sh.getName() !== SHEET.STATUS) {
    ui.alert('「' + SHEET.USERS + '」または「' + SHEET.STATUS + '」シートで生徒の行を選んでから実行してください。');
    return;
  }
  const row = sh.getActiveRange().getRow();
  const loginId = row > 1 ? String(sh.getRange(row, 1).getValue()) : '';
  if (!loginId) { ui.alert('生徒の行を選択してください。'); return; }

  const res = ui.prompt('パスワードのリセット', loginId + ' の新しいパスワード（英字と数字を含む8文字以上）を入力してください', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const password = res.getResponseText().trim();
  if (!PASSWORD_RE.test(password)) { ui.alert('パスワードは英字と数字を含む8〜32文字（空白なし）にしてください。'); return; }

  withLock_(() => {
    const users = sheet_(SHEET.USERS);
    const urow = findRow_(users, 1, loginId);
    if (!urow) throw new Error('ユーザーが見つかりません: ' + loginId);
    const salt = Utilities.getUuid();
    users.getRange(urow, 5, 1, 2).setValues([[passHash_(salt, password), salt]]);
    users.getRange(urow, 9, 1, 2).setValues([[0, '']]);
  });
  ui.alert(loginId + ' のパスワードを変更しました。生徒に伝え、ログイン後は自分で覚えておくように伝えてください。');
}

/** 管理者キーの設定（スプレッドシートのメニューから）。キーはハッシュにしてスクリプトのプロパティに保存し、コードには書かない */
function setAdminKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('管理者キーの設定', '新しい管理者キー（英数字10文字以上）を入力してください。アプリの「秘密の鍵」に入れると全カードが解禁されます。\n使えるのは「ユーザー」シートの「管理者」列に ○ を付けたアカウントだけです。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim().toUpperCase();
  if (!/^[A-Z0-9]{10,40}$/.test(key)) { ui.alert('英数字10文字以上にしてください。'); return; }
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({ ADMIN_KEY_SALT: salt, ADMIN_KEY_HASH: passHash_(salt, key) });
  ui.alert('管理者キーを設定しました。');
}

/** 管理者キーの照合。ログイン中で、管理者の印があるアカウントだけ */
function adminUnlock_(req) {
  const loginId = auth_(req.token);
  if (!loginId) return { ok: false, error: 'auth' };
  if (!rateOk_('admin:' + loginId, RATE.admin)) return { ok: false, error: 'rate_limited' };
  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('ADMIN_KEY_SALT'), want = props.getProperty('ADMIN_KEY_HASH');
  if (!salt || !want) return { ok: false, error: 'bad_key' };
  const users = sheet_(SHEET.USERS);
  const row = findRow_(users, 1, loginId);
  const isAdmin = row && String(users.getRange(row, 11).getValue()).trim() !== '';
  const keyOk = passHash_(salt, String(req.key || '').trim().toUpperCase()) === want;
  if (!isAdmin || !keyOk) return { ok: false, error: 'bad_key' };
  withLock_(() => upsertStatus_(loginId, { flags: ['管理者キー使用'] }));
  return { ok: true };
}

/** 不自然な記録の検出（先生が「要確認」の列で見られるように） */
function checkAnomaly_(loginId, sm, now) {
  const flags = [];
  const users = sheet_(SHEET.USERS);
  const urow = findRow_(users, 1, loginId);
  const isAdmin = urow && String(users.getRange(urow, 11).getValue()).trim() !== '';
  if (sm.badIds) flags.push('存在しないカード' + sm.badIds + '枚');
  if (sm.dupIds) flags.push('重複したカード' + sm.dupIds + '枚');
  if (sm.cards > TOTAL_CARDS) flags.push('カード数が上限超え');
  if (sm.gold > 1000000) flags.push('ゴールドが異常に多い');
  if (sm.hofAchieved && (sm.nbCounts[4] || 0) < Math.floor(NOTEBOOKS[4].count * 0.8)) flags.push('殿堂入りなのに白金のカードが少ない');
  if (!isAdmin) {
    // 前回の保存からの新しいカードの増え方（1日100枚まで）
    const s = sheet_(SHEET.STATUS);
    const row = findRow_(s, ST.ID, loginId);
    if (row) {
      const v = s.getRange(row, 1, 1, ST.PROG_UPDATED).getValues()[0];
      const prevCards = Number(v[ST.CARDS - 1]) || 0, prevAt = v[ST.PROG_UPDATED - 1];
      if (prevAt instanceof Date) {
        const tz = Session.getScriptTimeZone();
        const days = Math.round((new Date(Utilities.formatDate(now, tz, 'yyyy-MM-dd')) - new Date(Utilities.formatDate(prevAt, tz, 'yyyy-MM-dd'))) / 86400000);
        const allowed = DAILY_NEW_LIMIT * (Math.max(0, days) + 1) + 10;
        if (sm.cards - prevCards > allowed) flags.push('カードの増え方が不自然（+' + (sm.cards - prevCards) + '枚）');
      }
    }
  }
  return flags;
}

/** クラス別集計シート：取り組み状況の「クラス（先生用）」列に先生がクラスを書くと、自動で集計される */
function setupClassSheet_() {
  const c = sheet_(SHEET.CLASS);
  const S = "'" + SHEET.STATUS + "'!";
  // 列：D=クラス G=未利用日数 I=直近7日の回答数 J=累計回答数 K=正解数 M=獲得カード S=習得語数
  const f = [
    '=IFERROR(SORT(UNIQUE(FILTER(' + S + 'D2:D, ' + S + 'D2:D<>""))), "")',
    '=ARRAYFORMULA(IF(A2:A="", "", COUNTIF(' + S + 'D2:D, A2:A)))',
    '=ARRAYFORMULA(IF(A2:A="", "", COUNTIFS(' + S + 'D2:D, A2:A, ' + S + 'G2:G, "<=7")))',
    '=ARRAYFORMULA(IF(A2:A="", "", IFERROR(C2:C/B2:B, 0)))',
    '=ARRAYFORMULA(IF(A2:A="", "", SUMIF(' + S + 'D2:D, A2:A, ' + S + 'I2:I)))',
    '=ARRAYFORMULA(IF(A2:A="", "", IFERROR(SUMIF(' + S + 'D2:D, A2:A, ' + S + 'J2:J)/B2:B, 0)))',
    '=ARRAYFORMULA(IF(A2:A="", "", IFERROR(SUMIF(' + S + 'D2:D, A2:A, ' + S + 'K2:K)/SUMIF(' + S + 'D2:D, A2:A, ' + S + 'J2:J), "")))',
    '=ARRAYFORMULA(IF(A2:A="", "", IFERROR(SUMIF(' + S + 'D2:D, A2:A, ' + S + 'M2:M)/B2:B, 0)))',
    '=ARRAYFORMULA(IF(A2:A="", "", IFERROR(SUMIF(' + S + 'D2:D, A2:A, ' + S + 'S2:S)/B2:B, 0)))',
  ];
  c.getRange(2, 1, 1, f.length).setFormulas([f]);
  c.getRange('D:D').setNumberFormat('0%');
  c.getRange('G:G').setNumberFormat('0%');
  c.getRange('F:F').setNumberFormat('0');
  c.getRange('H:I').setNumberFormat('0');
}

/** 選択した生徒のデータをすべて削除（卒業・転校・本人の希望のとき）。元に戻せない */
function deleteSelectedUser() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET.USERS && sh.getName() !== SHEET.STATUS) {
    ui.alert('「' + SHEET.USERS + '」または「' + SHEET.STATUS + '」シートで生徒の行を選んでから実行してください。');
    return;
  }
  const row = sh.getActiveRange().getRow();
  const loginId = row > 1 ? String(sh.getRange(row, 1).getValue()) : '';
  if (!loginId) { ui.alert('生徒の行を選択してください。'); return; }
  const ok = ui.alert('データの削除', loginId + ' の登録情報・進捗・学習ログ・集計・殿堂入りの記録をすべて削除します。元に戻せません。よろしいですか？', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  const n = deleteUserData_(loginId);
  ui.alert(loginId + ' のデータを削除しました（' + n + '行）。');
}

/** ログインIDに関係する行をすべてのシートから削除。削除した行数を返す */
function deleteUserData_(loginId) {
  return withLock_(() => {
    let total = 0;
    // [シート, ログインIDの列]
    [[SHEET.USERS, 1], [SHEET.SESSIONS, 2], [SHEET.PROGRESS, 1], [SHEET.STATUS, 1],
     [SHEET.LOG, 2], [SHEET.DAILY, 2], [SHEET.HOF, 2], [SHEET.CONTACT, 5], [SHEET.RAID, 3]].forEach(([name, col]) => {
      const sh = sheet_(name);
      const last = sh.getLastRow();
      if (last < 2) return;
      const width = Math.max(HEADERS[Object.keys(SHEET).find(k => SHEET[k] === name)].length, 1);
      const rng = sh.getRange(2, 1, last - 1, width);
      const vals = rng.getValues();
      const keep = vals.filter(r => String(r[col - 1]) !== loginId);
      const removed = vals.length - keep.length;
      if (!removed) return;
      total += removed;
      if (name === SHEET.STATUS) {
        // 取り組み状況は数式の列があるので、行ごと削除する（下から）
        for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][col - 1]) === loginId) sh.deleteRow(i + 2);
      } else {
        rng.clearContent();
        if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
      }
    });
    total += deleteArchivedLogs_(loginId);   // 保管ファイルに移した古い学習ログからも削除
    CacheService.getScriptCache().remove('hofRanking');
    return total;
  });
}

/** バックアップ：別のスプレッドシート「英単語図鑑_バックアップ」に、全シートの値を日付つきで写す。古いものは BACKUP_KEEP 回分だけ残す */
function backupNow(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  let bk = null;
  const id = props.getProperty('BACKUP_ID');
  if (id) { try { bk = SpreadsheetApp.openById(id); } catch (e) { bk = null; } }
  if (!bk) {
    bk = SpreadsheetApp.create('英単語図鑑_バックアップ');
    props.setProperty('BACKUP_ID', bk.getId());
  }
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  Object.keys(SHEET).forEach(k => {
    if (k === 'CLASS') return;   // 集計は数式なので不要
    const src = sheet_(SHEET[k]);
    const last = src.getLastRow();
    const width = HEADERS[k].length;
    const dst = bk.insertSheet(stamp + '_' + SHEET[k]);
    if (last > 0) dst.getRange(1, 1, last, width).setValues(src.getRange(1, 1, last, width).getValues());
  });
  // 古いバックアップを削除
  const stamps = Array.from(new Set(bk.getSheets().map(sh => sh.getName().split('_').slice(0, 2).join('_'))
    .filter(n => /^\d{8}_\d{4}$/.test(n)))).sort();
  stamps.slice(0, Math.max(0, stamps.length - BACKUP_KEEP)).forEach(old => {
    bk.getSheets().filter(sh => sh.getName().indexOf(old + '_') === 0).forEach(sh => bk.deleteSheet(sh));
  });
  const def = bk.getSheetByName('シート1') || bk.getSheetByName('Sheet1');
  if (def && bk.getSheets().length > 1) bk.deleteSheet(def);
  console.log('バックアップしました: ' + stamp + '（' + bk.getUrl() + '）');
  if (silent !== true) {
    try { SpreadsheetApp.getUi().alert('バックアップしました（' + stamp + '）。\nGoogleドライブの「英単語図鑑_バックアップ」に保存されています。'); } catch (e) {}
  }
}
function weeklyBackup() { backupNow(true); }   // トリガーから呼ぶので名前の最後に _ を付けない

/** 毎週日曜の深夜にバックアップするトリガーを設定（何度実行しても1つだけ） */
function installWeeklyBackup() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'weeklyBackup').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();
  try { SpreadsheetApp.getUi().alert('毎週日曜の深夜2時ごろに自動でバックアップするように設定しました。'); } catch (e) {}
}

function cleanupSessions() {
  withLock_(() => {
    const s = sheet_(SHEET.SESSIONS);
    const last = s.getLastRow();
    if (last < 2) return;
    const now = new Date();
    const vals = s.getRange(2, 1, last - 1, 4).getValues();
    const keep = vals.filter(r => r[2] instanceof Date && r[2] > now);
    s.getRange(2, 1, last - 1, 4).clearContent();
    if (keep.length) s.getRange(2, 1, keep.length, 4).setValues(keep);
  });
}

/* ================= ユーティリティ ================= */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** 指定列で完全一致する行番号（見出し行を除く）。なければ 0 */
function findRow_(sheet, col, value) {
  if (sheet.getLastRow() < 2 || value === '' || value === null || value === undefined) return 0;
  const cell = sheet.getRange(2, col, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findNext();
  return cell ? cell.getRow() : 0;
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** 見出し（1行目）のすぐ下に行を差し込む。新しいものが上に来るログ用。
 *  差し込んだ行は見出しの書式を引き継ぐので、通常の書式に戻してから値を書く */
function insertTopRows_(sheet, rows, textCols, dateFormat) {
  if (!rows.length) return;
  if (sheet.getLastRow() < 1) sheet.getRange(1, 1).setValue('');
  sheet.insertRowsAfter(1, rows.length);
  const width = rows[0].length;
  const rng = sheet.getRange(2, 1, rows.length, width);
  rng.setFontWeight('normal').setBackground(null).setFontColor(null).setNumberFormat('General');
  (textCols || []).forEach(c => sheet.getRange(2, c, rows.length, 1).setNumberFormat('@'));
  if (dateFormat) sheet.getRange(2, 1, rows.length, 1).setNumberFormat(dateFormat);
  rng.setValues(rows);
}

/** 指定列を文字列書式にしてから1行追加（"0123" や "1e5" が数値化されるのを防ぐ） */
function appendRow_(sheet, values, textCols) {
  const row = sheet.getLastRow() + 1;
  (textCols || []).forEach(c => sheet.getRange(row, c).setNumberFormat('@'));
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}

function normId_(s) { return String(s || '').trim().toLowerCase(); }

/** パスワードのハッシュ（ソルト付きで繰り返す）。先頭の v2$ で新しい形式と分かる */
function passHash_(salt, password) {
  let h = hash_(salt + password);
  for (let i = 0; i < HASH_ROUNDS; i++) h = hash_(h + salt);
  return 'v2$' + h;
}
/** 照合（古い形式＝旧PINの1回だけのハッシュにも対応） */
function passOk_(salt, password, stored) {
  if (stored.indexOf('v2$') === 0) return passHash_(salt, password) === stored;
  return hash_(salt + password) === stored;
}

/** 送信回数の制限。key ごとに sec 秒の間に max 回まで（n＝今回の件数）。超えたら false */
function rateOk_(key, lim, n) {
  const cache = CacheService.getScriptCache();
  const k = 'rl:' + key;
  const cur = Number(cache.get(k)) || 0;
  const next = cur + (n || 1);
  if (next > lim[0]) return false;
  cache.put(k, String(next), lim[1]);
  return true;
}

/** 制御文字と < > を除き、長さを制限。先頭の = + - @（全角も）は数式扱いを防ぐため、空白を挟んでも除去 */
function cleanText_(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/^[\s\u3000=+\-@＝＋－＠]+/, '')
    .trim()
    .slice(0, max);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ================= 動作確認（エディタから実行） ================= */
function testFlow() {
  const call = obj => JSON.parse(doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
  const id = 'test' + Math.floor(Math.random() * 10000);
  const reg = call({ action: 'register', loginId: id, nickname: 'テスト' + id, password: 'test1234' });
  Logger.log(reg);
  Logger.log(call({ action: 'login', loginId: id, password: 'test1234' }));
  Logger.log(call({ action: 'saveProgress', token: reg.token, rev: 0,
    data: { unlockedCards: '[1,2,3]', xpData: '{"level":2,"totalXP":150}', hallOfFame: '{"金の手帖":{"achieved":true}}' } }));
  Logger.log(call({ action: 'log', token: reg.token, sessionId: 's-test',
    events: [{ timestamp: Date.now(), eventType: 'training', cardNo: 1, word: 'abandon', isCorrect: true }] }));
  Logger.log(call({ action: 'loadProgress', token: reg.token }));
  Logger.log(hofRanking_());
}


/* ================= 効果検証レポート（学習ログの集計） =================
 * 「学習ログ」シートの会員の回答だけを集計し、「効果検証」シートに書き出す。何度実行しても上書きされるだけで安全。
 * 中心の指標＝間隔をあけた再挑戦（同じ生徒が同じ単語・文法問題に、1日以上／7日以上あけて再び答えたとき正解できたか）。
 *   ・初回で間違えた単語を、後日どれだけ正解できるようになったか（克服率）
 *   ・正解までの回答時間が初回より短くなったか（定着・自動化）
 *   ・よく使った生徒ほど伸びたか（利用日数で3グループに分けて比較＝用量反応）
 * 限界：4択の再認であり、事前・事後テストのような外部の学力指標ではない。対照群もない（シートの末尾にも明記）。 */
const EFFECT_SHEET = '効果検証';
const DAY_MS = 86400000;

function effectStats_(rows) {
  // rows: 学習ログの値（見出しなし）。列：A時刻 B生徒 C区分 E種類 F番号 G英単語 J正誤 K回答時間 N手帖 O苦手度
  const byUser = {};
  let first = null, last = null, n = 0;
  rows.forEach(r => {
    if (r[2] !== '会員') return;
    const ev = String(r[4]);
    if (ANSWER_EVENTS.indexOf(ev) < 0) return;
    if (r[9] !== '正解' && r[9] !== '不正解') return;
    const t = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
    if (!isFinite(t)) return;
    const user = String(r[1]);
    const key = (ev === 'grammar' ? 'G|' : String(r[13]) + '|') + (r[5] !== '' ? r[5] : r[6]);
    const u = byUser[user] = byUser[user] || { items: {}, days: {}, n: 0, c: 0 };
    (u.items[key] = u.items[key] || []).push({ t, ok: r[9] === '正解', rt: Number(r[10]) || 0, ev, diff: r[14] === '' ? null : Number(r[14]) });
    u.days[Utilities.formatDate(new Date(t), 'Asia/Tokyo', 'yyyy-MM-dd')] = 1;
    u.n++; if (r[9] === '正解') u.c++;
    n++; if (!first || t < first) first = t; if (!last || t > last) last = t;
  });
  return { byUser, first, last, n };
}

/** 1つの単語の回答の並び（時刻順）から、初回と「gap日以上あとの最初の再挑戦」を取り出す */
function effectLater_(list, gapDays) {
  const t0 = list[0].t;
  for (let i = 1; i < list.length; i++) if (list[i].t - t0 >= gapDays * DAY_MS) return list[i];
  return null;
}

function effectRate_(a, b) { return b ? Math.round(a / b * 1000) / 10 : ''; }
function effectMedian_(a) { if (!a.length) return ''; a = a.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2 * 10) / 10; }

function effectReport_(rows) {
  const S = effectStats_(rows);
  const users = Object.keys(S.byUser);
  const acc = () => ({ pairs: 0, firstOk: 0, l1: 0, l1ok: 0, l7: 0, l7ok: 0, ng1: 0, ng1ok: 0, ng7: 0, ng7ok: 0, rt0: [], rt1: [] });
  const all = acc(), gram = acc();
  const perUser = [];
  const add = (A, list) => {
    list.sort((a, b) => a.t - b.t);
    const f = list[0], a1 = effectLater_(list, 1), a7 = effectLater_(list, 7);
    A.pairs++; if (f.ok) A.firstOk++;
    if (a1) { A.l1++; if (a1.ok) A.l1ok++; if (!f.ok) { A.ng1++; if (a1.ok) A.ng1ok++; } if (f.ok && a1.ok && f.rt && a1.rt) { A.rt0.push(f.rt); A.rt1.push(a1.rt); } }
    if (a7) { A.l7++; if (a7.ok) A.l7ok++; if (!f.ok) { A.ng7++; if (a7.ok) A.ng7ok++; } }
  };
  // バトルの苦手度ごとの正答率
  const diff = [0, 1, 2, 3].map(() => ({ n: 0, c: 0 }));
  users.forEach(id => {
    const U = S.byUser[id], me = acc();
    Object.keys(U.items).forEach(k => {
      add(all, U.items[k]); add(me, U.items[k]);
      if (k.indexOf('G|') === 0) add(gram, U.items[k]);
      U.items[k].forEach(x => { if (x.ev === 'battle' && x.diff !== null && diff[x.diff]) { diff[x.diff].n++; if (x.ok) diff[x.diff].c++; } });
    });
    perUser.push({ id, days: Object.keys(U.days).length, n: U.n, rate: effectRate_(U.c, U.n), first: effectRate_(me.firstOk, me.pairs),
      later: effectRate_(me.l1ok, me.l1), gain: (me.l1 && me.pairs) ? Math.round((me.l1ok / me.l1 - me.firstOk / me.pairs) * 1000) / 10 : '',
      ng: me.ng1, recover: effectRate_(me.ng1ok, me.ng1), _ng1ok: me.ng1ok });
  });
  perUser.sort((a, b) => b.n - a.n);

  // 週ごとの推移（月曜はじまり）
  const weeks = {};
  users.forEach(id => Object.keys(S.byUser[id].items).forEach(k => S.byUser[id].items[k].forEach((x, i) => {
    const d = new Date(x.t + 9 * 3600000); const dow = (d.getUTCDay() + 6) % 7;
    const wk = Utilities.formatDate(new Date(x.t - dow * DAY_MS), 'Asia/Tokyo', 'yyyy-MM-dd');
    const W = weeks[wk] = weeks[wk] || { users: {}, n: 0, c: 0, fn: 0, fc: 0, rn: 0, rc: 0 };
    W.users[id] = 1; W.n++; if (x.ok) W.c++;
    if (i === 0) { W.fn++; if (x.ok) W.fc++; } else { W.rn++; if (x.ok) W.rc++; }
  })));

  // 利用日数で3グループ（回答20以上の生徒）→ 初回に間違えた単語の克服率を比べる
  const el = perUser.filter(u => u.n >= 20 && u.ng > 0).sort((a, b) => a.days - b.days);
  const groups = [];
  if (el.length >= 3) {
    const cut = [0, Math.floor(el.length / 3), Math.floor(el.length * 2 / 3), el.length];
    ['少ない', 'ふつう', '多い'].forEach((name, g) => {
      const part = el.slice(cut[g], cut[g + 1]);
      const ng = part.reduce((a, u) => a + u.ng, 0), ok = part.reduce((a, u) => a + u._ng1ok, 0);
      groups.push([`利用日数が${name}グループ`, part.length, `${part[0].days}〜${part[part.length - 1].days}日`, effectRate_(ok, ng), Math.round(part.reduce((a, u) => a + u.n, 0) / part.length)]);
    });
  }
  return { S, users, all, gram, perUser, weeks, groups, diff };
}

/** レポートを「効果検証」シートに書き出す */
function buildEffectReport() {
  const log = sheet_(SHEET.LOG);
  const nRows = log.getLastRow() - 1;
  const rows = (nRows > 0 ? log.getRange(2, 1, nRows, 15).getValues() : []).concat(archivedLogRows_());   // 保管ファイルへ移した古いログも含める
  const R = effectReport_(rows), A = R.all, tz = 'Asia/Tokyo';
  const fmt = t => t ? Utilities.formatDate(new Date(t), tz, 'yyyy/MM/dd') : '-';
  const out = [];
  const W = 8;
  const row = (...v) => { const a = v.slice(0, W); while (a.length < W) a.push(''); out.push(a); };
  const bold = [];
  const head = (...v) => { bold.push(out.length + 1); row(...v); };

  head('■ 効果検証レポート（学習ログの集計）');
  row('作成日時', Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd HH:mm'));
  row('対象期間', fmt(R.S.first) + ' 〜 ' + fmt(R.S.last));
  row('対象', `会員 ${R.users.length}人・回答 ${R.S.n}件（ゲストは含まない）`);
  row('');
  head('■ 要約（応募書類・報告にそのまま使える文）');
  const lines = [];
  if (A.ng7) lines.push(`初回で間違えた単語のうち、7日以上あとの再挑戦で正解できた割合は ${effectRate_(A.ng7ok, A.ng7)}%（${A.ng7}語）。`);
  if (A.ng1) lines.push(`初回で間違えた単語のうち、翌日以降の再挑戦で正解できた割合は ${effectRate_(A.ng1ok, A.ng1)}%（${A.ng1}語）。`);
  if (A.l1) lines.push(`単語ごとの正答率は、初回 ${effectRate_(A.firstOk, A.pairs)}% → 翌日以降の再挑戦 ${effectRate_(A.l1ok, A.l1)}%。`);
  if (A.rt0.length) lines.push(`初回も再挑戦も正解した単語では、回答時間の中央値が ${effectMedian_(A.rt0)}秒 → ${effectMedian_(A.rt1)}秒。`);
  if (R.groups.length === 3) lines.push(`利用日数の多いグループほど克服率が高いか：少ない ${R.groups[0][3]}% ／ ふつう ${R.groups[1][3]}% ／ 多い ${R.groups[2][3]}%。`);
  if (!lines.length) lines.push('まだ再挑戦のデータが足りません（同じ単語に1日以上あけて答えた記録が必要）。');
  lines.forEach(l => row(l));
  row('');

  head('■ 1. 間隔をあけた再挑戦（同じ生徒が同じ単語に、日をあけて答えたとき）', '単語数', '正答率(%)');
  row('初回の回答', A.pairs, effectRate_(A.firstOk, A.pairs));
  row('翌日以降の最初の再挑戦', A.l1, effectRate_(A.l1ok, A.l1));
  row('7日以降の最初の再挑戦', A.l7, effectRate_(A.l7ok, A.l7));
  row('初回不正解 → 翌日以降に正解（克服率）', A.ng1, effectRate_(A.ng1ok, A.ng1));
  row('初回不正解 → 7日以降に正解（克服率）', A.ng7, effectRate_(A.ng7ok, A.ng7));
  row('回答時間の中央値（秒）：初回 → 翌日以降（どちらも正解の単語）', A.rt0.length, effectMedian_(A.rt0) + ' → ' + effectMedian_(A.rt1));
  if (R.gram.pairs) {
    row('（文法問題のみ）初回の回答', R.gram.pairs, effectRate_(R.gram.firstOk, R.gram.pairs));
    row('（文法問題のみ）翌日以降の最初の再挑戦', R.gram.l1, effectRate_(R.gram.l1ok, R.gram.l1));
    row('（文法問題のみ）初回不正解 → 翌日以降に正解', R.gram.ng1, effectRate_(R.gram.ng1ok, R.gram.ng1));
  }
  row('');

  head('■ 2. 利用量と伸び（回答20件以上の生徒を利用日数で3等分）', '人数', '利用日数', '克服率(%)', '平均回答数');
  if (R.groups.length) R.groups.forEach(g => row(...g)); else row('（対象の生徒が3人未満）');
  row('');

  head('■ 3. バトル：配られた単語の苦手度ごとの正答率', '回答数', '正答率(%)');
  ['苦手度0（ふつう）', '苦手度1（ちょっと苦手）', '苦手度2（苦手）', '苦手度3（超苦手）'].forEach((l, i) => row(l, R.diff[i].n, effectRate_(R.diff[i].c, R.diff[i].n)));
  row('');

  head('■ 4. 週ごとの推移（月曜はじまり）', '利用した人数', '回答数', '正答率(%)', '初めての単語の正答率(%)', '2回目以降の単語の正答率(%)');
  Object.keys(R.weeks).sort().forEach(k => { const w = R.weeks[k]; row(k, Object.keys(w.users).length, w.n, effectRate_(w.c, w.n), effectRate_(w.fc, w.fn), effectRate_(w.rc, w.rn)); });
  row('');

  head('■ 5. 生徒ごと（回答数の多い順）', '利用日数', '回答数', '正答率(%)', '初回正答率(%)', '再挑戦の正答率(%)', '伸び(ポイント)', '克服率(%)');
  R.perUser.forEach(u => row(u.id, u.days, u.n, u.rate, u.first, u.later, u.gain, u.recover));
  row('');

  head('■ 読み方と限界');
  row('・「再挑戦」は、同じ単語（同じ手帖の同じカード）・同じ文法問題に、初回から1日（7日）以上あけて最初に答えたときの結果です。');
  row('・すべて4択などアプリ内の回答で、外部の学力テストではありません。対照群（使わなかった生徒）との比較もありません。');
  row('・苦手な単語・忘れかけの単語ほど再び出やすい仕組みのため、再挑戦の単語は難しめに偏ります（伸びは控えめに出ます）。');
  row('・生徒の名前は出していません（ログインIDのみ）。外部に出すときは要約と表1〜4だけを使ってください。');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(EFFECT_SHEET) || ss.insertSheet(EFFECT_SHEET);
  sh.clear();
  sh.getRange(1, 1, out.length, W).setValues(out);
  bold.forEach(r => sh.getRange(r, 1, 1, W).setFontWeight('bold').setBackground('#3b2f12').setFontColor('#f3e2a9'));
  sh.setColumnWidth(1, 420);
  sh.setColumnWidths(2, W - 1, 110);
  return { users: R.users.length, answers: R.S.n, rows: out.length };
}

function buildEffectReportFromMenu() {
  const r = buildEffectReport();
  SpreadsheetApp.getUi().alert(`「${EFFECT_SHEET}」シートを更新しました（会員 ${r.users}人・回答 ${r.answers}件）。`);
}
function dailyEffectReport() { buildEffectReport(); }   // トリガーから呼ぶ
function installEffectReportTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyEffectReport').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyEffectReport').timeBased().everyDays(1).atHour(5).create();
  SpreadsheetApp.getUi().alert('毎朝5時ごろに「効果検証」シートを自動で更新します。');
}


/* ================= 古い学習ログの保管（2026-11-07 Takaの指示：古いログは学習ログのシートから消してよい） =================
 * LOG_KEEP_DAYS 日より古い行を、別のスプレッドシート「英単語図鑑_学習ログ保管」の月ごとのシート（例：2026-11）へ移す。
 * 学習ログのシートは軽くなり（スプレッドシートの上限 1,000万セル対策）、効果検証レポートと生徒データの削除は保管分も対象にする。 */
function logArchive_(create) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LOG_ARCHIVE_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  if (!create) return null;
  const a = SpreadsheetApp.create('英単語図鑑_学習ログ保管');
  props.setProperty('LOG_ARCHIVE_ID', a.getId());
  return a;
}

function archiveOldLogs() {
  return withLock_(() => {
    const log = sheet_(SHEET.LOG);
    const last = log.getLastRow();
    if (last < 2) return 0;
    const width = HEADERS.LOG.length;
    const vals = log.getRange(2, 1, last - 1, width).getValues();
    const cutoff = Date.now() - LOG_KEEP_DAYS * 86400000;
    const time = r => r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
    const old = [], keep = [];
    vals.forEach(r => { const t = time(r); (isFinite(t) && t < cutoff ? old : keep).push(r); });
    if (!old.length) return 0;
    // 保管ファイルへ（月ごとのシート・新しいものが上）
    const a = logArchive_(true);
    const byMonth = {};
    old.forEach(r => { const m = Utilities.formatDate(new Date(time(r)), 'Asia/Tokyo', 'yyyy-MM'); (byMonth[m] = byMonth[m] || []).push(r); });
    Object.keys(byMonth).sort().forEach(m => {
      let sh = a.getSheetByName(m);
      if (!sh) {
        sh = a.insertSheet(m);
        sh.getRange(1, 1, 1, width).setValues([HEADERS.LOG]).setFontWeight('bold').setBackground('#3b2f12').setFontColor('#f3e2a9');
        sh.setFrozenRows(1);
      }
      insertTopRows_(sh, byMonth[m].sort((x, y) => time(y) - time(x)), [2, 4], 'yyyy/mm/dd hh:mm:ss');
    });
    const def = a.getSheetByName('シート1') || a.getSheetByName('Sheet1');
    if (def && a.getSheets().length > 1) a.deleteSheet(def);
    // 学習ログのシートから消す（残す行を詰め直してから、余った行を削除）
    log.getRange(2, 1, vals.length, width).clearContent();
    if (keep.length) log.getRange(2, 1, keep.length, width).setValues(keep);
    log.deleteRows(keep.length + 2, old.length);
    return old.length;
  });
}

/** 保管ファイルの全行（効果検証レポート用） */
function archivedLogRows_() {
  const a = logArchive_(false);
  if (!a) return [];
  let out = [];
  a.getSheets().forEach(sh => {
    if (!/^\d{4}-\d{2}$/.test(sh.getName())) return;
    const last = sh.getLastRow();
    if (last > 1) out = out.concat(sh.getRange(2, 1, last - 1, 15).getValues());
  });
  return out;
}

/** 保管ファイルから1人分の行を削除（生徒データの削除用）。削除した行数を返す */
function deleteArchivedLogs_(loginId) {
  const a = logArchive_(false);
  if (!a) return 0;
  let total = 0;
  const width = HEADERS.LOG.length;
  a.getSheets().forEach(sh => {
    if (!/^\d{4}-\d{2}$/.test(sh.getName())) return;
    const last = sh.getLastRow();
    if (last < 2) return;
    const vals = sh.getRange(2, 1, last - 1, width).getValues();
    const keep = vals.filter(r => String(r[1]) !== loginId);
    const removed = vals.length - keep.length;
    if (!removed) return;
    total += removed;
    sh.getRange(2, 1, vals.length, width).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
    sh.deleteRows(keep.length + 2, removed);
  });
  return total;
}

function archiveOldLogsFromMenu() {
  const n = archiveOldLogs();
  SpreadsheetApp.getUi().alert(n ? `${LOG_KEEP_DAYS}日より前の学習ログ ${n}行を「英単語図鑑_学習ログ保管」へ移しました。` : `${LOG_KEEP_DAYS}日より前の学習ログはありません。`);
}
function dailyLogArchive() { archiveOldLogs(); }   // トリガーから呼ぶ
function installLogArchiveTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyLogArchive').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyLogArchive').timeBased().everyDays(1).atHour(4).create();
  SpreadsheetApp.getUi().alert(`毎朝4時ごろに、${LOG_KEEP_DAYS}日より前の学習ログを「英単語図鑑_学習ログ保管」へ移します。`);
}
