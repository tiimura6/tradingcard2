/**
 * ハイレベル英単語図鑑（鉄・銅・銀・金・白金の手帖） — バックエンド
 * Google Apps Script（スプレッドシートにバインド）
 *
 * 機能
 *   - 生徒の自己登録（ログインID + ニックネーム + パスワード）とログイン。氏名・クラスは集めない
 *   - セキュリティ：パスワードはソルト付きで繰り返しハッシュ化、失敗が続くと段階的にロック、
 *     送信回数の制限、スプレッドシートへの数式の埋め込み防止、管理者キーはサーバーで照合、不正な記録の検出
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
};
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
};

const HEADERS = {
  USERS:    ['ログインID', 'ニックネーム', 'メモ（先生用）', 'クラス（先生用）', 'パスワードハッシュ', 'ソルト', '登録日時', '最終ログイン', '失敗回数', 'ロック解除時刻',
             '管理者（○で有効）'],
  SESSIONS: ['トークンハッシュ', 'ログインID', '有効期限', '発行日時'],
  PROGRESS: ['ログインID', '更新日時', 'リビジョン', '分割数'].concat(
              Array.from({ length: MAX_CHUNKS }, (_, i) => 'データ' + (i + 1))),
  LOG:      ['タイムスタンプ', 'ユーザー', '区分', 'セッションID', 'イベント', 'カードNo', '英単語', '意味',
             'レベル', '正誤', '回答時間(秒)', '取得カード数', '連続正解', '手帖'],
  DAILY:    ['日付', 'ログインID', '回答数', '正解数', 'キー'],
  STATUS:   ['ログインID', 'ニックネーム', 'メモ（先生用）', 'クラス（先生用）', '登録日', '最終利用', '未利用日数', '利用日数',
             '直近7日の回答数', '累計回答数', '正解数', '正答率', '獲得カード', '収集率', 'レベル', '累計XP',
             '連続ログイン', '撃破ボス数', '習得語数', '殿堂入り', '殿堂入り日', '進捗更新',
             '開いている手帖', '鉄（枚）', '銅（枚）', '銀（枚）', '金（枚）', '白金（枚）', '要確認'],
  HOF:      ['達成日時', 'ログインID', 'ニックネーム', '区分'],
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
const ANSWER_EVENTS = ['training', 'gacha', 'challenge', 'battle'];

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
    appendRow_(users, [loginId, nickname, '', '', passHash_(salt, password), salt, now, now, 0, '', ''], [1, 2, 3, 4, 5, 6]);

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
    return { ok: true, token: token, loginId: loginId, nickname: v[1] };
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
  return { ok: true, loginId: loginId, nickname: row ? users.getRange(row, 2).getValue() : '' };
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
  ]);

  return withLock_(() => {
    const log = sheet_(SHEET.LOG);
    const start = log.getLastRow() + 1;
    log.getRange(start, 2, rows.length, 1).setNumberFormat('@');
    log.getRange(start, 4, rows.length, 1).setNumberFormat('@');
    log.getRange(start, 1, rows.length, rows[0].length).setValues(rows);

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
    const nickById = {};
    const users = sheet_(SHEET.USERS);
    if (users.getLastRow() > 1) {
      users.getRange(2, 1, users.getLastRow() - 1, 2).getValues()
        .forEach(r => { nickById[String(r[0])] = r[1]; });
    }
    const tz = Session.getScriptTimeZone();
    ranking = h.getRange(2, 1, last - 1, 4).getValues()
      .filter(r => r[0] instanceof Date)
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

/* ================= 先生用メニュー ================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('英単語図鑑')
    .addItem('初期セットアップ', 'setupFromMenu')
    .addSeparator()
    .addItem('選択中の生徒のパスワードをリセット', 'resetPasswordForSelectedUser')
    .addItem('期限切れのログイン情報を削除', 'cleanupSessions')
    .addSeparator()
    .addItem('管理者キーを設定・変更', 'setAdminKey')
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

  // 内部用シートは隠す（パスワードのハッシュ・トークン・進捗の生データ）
  [SHEET.SESSIONS, SHEET.PROGRESS].forEach(n => sheet_(n).hideSheet());
  sheet_(SHEET.DAILY).getRange('A:A').setNumberFormat('yyyy/mm/dd');
  sheet_(SHEET.HOF).getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  sheet_(SHEET.LOG).getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm:ss');

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
