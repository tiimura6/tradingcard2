// Google Apps Script の最小モック（Code.gs をローカルで動かす）
const fs = require('fs'), crypto = require('crypto'), vm = require('vm');
function makeEnv() {
  const sheets = {};
  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
    _cell(i, j) { const row = this.sh.data[this.r - 1 + i] || []; return row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]; }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const a = []; for (let j = 0; j < this.nc; j++) a.push(this._cell(i, j)); o.push(a); } return o; }
    getValue() { return this._cell(0, 0); }
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { const R = this.r - 1 + i; while (this.sh.data.length <= R) this.sh.data.push([]); this.sh.data[R][this.c - 1 + j] = x; })); return this; }
    setValue(x) { return this.setValues([[x]]); }
    setFormulaR1C1(f) { return this.setValue('=F:' + f); }
    clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sh.data[this.r - 1 + i]; if (row) row[this.c - 1 + j] = ''; } return this; }
    getRow() { return this.r; }
    createTextFinder(t) { const self = this; let ent = false; return { matchEntireCell(b) { ent = b; return this; }, matchCase() { return this; },
      findNext() { for (let i = 0; i < self.nr; i++) for (let j = 0; j < self.nc; j++) { const v = String(self._cell(i, j)); if (ent ? v === t : v.includes(t)) return new Range(self.sh, self.r + i, self.c + j); } return null; } }; }
    createFilter() { this.sh.filter = true; return this; }
  }
  const noop = function () { return this; };
  ['setNumberFormat','setBackground','setFontColor','setFontWeight','setWrap','setVerticalAlignment'].forEach(m => Range.prototype[m] = noop);
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getName() { return this.name; }
    getRange(a, b, c, d) { if (typeof a === 'string') return new Range(this, 2, 1, 1000, 30); return new Range(this, a, b, c, d); }
    getLastRow() { let n = this.data.length; while (n > 0 && !(this.data[n - 1] || []).some(x => x !== '' && x !== undefined)) n--; return n; }
    getMaxRows() { return Math.max(1000, this.data.length); }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    getFilter() { return this.filter ? {} : null; }
    setFrozenRows() {} setFrozenColumns() {} setColumnWidths() {} setConditionalFormatRules() {} hideSheet() {}
  }
  const ss = {
    getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getSheets: () => Object.values(sheets),
    deleteSheet: s => { delete sheets[s.name]; }, setSpreadsheetTimeZone() {}, setActiveSheet() {}, moveActiveSheet() {},
    getActiveSheet: () => Object.values(sheets)[0], getActiveRange: () => null,
  };
  const rule = () => { const o = {}; ['whenNumberGreaterThanOrEqualTo','whenNumberLessThan','whenFormulaSatisfied','whenTextEqualTo','setBackground','setFontColor','setRanges','setBold'].forEach(m => o[m] = () => o); o.build = () => ({}); return o; };
  const cache = {};
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newConditionalFormatRule: rule, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (d, tz, f) => { const z = new Date(d.getTime() + 9 * 3600000); const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', z.getUTCFullYear()).replace('MM', p(z.getUTCMonth() + 1)).replace('dd', p(z.getUTCDate())).replace('hh', p(z.getUTCHours())).replace('mm', p(z.getUTCMinutes())); },
      computeDigest: (a, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }, sleep() {} },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    ContentService: { createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }), MimeType: { JSON: 'json' } },
    Logger: { log: (...a) => console.log('[Logger]', ...a) }, console, Date, JSON, Math, String, Number, Array, Object, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx);
  return { ctx, sheets };
}
module.exports = { makeEnv };
