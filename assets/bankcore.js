/* NSBank: bank reconciliation for bank-reco.niveshsahayak.in. Pure functions, no screen.
   statement(rows): a bank statement read from CSV or Excel (rows = arrays of cells) -> { map, lines: [{ i, date, desc, ref, dr, cr, bal }] }
     dr = withdrawal (money out of the bank), cr = deposit (money in); dates come back as yyyy-mm-dd, day first as Indian banks print them.
   bookLines(docs, biz, from, to, acct): the business's bank side from the saved records (NSBooks): every line posted to the bank account
     acct ('bank' = the default bank, or 'bank:<name>' when the business has several banks) in the period
     (a cleared cheque on the day it cleared) plus cheques deposited or issued and not cleared yet, whatever their date.
   match(lines, book, opts): pairs a statement line with a book line of the same amount and direction; same cheque or reference
     number first, then the nearest date within opts.days (default 10). opts.keep = [[lineIndex, bookId]] pairs made by hand, opts.no = pairs the user undid.
   brs(...): the reconciliation statement: balance as per books, items not in the bank yet, items not in the books yet,
     the balance the bank should show, and the difference from the balance it does show. */
(function (G) {
  'use strict';
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).trim(), neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bdr\.?$/i.test(s);
    s = s.replace(/[^0-9.]/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? (neg && !/\bcr\.?$/i.test(String(v)) ? -n : n) : 0;
  }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function key(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ok(y, m, d) {
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return '';
    var t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 ? y + '-' + pad(m) + '-' + pad(d) : '';
  }
  /* '05/04/2026', '05-04-26', '05.04.2026', '5 Apr 2026', '05-Apr-26', '2026-04-05', an Excel day number, or a Date */
  function date(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) { var x = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return x.toISOString().slice(0, 10); }
    var s = String(v == null ? '' : v).trim(), m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ok(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})\b/))) return ok(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})[-\/. ]?([A-Za-z]{3,4})[a-z]*[-\/. ,]*(\d{2,4})\b/))) return MON[m[2].toLowerCase()] ? ok(+m[3], MON[m[2].toLowerCase()], +m[1]) : '';
    if ((m = s.match(/^([A-Za-z]{3,4})[a-z]*[ -](\d{1,2}),?[ -](\d{2,4})\b/))) return MON[m[1].toLowerCase()] ? ok(+m[3], MON[m[1].toLowerCase()], +m[2]) : '';
    return '';
  }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

  /* which column is which, from the header row of the statement */
  var HEAD = [
    ['type', /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn type|dr cr|d\/c|c\/d)$/i],
    ['date', /^(txn|tran|transaction|trans|posting|post|value|book)?\.?\s*(date|dt)\b/i],
    ['desc', /narration|description|particulars|details|remarks|transaction details/i],
    ['ref', /(chq|cheque|check)|ref|utr|instrument/i],
    ['dr', /withdraw|debit|^dr\.?\b|paid out|amount out|money out/i],
    ['cr', /deposit|credit|^cr\.?\b|paid in|amount in|money in/i],
    ['amt', /^(txn\s*|transaction\s*)?amount/i],
    ['bal', /balance/i]
  ];
  function findHeader(rows) {
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      var cells = (rows[r] || []).map(function (c) { return String(c == null ? '' : c).trim(); }), map = {};
      cells.forEach(function (c, i) {
        if (!c) return;
        for (var h = 0; h < HEAD.length; h++) {
          var k = HEAD[h][0];
          if (HEAD[h][1].test(c)) {
            if (k === 'date' && map.date != null && /value/i.test(c)) break;   /* keep the transaction date, not the value date */
            if (k === 'date' && map.date != null && map._v === map.date && !/post/i.test(c)) { map.date = i; break; }   /* ICICI prints Value Date first */
            if (k === 'date' && map.date == null && /value/i.test(c)) map._v = i;
            if (map[k] == null) map[k] = i;
            break;
          }
        }
      });
      delete map._v;
      if (map.date != null && (map.dr != null || map.cr != null || map.amt != null)) return { row: r, map: map };
    }
    return null;
  }
  /* no header found: guess from the data (first date column, last two number columns before a balance) */
  function guess(rows) {
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      var c = rows[r] || [], di = -1, nums = [];
      c.forEach(function (v, i) { if (di < 0 && date(v)) di = i; else if (di >= 0 && v !== '' && v != null && /^[\s(₹Rs.\-]*[\d,]+(\.\d+)?\)?\s*(cr|dr)?\.?$/i.test(String(v))) nums.push(i); });
      if (di >= 0 && nums.length >= 2) {
        var map = { date: di, desc: di + 1 < (nums[0] || 0) ? di + 1 : null };
        if (nums.length >= 3) { map.dr = nums[nums.length - 3]; map.cr = nums[nums.length - 2]; map.bal = nums[nums.length - 1]; }
        else { map.amt = nums[0]; map.bal = nums[1]; }
        return { row: r - 1, map: map, guessed: true };
      }
    }
    return null;
  }
  function statement(rows, map, from) {
    rows = (rows || []).filter(function (r) { return r && r.some(function (c) { return String(c == null ? '' : c).trim(); }); });
    var h = map ? { row: from == null ? -1 : from, map: map } : findHeader(rows) || guess(rows);
    if (!h) return { map: null, lines: [] };
    var M = h.map, lines = [];
    function cell(r, k) { return M[k] == null ? '' : r[M[k]]; }
    for (var i = h.row + 1; i < rows.length; i++) {
      var r = rows[i], d = date(cell(r, 'date'));
      if (!d) continue;
      var dr = 0, cr = 0;
      if (M.dr != null || M.cr != null) { dr = Math.abs(num(cell(r, 'dr'))); cr = Math.abs(num(cell(r, 'cr'))); }
      else {
        var a = num(cell(r, 'amt')), tp = String(cell(r, 'type') || '') + ' ' + String(cell(r, 'amt') || '');
        if (/\bcr\b|credit|deposit/i.test(tp)) cr = Math.abs(a); else if (/\bdr\b|debit|withdraw/i.test(tp)) dr = Math.abs(a); else if (a < 0) dr = -a; else cr = a;
      }
      if (!dr && !cr) continue;
      var bal = M.bal == null || cell(r, 'bal') === '' || cell(r, 'bal') == null ? null : num(cell(r, 'bal'));
      lines.push({ i: lines.length, date: d, desc: String(cell(r, 'desc') || '').replace(/\s+/g, ' ').trim(), ref: String(cell(r, 'ref') || '').trim(), dr: r2(dr), cr: r2(cr), bal: bal == null ? null : r2(bal) });
    }
    /* dates far from the rest (more than two years from the middle one) are totals or balances read as Excel day numbers */
    if (lines.length > 3) { var ds = lines.map(function (l) { return l.date; }).sort(), mid = ds[ds.length >> 1];
      lines = lines.filter(function (l) { return Math.abs(days(mid, l.date)) <= 730; }); lines.forEach(function (l, j) { l.i = j; }); }
    return { map: M, header: h.row, guessed: !!h.guessed, lines: lines };
  }
  /* CSV text -> rows (quotes, commas, semicolons or tabs) */
  function csvRows(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/).slice(0, 20).join('\n'), sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === sep) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  /* cheque or reference numbers in a line of text (5 to 12 digits) */
  function refs(s) { return (String(s || '').match(/\d{5,12}/g) || []).map(function (x) { return x.replace(/^0+/, ''); }); }

  /* the bank side of the books */
  function bookLines(docs, biz, from, to, acct) {
    var B = G.NSBooks || (typeof NSBooks !== 'undefined' ? NSBooks : null), out = [];
    acct = B.isBank && B.isBank(acct) ? acct : 'bank';
    B.book(docs, biz, acct, from, to).rows.forEach(function (r) {
      var d = r.d;
      out.push({ id: d.id, date: r.date, inn: r.dr, out: r.cr, d: d, chq: d.chq && d.mode === 'cheque' ? d.chq.no || d.ref || '' : '', ref: d.ref || '' });
    });
    /* cheques sent to the bank but not cleared, and cheques we gave that the payee has not cashed yet */
    B.inBooks(docs, biz).forEach(function (d) {
      if (d.mode !== 'cheque' || !d.chq || (d.chq.st !== 'dep' && d.chq.st !== 'iss') || to && d.date > to) return;
      if (B.bankOf && B.bankOf(d) !== acct) return;   /* a cheque paid into / drawn on another of the business's banks */
      var a = d.chq.st === 'dep' ? 'chq-in' : 'chq-out', dr = 0, cr = 0;
      B.postings(d).forEach(function (l) { if (l.a === a) { dr += l.dr; cr += l.cr; } });
      if (dr || cr) out.push({ id: d.id, date: d.date, inn: r2(dr), out: r2(cr), d: d, pending: d.chq.st, chq: d.chq.no || d.ref || '', ref: d.ref || '' });
    });
    return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /* balance as per books on a date, the way a cash book's bank column shows it: the bank account, plus cheques deposited
     and not cleared yet, less cheques issued and not cashed yet */
  function bookBalance(docs, biz, to, acct) {
    var B = G.NSBooks || (typeof NSBooks !== 'undefined' ? NSBooks : null); acct = B.isBank && B.isBank(acct) ? acct : 'bank';
    var bal = B.book(docs, biz, acct, null, to).close;
    bookLines(docs, biz, to, to, acct).forEach(function (b) { if (b.pending) bal += b.inn - b.out; });
    return r2(bal);
  }

  function match(lines, book, opts) {
    opts = opts || {};
    var tol = opts.days == null ? 10 : opts.days, pairs = {}, usedL = {}, usedB = {}, no = {};
    (opts.no || []).forEach(function (p) { no[p[0] + '|' + p[1]] = 1; });   /* pairs the user undid */
    (opts.keep || []).forEach(function (p) {
      var l = lines[p[0]], b = book.filter(function (x) { return x.id === p[1]; })[0];
      if (l && b && !usedL[l.i] && !usedB[b.id]) { pairs[l.i] = b.id; usedL[l.i] = 1; usedB[b.id] = 1; }
    });
    var cand = [];
    lines.forEach(function (l) {
      if (usedL[l.i]) return;
      var amt = l.cr || l.dr, lr = refs(l.ref + ' ' + l.desc);
      book.forEach(function (b) {
        if (usedB[b.id] || no[l.i + '|' + b.id]) return;
        var bamt = l.cr ? b.inn : b.out;
        if (Math.abs(bamt - amt) > 0.005) return;
        var gap = days(b.date, l.date);
        if (gap < -3 || gap > tol + (b.pending ? 50 : 0)) return;   /* the bank shows it on or after the book date; a pending cheque can take longer */
        var br = refs(b.chq + ' ' + b.ref), same = lr.some(function (x) { return br.indexOf(x) >= 0; });
        cand.push({ l: l.i, b: b.id, s: (same ? 0 : 1000) + Math.abs(gap) });
      });
    });
    cand.sort(function (a, b) { return a.s - b.s; }).forEach(function (c) {
      if (usedL[c.l] || usedB[c.b]) return;
      pairs[c.l] = c.b; usedL[c.l] = 1; usedB[c.b] = 1;
    });
    return {
      pairs: pairs,
      onlyBank: lines.filter(function (l) { return !usedL[l.i]; }),
      onlyBook: book.filter(function (b) { return !usedB[b.id]; })
    };
  }

  /* reconciliation statement on the last day of the period */
  function brs(bookBal, M, bankBal) {
    function sum(a, f) { return r2(a.reduce(function (s, x) { return s + f(x); }, 0)); }
    var issued = sum(M.onlyBook, function (b) { return b.out; }), deposited = sum(M.onlyBook, function (b) { return b.inn; });
    var credits = sum(M.onlyBank, function (l) { return l.cr; }), debits = sum(M.onlyBank, function (l) { return l.dr; });
    var shouldBe = r2(bookBal + issued - deposited + credits - debits);
    return { book: r2(bookBal), issued: issued, deposited: deposited, credits: credits, debits: debits, shouldBe: shouldBe,
      bank: bankBal == null || bankBal === '' ? null : r2(num(bankBal)), diff: bankBal == null || bankBal === '' ? null : r2(num(bankBal) - shouldBe) };
  }


  /* ---------- PDF statements: the words PDF.js gives, put back into a table ----------
     pdfLines(items): the text pieces of one page ({ str, transform, width, height }) as lines [{ y, items: [{ x, x2, s }] }], top first.
     pdfTable(pages): the lines of every page -> rows of cells, the heading row first. Bank PDFs wrap every cell over two or three
     lines (ICICI prints "01/Apr/20" over "26" and "3,16,166." over "00"), and the heading itself can take three lines ("Withdra" /
     "wal (Dr)"); a record starts on the line whose date column holds a date, and the lines just under it are joined to its cells.
     A piece that fills its column to the edge was cut in the middle of a word, so it is joined without a space. */
  function pdfLines(items) {
    var L = [];
    (items || []).forEach(function (it) {
      var s = String(it.str || '').replace(/\s+/g, ' '); if (!s.trim()) return;
      var x = it.transform[4], y = it.transform[5], w = it.width || s.length * 4, h = Math.abs(it.transform[3]) || it.height || 8;
      var line = null; for (var j = 0; j < L.length; j++) if (Math.abs(L[j].y - y) <= Math.max(2, h * 0.3)) { line = L[j]; break; }
      if (!line) { line = { y: y, h: h, items: [] }; L.push(line); }
      var lead = s.length - s.replace(/^\s+/, '').length, st = s.trim();
      if (line.items.some(function (o) { return o.s === st && Math.abs(o.x0 - x) < 1.5; })) return;   /* drawn twice to look bold */
      line.items.push({ x0: x, x: x + (lead && s.length ? w * lead / s.length : 0), x2: x + w, s: st });
    });
    L.forEach(function (l) {
      l.items.sort(function (a, b) { return a.x - b.x; });
      var m = []; l.items.forEach(function (it) { var p = m[m.length - 1]; if (p && it.x - p.x2 < 2.2) { p.s += (it.x - p.x2 > 0.6 ? ' ' : '') + it.s; p.x2 = Math.max(p.x2, it.x2); } else m.push({ x: it.x, x2: it.x2, s: it.s }); });
      l.items = m;
    });
    return L.sort(function (a, b) { return b.y - a.y; });
  }
  var HEADW = /^(sl|s\.?\s?no|tran|txn|date|value|transaction|posting|narration|particulars|description|details|remarks|chq|cheque|ref|withdra|debit|deposit|credit|balance|amount|dr|cr)/i;
  var DSTART = /^\d{1,2}[\/\-. ]([A-Za-z]{3}|\d{1,2})([\/\-. ]|$)/, MONEY = /\d[\d,]*\.\d{2}\b/;
  function lineText(ls) { return ls.map(function (l) { return l.items.map(function (i) { return i.s; }).join(' | '); }).join(' | ').toLowerCase(); }
  function looksHead(ls) {
    var t = lineText(ls), n = 0; ls.forEach(function (l) { l.items.forEach(function (i) { if (HEADW.test(i.s)) n++; }); });
    return /date/.test(t) && /(balance|withdra|debit|deposit|credit)/.test(t) && n >= 3 && !ls.some(function (l) { return l.items.some(function (i) { return MONEY.test(i.s); }); });
  }
  /* the heading at lines[i], taking up to three lines close together; returns how many lines it takes (0 = not a heading) */
  function headAt(all, i) {
    for (var n = 1; n <= 3 && i + n <= all.length; n++) {
      var ls = all.slice(i, i + n);
      if (n > 1 && (ls[n - 1].page !== ls[0].page || ls[n - 2].y - ls[n - 1].y > Math.max(14, ls[n - 2].h * 2))) return 0;
      if (looksHead(ls) && ls[0].items.filter(function (it) { return HEADW.test(it.s); }).length >= 2) {
        /* a last heading word on a line of its own ("Date" under "Transaction Posted") */
        while (i + n < all.length && all[i + n].page === ls[0].page && all[i + n - 1].y - all[i + n].y <= Math.max(10, all[i + n - 1].h * 1.6) &&
          all[i + n].items.length <= 4 && !all[i + n].items.some(function (it) { return DSTART.test(it.s) || MONEY.test(it.s); })) n++;
        return n;
      }
    }
    return 0;
  }
  var WORDS = /^(pvt|private|ltd|limited|llp|co|company|corp|industries|industry|traders|trading|enterprises|steels?|works|stores?|agencies|sons|brothers|bros|and|&)\b/i;
  function joinPiece(a, b, full, lastLine) {
    if (!a) return b; if (!b) return a;
    if (/^\d{1,2}:\d{2}/.test(b)) return a + ' ' + b;   /* a time under a date */
    if (/^\d/.test(b) && date(a + b) && !date(a + ' ' + b)) return a + b;   /* a date cut in the middle: "12 Jun 202" / "6" */
    if (/[\/\-:.,]$/.test(a) || /^[.,\/:]/.test(b)) return a + b;
    if (full && !/\s/.test(lastLine == null ? a : lastLine) && !(/[A-Za-z]$/.test(a) && WORDS.test(b))) return a + b;
    if (/\d$/.test(a) && /^\d/.test(b) && /^[\d,.\/\-]+$/.test(a)) return a + b;
    return a + ' ' + b;
  }
  function pdfGrid(pages) {
    var all = []; (pages || []).forEach(function (ls, p) { ls.forEach(function (l) { l.page = p; all.push(l); }); });
    var hi = -1, hn = 0;
    for (var i = 0; i < all.length && hi < 0; i++) { var n = headAt(all, i); if (n) { hi = i; hn = n; } }
    if (hi < 0) return all.map(function (l) { return l.items.map(function (it) { return it.s; }); });   /* no heading: cells by gaps, the user picks columns */
    /* columns from the heading: the first line gives the columns, words on the lines under it join the column above them */
    var cols = []; all[hi].items.forEach(function (it) { var p = cols[cols.length - 1];
      if (p && !HEADW.test(it.s) && it.x - p.x2 < Math.max(12, all[hi].h * 2)) { p.s += ' ' + it.s; p.x2 = it.x2; return; }
      cols.push({ x: it.x, x2: it.x2, s: it.s }); });
    for (var k = 1; k < hn; k++) all[hi + k].items.forEach(function (it) {
      var c = nearCol(cols, it), m = (it.x + it.x2) / 2;
      if (Math.abs(m - (c.x + c.x2) / 2) > Math.max(30, (c.x2 - c.x))) { cols.push({ x: it.x, x2: it.x2, s: it.s }); cols.sort(function (a, b) { return a.x - b.x; }); return; }
      c.s += /[a-z]$/.test(c.s) && /^[a-z]/.test(it.s) ? it.s : ' ' + it.s; c.x = Math.min(c.x, it.x); c.x2 = Math.max(c.x2, it.x2);
    });
    var names = cols.map(function (c) { return c.s; }), dateCol = names.findIndex(function (s) { return /date/i.test(s); });
    if (dateCol < 0) dateCol = 0;
    /* body lines: a heading printed again on later pages is skipped; footers and totals are lines that start no record and sit apart */
    var body = [];
    for (var j = hi + hn; j < all.length; j++) { var hn2 = headAt(all, j); if (hn2) { j += hn2 - 1; continue; } body.push(all[j]); }
    /* columns as wide as their data: a cell's text often starts left of its heading word, and a short last piece ("L/") must still land in it */
    body.forEach(function (l) { if (!l.items.some(function (it) { return nearCol(cols, it) === cols[dateCol] && DSTART.test(it.s); })) return; l.items.forEach(function (it) { if (it.x2 - it.x < 14) return; var c = nearCol(cols, it); if (!c.d) c.d = { x: it.x, x2: it.x2 }; else { c.d.x = Math.min(c.d.x, it.x); c.d.x2 = Math.max(c.d.x2, it.x2); } }); });
    cols.forEach(function (c) { if (c.d) { c.x = Math.min(c.x, c.d.x); c.x2 = Math.max(c.x2, c.d.x2); } });
    var cells = body.map(function (l) { var row = cols.map(function () { return []; }); l.items.forEach(function (it) { row[cols.indexOf(nearCol(cols, it))].push(it); }); return row; });
    /* which lines belong to a record: the line that starts it (a date in the date column) and the lines just under it */
    var own = [], last = null;
    body.forEach(function (l, b) {
      if (DSTART.test(cells[b][dateCol].map(function (it) { return it.s; }).join(' '))) { own[b] = 's'; last = l; return; }
      if (last && l.page === last.page && last.y - l.y <= Math.max(9.5, last.h * 1.45)) { own[b] = 'c'; last = l; } else last = null;   /* else a page line, a total, a legend */
    });
    var right = cols.map(function () { return -1e9; });
    cells.forEach(function (row, b) { if (own[b]) row.forEach(function (its, c) { its.forEach(function (it) { if (it.x2 > right[c]) right[c] = it.x2; }); }); });
    var out = [names], cur = null;
    function put(row, add) {
      row.forEach(function (its, c) {
        if (!its.length) return;
        var txt = its.map(function (it) { return it.s; }).join(' ');
        if (!add) { cur[c] = txt; cur._e[c] = its[its.length - 1].x2; cur._t[c] = txt; return; }
        cur[c] = joinPiece(cur[c], txt, cur._e[c] != null && cur._e[c] >= right[c] - 5, cur._t[c]); cur._e[c] = its[its.length - 1].x2; cur._t[c] = txt;
      });
    }
    cells.forEach(function (row, b) {
      if (own[b] === 's') { cur = names.map(function () { return ''; }); cur._e = {}; cur._t = {}; put(row); out.push(cur); }
      else if (own[b] === 'c' && cur) put(row, true);
    });
    out.forEach(function (r) { delete r._e; delete r._t; });
    return out;
  }

  /* Some statements are printed like a typed report: the figures do not sit under their headings, the date is part of the
     narration. Read line by line instead: a line starting with a date and ending in amounts is a record, the last amount is
     the balance, and the rise or fall of the balance says whether the other amount came in or went out. Lines without a date
     and without amounts just under a record continue its narration. */
  var LDATE = /^(\d{1,2}[\/\-. ](?:[A-Za-z]{3,9}|\d{1,2})[\/\-. ]\d{2,4})\s*(.*)$/, AMT = /^\(?-?[\d,]+\.\d{2}\)?(\s*(cr|dr)\.?)?$/i;
  function pdfLinesMode(pages) {
    var out = [['Date', 'Details', 'Withdrawal', 'Deposit', 'Balance']], prev = null, cur = null, lastY = null, lastP = null;
    function sval(t) { var v = num(t); return /dr\.?$/i.test(t) ? -Math.abs(v) : v; }
    (pages || []).forEach(function (ls, p) {
      ls.forEach(function (l) {
        var words = l.items.map(function (i) { return i.s; }).join('  ').split(/\s{2,}|\s(?=\(?-?[\d,]+\.\d{2}\b)/).map(function (w) { return w.trim(); }).filter(Boolean);
        var m = LDATE.exec(words.join('  ')), amts = [];
        while (words.length && AMT.test(words[words.length - 1])) amts.unshift(words.pop());
        if (m && amts.length) {
          var desc = words.join(' ').replace(LDATE, '$2').trim(), bal = sval(amts[amts.length - 1]);
          if (amts.length === 1) { prev = bal; cur = null; return; }   /* opening balance: only a balance on the line */
          var amt = Math.abs(num(amts[amts.length - 2])), dr = '', cr = '';
          if (prev != null && Math.abs(prev - amt - bal) < 0.02) dr = amts[amts.length - 2];
          else if (prev != null && Math.abs(prev + amt - bal) < 0.02) cr = amts[amts.length - 2];
          else if (amts.length >= 3) { dr = num(amts[0]) ? amts[0] : ''; cr = num(amts[1]) ? amts[1] : ''; }
          else if (prev == null && /\b(cr|credit|deposit|by)\b/i.test(desc)) cr = amts[0]; else dr = amts[0];
          cur = [m[1], desc, dr, cr, amts[amts.length - 1]]; out.push(cur); prev = bal; lastY = l.y; lastP = p; return;
        }
        if (cur && !amts.length && !m && p === lastP && lastY - l.y <= Math.max(16, l.h * 2) && !/^-{5,}|^page\b|balance|total/i.test(words.join(' '))) { cur[1] = (cur[1] + ' ' + words.join(' ')).trim(); lastY = l.y; return; }
        cur = null;
      });
    });
    return out;
  }
  /* how well a reading holds together: lines found, and how many follow from the balance before them */
  function chain(rows) {
    var L = statement(rows).lines, ok = 0;
    for (var i = 1; i < L.length; i++) { var a = L[i - 1], b = L[i]; if (a.bal == null || b.bal == null) continue; if (Math.abs(a.bal + b.cr - b.dr - b.bal) < 0.02 || Math.abs(a.bal - b.cr + b.dr - b.bal) < 0.02 || Math.abs(b.bal + a.cr - a.dr - a.bal) < 0.02) ok++; }
    return { n: L.length, ok: ok };
  }
  function pdfTable(pages) {
    var g = pdfGrid(pages), a = chain(g);
    if (a.n && a.ok >= a.n - 1) return g;
    var t = pdfLinesMode(pages), b = chain(t);
    return b.ok > a.ok || (!a.n && b.n) ? t : g;
  }
  function nearCol(cols, it) {
    var m = (it.x + it.x2) / 2, best = cols[0], d = 1e9;
    cols.forEach(function (c) { var dd = it.x2 >= c.x - 1 && it.x <= c.x2 + 1 ? Math.abs(m - (c.x + c.x2) / 2) / 1000 : 1 + Math.min(Math.abs(m - (c.x + c.x2) / 2), Math.abs(it.x - c.x), Math.abs(it.x2 - c.x2)); if (dd < d) { d = dd; best = c; } });
    return best;
  }
  var API = { num: num, r2: r2, key: key, date: date, days: days, csvRows: csvRows, findHeader: findHeader, statement: statement, refs: refs, bookLines: bookLines, bookBalance: bookBalance, match: match, brs: brs, pdfLines: pdfLines, pdfTable: pdfTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.NSBank = API;
})(this);
