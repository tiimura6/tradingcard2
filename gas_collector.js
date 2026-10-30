/**
 * ハイレベル英単語図鑑 — 学習データ収集スクリプト
 * Google Apps Script に貼り付けてデプロイしてください。
 */

const SHEET_NAME = '学習ログ';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);

    // シートがなければ作成してヘッダーを追加
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'タイムスタンプ',
        'ユーザーID',
        'セッションID',
        'イベント種別',   // gacha / training / challenge / unlock
        'カードNo',
        '英単語',
        '日本語意味',
        'レベル',
        '正誤',          // correct / incorrect / -
        '回答時間(秒)',
        'タブ番号',
        '取得済みカード枚数',
        '連続正解数',
      ]);
      // ヘッダー行を固定・太字
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 13).setFontWeight('bold');
    }

    // 行を追加
    sheet.appendRow([
      new Date(data.timestamp || Date.now()),
      data.userId        || '',
      data.sessionId     || '',
      data.eventType     || '',
      data.cardNo        || '',
      data.word          || '',
      data.meaning       || '',
      data.level         || '',
      data.isCorrect     !== undefined ? (data.isCorrect ? '正解' : '不正解') : '-',
      data.responseTime  || '',
      data.tabIndex      !== undefined ? data.tabIndex + 1 : '',
      data.totalUnlocked || '',
      data.combo         || '',
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// テスト用（GASエディタから直接実行して動作確認できる）
function testPost() {
  const dummy = {
    postData: {
      contents: JSON.stringify({
        timestamp:      Date.now(),
        userId:         'test-user-001',
        sessionId:      'sess-abc123',
        eventType:      'training',
        cardNo:         42,
        word:           'abundant',
        meaning:        '豊富な',
        level:          '2級',
        isCorrect:      true,
        responseTime:   3.2,
        tabIndex:       0,
        totalUnlocked:  15,
        combo:          3,
      })
    }
  };
  const result = doPost(dummy);
  Logger.log(result.getContent());
}
