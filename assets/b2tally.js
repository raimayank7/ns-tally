/* tally.niveshsahayak.in, "Bank statement to Tally" (byof3-bank2tally, 28 Nov 2026): drop a bank statement (PDF, Excel or CSV of any
   Indian bank) and, if you like, your Tally ledger list (masters XML or an Excel list); pick the bank ledger and a ledger for each line
   (filled in from the names in the narration and from your earlier choices, which this browser remembers by payee); download the Tally
   import XML of Receipt, Payment and Contra vouchers (+ the new ledgers). Everything stays in the browser.
   Working: b2tcore.js (NSB2T). Reading: bankcore.js (NSBank.statement / csvRows), bankpdf.js (NSBankPdf.rows), tallyin.js (masters),
   SheetJS (engine/vendor). Payees and remembered choices: bankimport.js (NSBI). XML: xltcore.js (NSXlTally).
   Screen words: NS.t('b2t.*') (and the row-check words xt.p.* of the Excel to Tally box), English only for now (owner, 28 Nov).
   Kept on this device (localStorage): ns-b2t-rules (ledger per payee), ns-b2t-led (groups of ledgers you made), ns-b2t-done (lines
   already in a downloaded file), ns-b2t-set (bank and cash ledger names, narration choice), ns-b2t-cols (column layouts of statements).
   Designed & Developed by: Nivesh Sahayak (https://www.niveshsahayak.in/) */
(function () {
  'use strict';
  var NS = window.NS, B = window.NSB2T, K = window.NSBank, X = window.NSXlTally, TI = window.NSTallyIn, BI = window.NSBI;
  if (!NS || !B || !K || !X || !BI) return;
  var root = document.getElementById('b2t');
  if (!root) return;
  var esc = NS.esc, t = function (k, v) { return NS.t('b2t.' + k, v); };
  var XLJS = '/assets/vendor/xlsx-0.20.3.full.min.js', PER = 100;
  var RK = 'ns-b2t-rules', LK = 'ns-b2t-led', DK = 'ns-b2t-done', SK = 'ns-b2t-set', CK = 'ns-b2t-cols';
  function ls(k, d) { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } }
  function lsPut(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function key(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function m(v) { return NS.money ? NS.money(v, false) : String(v); }
  function d(s) { return s ? (NS.fmtDate ? NS.fmtDate(s) : s) : ''; }
  var SET = Object.assign({ bank: '', cash: 'Cash', narr: 'bank' }, ls(SK, {}));
  var ST = fresh();
  function fresh() { return { st: [], T: null, tname: '', lines: [], keys: [], sug: [], picks: [], set: {}, use: {}, info: ls(LK, {}), rules: ls(RK, []), page: 0, show: 'all', q: '', cols: -1, R: null }; }
  var out = root.querySelector('#b2t-out'), file = root.querySelector('#b2t-file'), drop = root.querySelector('.b2t-drop');

  /* ---------- reading the files ---------- */
  function clean(rows) { return (rows || []).map(function (r) { return (r || []).map(function (c) { return c == null ? '' : String(c).trim(); }); }).filter(function (r) { return r.some(Boolean); }); }
  function sheets(f) {
    var csv = /\.(csv|txt)$/i.test(f.name);
    return (csv ? f.text().then(function (txt) { return [{ name: f.name, rows: K.csvRows(txt) }]; }) : NS.loadJs(XLJS, '').then(function () { return f.arrayBuffer(); }).then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
      return wb.SheetNames.map(function (n) { return { name: wb.SheetNames.length > 1 ? f.name + ' · ' + n : f.name, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }; });
    }, function () { return NS.loadLazy(['xlsx.js']).then(function () { return NS.xlsx.read(f, { keepEmpty: true }); }).then(function (rows) { return [{ name: f.name, rows: rows }]; }); }));
  }
  function readOne(f) {
    var name = f.name || 'file';
    if (/\.pdf$/i.test(name)) {
      if (!window.NSBankPdf) return Promise.resolve([{ kind: 'bad', name: name, why: t('nopdf') }]);
      return NSBankPdf.rows(f, { page: function (n, tot) { busy(t('pdfpage', { a: n, b: tot })); } }).then(function (rows) { return [stmt(name, clean(rows))]; });
    }
    return f.slice(0, 4000).arrayBuffer().then(function (hb) {
      var head = TI ? TI.decode(hb) : new TextDecoder().decode(hb);
      if (/\.xml$/i.test(name) || /<ENVELOPE|<TALLYMESSAGE/i.test(head)) {
        if (!TI) throw new Error('tally');
        return f.arrayBuffer().then(function (b) { var T = X.tallyMasters(TI.collect([new Uint8Array(b)])); return [{ kind: 'tally', name: name, T: T, n: Object.keys(T.ledgers).length }]; });
      }
      return sheets(f).then(function (S) {
        return S.map(function (s) {
          var rows = clean(s.rows), st = stmt(s.name, rows);
          if (st.lines.length) return st;
          var T = B.ledgerSheet(rows);
          if (T) return { kind: 'tally', name: s.name, T: T, n: Object.keys(T.ledgers).length, sheet: true };
          return st;   /* not read: offered the Columns box */
        });
      });
    });
  }
  /* a statement: lines from NSBank (a column layout set by hand for this heading row is remembered) */
  function stmt(name, rows, map, header) {
    if (!map) { var saved = ls(CK, {}), h = K.findHeader(rows); if (h) { var sg = sig(rows[h.row]); if (saved[sg]) { map = saved[sg]; header = h.row; } } }
    var S = K.statement(rows, map, header);
    var lines = S.lines.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i; });
    var first = S.header == null ? -1 : S.header, data = rows.length - first - 1;
    lines.forEach(function (l) { l.row = l.i + first + 2; });
    return { kind: 'stmt', name: name, rows: rows, map: S.map || {}, header: first, lines: lines, other: Math.max(0, data - S.lines.length), guessed: S.guessed };
  }
  function sig(r) { return (r || []).map(function (c) { return key(c); }).join('|'); }
  function busy(msg) { out.innerHTML = '<p class="soft" role="status">' + esc(msg) + '</p>'; }
  function take(files, keep) {
    files = [].slice.call(files || []); if (!files.length) return;
    busy(t('reading'));
    var all = keep ? ST.st.slice() : [], T = keep ? ST.T : null, tn = keep ? ST.tname : '';
    files.reduce(function (p, f) {
      return p.then(function () { return readOne(f).then(function (list) {
        list.forEach(function (s) { if (s.kind === 'tally') { if (s.n) { T = merge(T, s.T); tn = s.name; } all.push(s); } else all.push(s); });
      }, function (e) { if (e && e.message === 'cancel') return; all.push({ kind: 'bad', name: f.name, why: /\.pdf$/i.test(f.name) ? t('pdffail') : t('noread') }); }); });
    }, Promise.resolve()).then(function () {
      var info = ST.info, rules = ST.rules; ST = fresh(); ST.info = info; ST.rules = rules; ST.st = all; ST.T = T; ST.tname = tn;
      setTimeout(run, 0);
    });
  }
  function merge(a, b) { if (!a) return { ledgers: Object.assign({}, b.ledgers), groups: b.groups.slice(), company: b.company }; Object.assign(a.ledgers, b.ledgers); a.groups = a.groups.concat(b.groups); if (!a.company) a.company = b.company; return a; }

  /* ---------- working out ---------- */
  function led() { return B.ledgers(ST.T, ST.info); }
  function banks() { return B.banksOf(led()); }
  function bank() {
    var bs = banks();
    if (SET.bank && (!ST.T || bs.some(function (b) { return key(b) === key(SET.bank); }))) return SET.bank;
    return bs[0] || SET.bank || '';
  }
  function cash() { return ST.T ? B.cashOf(led()) : SET.cash || 'Cash'; }
  function run() {
    var L = [];
    ST.st.forEach(function (s) { if (s.kind === 'stmt') L = L.concat(s.lines.map(function (l) { return Object.assign({ file: s.name }, l); })); });
    L.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    ST.lines = L; ST.keys = BI.lineKeys(L);
    var done = ls(DK, {});
    ST.done = ST.keys.map(function (k) { return done[k] || ''; });
    suggestAll();
    draw();
  }
  function suggestAll() {
    var lg = led(), bk = bank();
    ST.sug = B.suggest(ST.lines, { led: lg, hasT: !!ST.T, bank: bk, cash: cash(), rules: ST.rules, keys: ST.keys });
    ST.lines.forEach(function (l, i) {
      if (ST.set[i]) return;
      var s = ST.sug[i]; ST.picks[i] = s.led;
      ST.use[i] = !!s.led && s.conf !== 'guess' && !ST.done[i];
    });
    ST.R = null;
  }
  function choose(i, name) {
    var l = ST.lines[i]; name = String(name || '').trim();
    ST.picks[i] = name; ST.set[i] = 1; ST.use[i] = !!name;
    if (name) {
      var lg = led(), k = key(name);
      if (!lg[k]) { ST.info[k] = { name: name, group: B.guessGroup(name, l.cr ? 'cr' : 'dr') }; lg = led(); }
      ST.rules = B.learn(ST.rules, [{ line: l, name: lg[k].name, k: kindOf(name, l) }]);
      lsPut(RK, ST.rules);
    }
    suggestAll();
  }
  function kindOf(name, l) { var L = led()[key(name)]; if (key(name) === key(cash())) return 'cash'; return L && L.k ? L.k : B.kindOfGroup(B.guessGroup(name, l.cr ? 'cr' : 'dr')); }
  function picksUsed() { return ST.lines.map(function (l, i) { return ST.use[i] ? ST.picks[i] : ''; }); }
  function result() {
    if (ST.R) return ST.R;
    var bk = bank(); if (!bk) return null;
    ST.R = B.make(ST.lines, picksUsed(), { bank: bk, cash: cash(), led: led(), hasT: !!ST.T, info: ST.info, fy: B.fyOf(ST.lines), narr: SET.narr });
    return ST.R;
  }

  /* ---------- the screen ---------- */
  function word(code, v) { var s = NS.t('xt.p.' + code, v || {}); return s === 'xt.p.' + code ? code : s; }
  function why(s) { return s && s.why ? NS.t('b2t.w.' + s.why) : ''; }
  function shown() {
    var q = key(ST.q);
    return ST.lines.map(function (l, i) { return i; }).filter(function (i) {
      var l = ST.lines[i], s = ST.sug[i] || {};
      if (q && (l.desc + ' ' + l.ref + ' ' + (ST.picks[i] || '') + ' ' + (l.dr || l.cr)).toLowerCase().indexOf(q) < 0) return false;
      if (ST.show === 'none') return !ST.picks[i];
      if (ST.show === 'check') return !!ST.picks[i] && !ST.use[i];
      if (ST.show === 'rule') return !ST.set[i] && s.conf === 'rule';
      if (ST.show === 'done') return !!ST.done[i];
      return true;
    });
  }
  function draw() {
    var h = '<h3 class="xt-st"><span>2</span><b>' + esc(t('s2')) + '</b></h3><div class="xt-files">';
    ST.st.forEach(function (s, i) {
      if (s.kind === 'bad') { h += '<div class="card xt-src"><b>' + esc(s.name) + '</b><p class="warn">' + esc(s.why) + '</p></div>'; return; }
      if (s.kind === 'tally') { h += '<div class="card xt-src"><b>' + esc(s.name) + '</b><p>' + esc(s.n ? t('ledread', { n: s.n, c: s.T.company || '—' }) : t('lednone')) + '</p></div>'; return; }
      var inn = 0, outm = 0; s.lines.forEach(function (l) { inn += l.cr; outm += l.dr; });
      h += '<div class="card xt-src"><b>' + esc(s.name) + '</b>' + (s.lines.length ?
        '<p>' + esc(t('stread', { n: s.lines.length, a: d(s.lines[0].date), b: d(s.lines[s.lines.length - 1].date) })) + '</p><p class="soft">' + esc(t('inout', { i: m(inn), o: m(outm) })) + '</p>' +
        (chain(s) ? '<p class="soft">' + esc(chain(s)) + '</p>' : '') +
        (s.other ? '<p class="soft">' + esc(t('skipped', { n: s.other })) + '</p>' : '') :
        '<p class="warn">' + esc(t('nolines')) + '</p>') +
        '<button type="button" class="btn sm" data-b2tcols="' + i + '">' + esc(t('cols')) + '</button>' + (ST.cols === i ? colsBox(s, i) : '') + '</div>';
    });
    h += '</div>';
    if (!ST.lines.length) { out.innerHTML = h + '<p class="warn">' + esc(t('nothing')) + '</p>'; return; }
    /* the bank and cash ledgers */
    var bs = banks(), bk = bank();
    h += '<div class="card b2t-bank"><div class="f"><label for="b2t-bank">' + esc(t('bankled')) + '</label>' +
      (ST.T && bs.length ? '<select id="b2t-bank">' + bs.map(function (b) { return '<option' + (key(b) === key(bk) ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select>'
        : '<input id="b2t-bank" value="' + esc(bk) + '" placeholder="' + esc(t('bankph')) + '" dir="auto">') + '</div>' +
      '<div class="f"><label for="b2t-cash">' + esc(t('cashled')) + '</label><input id="b2t-cash" value="' + esc(cash()) + '"' + (ST.T ? ' disabled' : '') + '></div>' +
      '<div class="f"><label for="b2t-narr">' + esc(t('narr')) + '</label><select id="b2t-narr"><option value="bank"' + (SET.narr !== 'none' ? ' selected' : '') + '>' + esc(t('narrbank')) + '</option><option value="none"' + (SET.narr === 'none' ? ' selected' : '') + '>' + esc(t('narrnone')) + '</option></select></div>' +
      (!bk ? '<p class="callout">' + esc(t('needbank')) + '</p>' : '') +
      '<div class="xt-tdrop"><label class="btn sm" for="b2t-mfile">' + esc(t('ledpick')) + '</label><input type="file" id="b2t-mfile" accept=".xml,.txt,.xlsx,.xls,.csv" hidden><span class="soft">' + esc(ST.T ? t('ledhave', { n: Object.keys(ST.T.ledgers).length, c: ST.T.company || '—' }) : t('ledhint')) + '</span></div></div>';
    /* step 3: a ledger for each line */
    var cnt = { n: ST.lines.length, use: 0, none: 0, rule: 0, done: 0 };
    ST.lines.forEach(function (l, i) { if (ST.use[i]) cnt.use++; if (!ST.picks[i]) cnt.none++; if (!ST.set[i] && ST.sug[i].conf === 'rule') cnt.rule++; if (ST.done[i]) cnt.done++; });
    h += '<h3 class="xt-st"><span>3</span><b>' + esc(t('s3')) + '</b></h3><p>' + esc(t('s3h')) + '</p>' +
      '<p><b>' + esc(t('count', cnt)) + '</b>' + (cnt.rule ? ' · ' + esc(t('remem', { n: cnt.rule })) : '') + (cnt.done ? ' · <span class="xt-e">' + esc(t('donebefore', { n: cnt.done })) + '</span>' : '') + '</p>';
    var S = shown(), pages = Math.max(1, Math.ceil(S.length / PER)); if (ST.page >= pages) ST.page = pages - 1;
    var pg = S.slice(ST.page * PER, ST.page * PER + PER), lg = led();
    var names = Object.keys(lg).filter(function (k) { return key(lg[k].name) !== key(bk); }).slice(0, 6000).map(function (k) { return lg[k].name; });
    h += '<div class="b2t-bar"><div class="f"><label for="b2t-show">' + esc(t('show')) + '</label><select id="b2t-show">' + ['all', 'none', 'check', 'rule', 'done'].map(function (v) { return '<option value="' + v + '"' + (ST.show === v ? ' selected' : '') + '>' + esc(t('sh.' + v)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="f"><label for="b2t-q">' + esc(t('find')) + '</label><input id="b2t-q" type="search" value="' + esc(ST.q) + '"></div>' +
      (cnt.none ? '<button type="button" class="btn sm" data-b2t="susp">' + esc(t('susp', { n: cnt.none })) + '</button>' : '') + '</div>' +
      '<datalist id="b2t-ll">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<div class="tbl b2t-tw"><table class="bk-t b2t-t"><thead><tr><th>' + esc(t('c.use')) + '</th><th>' + esc(t('c.date')) + '</th><th>' + esc(t('c.desc')) + '</th><th class="n">' + esc(t('c.out')) + '</th><th class="n">' + esc(t('c.in')) + '</th><th>' + esc(t('c.led')) + '</th></tr></thead><tbody>' +
      pg.map(function (i) {
        var l = ST.lines[i], s = ST.sug[i] || {}, p = ST.picks[i] || '', w = ST.set[i] ? t('w.mine') : why(s), cls = !p ? 'b2t-none' : s.conf === 'guess' && !ST.set[i] ? 'b2t-chk' : '';
        return '<tr class="' + cls + '"><td><input type="checkbox" data-b2tu="' + i + '"' + (ST.use[i] ? ' checked' : '') + (p ? '' : ' disabled') + ' aria-label="' + esc(t('c.use') + ' ' + d(l.date) + ' ' + m(l.cr || l.dr)) + '"></td>' +
          '<td>' + esc(d(l.date)) + '</td><td class="b2t-d">' + esc(l.desc) + (l.ref && l.desc.indexOf(l.ref) < 0 ? ' <small class="mono soft">' + esc(l.ref) + '</small>' : '') + (ST.done[i] ? ' <small class="xt-e">' + esc(t('donechip', { d: d(ST.done[i]) })) + '</small>' : '') + '</td>' +
          '<td class="n">' + (l.dr ? m(l.dr) : '') + '</td><td class="n">' + (l.cr ? m(l.cr) : '') + '</td>' +
          '<td><input data-b2tl="' + i + '" list="b2t-ll" value="' + esc(p) + '" placeholder="' + esc(s.payee ? t('newled', { p: s.payee }) : t('pickled')) + '" aria-label="' + esc(t('c.led') + ' ' + d(l.date) + ' ' + m(l.cr || l.dr)) + '" dir="auto">' +
          (p ? '<small class="soft b2t-why">' + esc(vtOf(p, l)) + (w ? ' · ' + esc(w) : '') + '</small>' : s.payee ? '<button type="button" class="btn sm b2t-use" data-b2tp="' + i + '">' + esc(t('usename', { p: s.payee })) + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (pages > 1 ? '<div class="xt-pager"><button type="button" class="btn sm" data-b2tpg="-1"' + (ST.page ? '' : ' disabled') + '>' + esc(t('prev')) + '</button><span>' + esc(t('page', { a: ST.page + 1, n: pages })) + '</span><button type="button" class="btn sm" data-b2tpg="1"' + (ST.page < pages - 1 ? '' : ' disabled') + '>' + esc(t('next')) + '</button></div>' : '');
    /* new ledgers */
    var R = result(), NL = R ? Object.keys(R.map).filter(function (k) { return !R.map[k].fromTally; }) : [];
    if (NL.length) {
      var groups = X.GROUPS.concat(ST.T ? ST.T.groups.filter(function (g) { return X.GROUPS.indexOf(g) < 0; }) : []);
      h += '<h4>' + esc(t('newh', { n: NL.length })) + '</h4><p class="hint">' + esc(ST.T ? t('newhT') : t('newh0')) + '</p><datalist id="b2t-gl">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
        '<div class="tbl"><table class="bk-t xt-led"><thead><tr><th>' + esc(t('c.led')) + '</th><th>' + esc(t('c.group')) + '</th><th>' + esc(t('c.have')) + '</th></tr></thead><tbody>' +
        NL.map(function (k) { var mp = R.map[k]; return '<tr><th scope="row">' + esc(mp.to) + '</th><td><input data-b2tg="' + esc(k) + '" list="b2t-gl" value="' + esc(mp.group) + '" aria-label="' + esc(t('c.group') + ': ' + mp.to) + '"' + (mp.exists ? ' disabled' : '') + '></td>' +
          '<td><label class="chk"><input type="checkbox" data-b2tx="' + esc(k) + '"' + (mp.exists ? ' checked' : '') + '> ' + esc(t('yes')) + '</label></td></tr>'; }).join('') + '</tbody></table></div>';
    }
    /* step 4: the check and the files */
    h += '<h3 class="xt-st"><span>4</span><b>' + esc(t('s4')) + '</b></h3>';
    if (!R) h += '<p class="callout">' + esc(t('needbank')) + '</p>';
    else {
      var errs = R.R.probs.filter(function (p) { return p.lvl === 'err'; }), c2 = {}; R.R.vouchers.forEach(function (v) { c2[v.type] = (c2[v.type] || 0) + 1; });
      var left = ST.lines.length - cnt.use;
      h += '<div class="xt-sum"><p><b>' + esc(t('ready', { n: R.R.vouchers.length })) + '</b> ' + esc(Object.keys(c2).map(function (k) { return k + ' ' + c2[k]; }).join(' · ')) + '</p>' +
        (left ? '<p class="soft">' + esc(t('leftout', { n: left })) + '</p>' : '') +
        (errs.length ? '<p class="xt-e">' + esc(t('errs', { n: errs.length })) + '</p>' : '<p class="xt-ok">' + esc(t('noerrs')) + '</p>') + '</div>';
      if (R.R.probs.length) h += '<details class="card xt-probs" open><summary>' + esc(t('probsh', { n: R.R.probs.length })) + '</summary><ul>' +
        R.R.probs.slice(0, 200).map(function (p) { return '<li class="' + (p.lvl === 'err' ? 'xt-e' : 'xt-w') + '">' + esc(t('lineof', { n: p.r, f: p.sheet })) + ': ' + esc(word(p.code, p.v)) + '</li>'; }).join('') + '</ul></details>';
      var nm = NL.filter(function (k) { return !R.map[k].exists; }).length;
      h += R.R.vouchers.length ? '<div class="row xt-dl">' + (nm ? '<button type="button" class="btn" data-b2t="masters" data-ic="download">' + esc(t('dlm', { n: nm })) + '</button>' : '') +
        '<button type="button" class="btn primary" data-b2t="vouchers" data-ic="download">' + esc(t('dlv', { n: R.R.vouchers.length })) + '</button><button type="button" class="btn" data-b2t="list" data-ic="download">' + esc(t('dll')) + '</button></div>' +
        '<p class="hint">' + esc(nm ? t('order') : t('order1')) + '</p>' : '<p class="warn">' + esc(t('none')) + '</p>';
    }
    h += '<p class="soft b2t-mem">' + esc(t('memo', { n: ST.rules.length })) + (ST.rules.length ? ' <button type="button" class="btn sm" data-b2t="forget">' + esc(t('forget')) + '</button>' : '') + '</p>';
    out.innerHTML = h;
  }
  function vtOf(p, l) { var k = kindOf(p, l); return k === 'cash' || k === 'bank' ? 'Contra' : l.cr ? 'Receipt' : 'Payment'; }
  /* how many lines follow from the balance before them (the statement was read right) */
  function chain(s) {
    var L = s.lines.filter(function (l) { return l.bal != null; }); if (L.length < 3) return '';
    var ok = 0; for (var i = 1; i < L.length; i++) { var a = L[i - 1], b = L[i]; if (Math.abs(a.bal + b.cr - b.dr - b.bal) < 0.02 || Math.abs(b.bal + a.cr - a.dr - a.bal) < 0.02) ok++; }
    return t('chain', { a: ok, n: L.length - 1 });
  }
  var FIELDS = ['date', 'desc', 'ref', 'dr', 'cr', 'amt', 'type', 'bal'];
  function colsBox(s, i) {
    var heads = s.rows[s.header] || [], width = Math.max.apply(null, s.rows.slice(0, 40).map(function (r) { return r.length; }).concat([1]));
    var opts = function (k) { var o = '<option value="">' + esc(t('notin')) + '</option>'; for (var j = 0; j < width; j++) o += '<option value="' + j + '"' + (s.map[k] === j ? ' selected' : '') + '>' + esc(t('colno', { n: j + 1, h: String(heads[j] || '').slice(0, 30) })) + '</option>'; return o; };
    var hr = s.rows.slice(0, 40).map(function (r, j) { return '<option value="' + j + '"' + (j === s.header ? ' selected' : '') + '>' + esc(t('rowof', { n: j + 1, h: r.filter(Boolean).slice(0, 4).join(', ').slice(0, 60) })) + '</option>'; }).join('');
    return '<div class="xt-cols" data-b2tbox="' + i + '"><div class="f"><label for="b2t-hr">' + esc(t('hrow')) + '</label><select id="b2t-hr" data-b2thr="' + i + '">' + hr + '</select></div><div class="xt-cgrid">' +
      FIELDS.map(function (k) { return '<div class="f"><label for="b2t-c-' + k + '">' + esc(t('f.' + k)) + '</label><select id="b2t-c-' + k + '" data-b2tf="' + k + '">' + opts(k) + '</select></div>'; }).join('') +
      '</div><p class="hint">' + esc(t('colsh')) + '</p><p class="row"><button type="button" class="btn primary sm" data-b2tuse="' + i + '">' + esc(t('use')) + '</button><button type="button" class="btn sm" data-b2tcols="' + i + '">' + esc(t('close')) + '</button></p></div>';
  }

  /* ---------- downloads ---------- */
  function today() { return NS.today ? NS.today() : new Date().toISOString().slice(0, 10); }
  function dl(b, name) { if (NS.saveFile) return NS.saveFile(b, name); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function saveText(text, name) { dl(new Blob([text], { type: 'application/xml' }), name); NS.toast && NS.toast(t('saved', { f: name })); }
  function xl(sheets, fn) { NS.loadLazy(['xlsx.js']).then(function () { dl(NS.xlsx.write(sheets), fn); NS.toast && NS.toast(t('saved', { f: fn })); }, function () { NS.toast(t('noxl'), 'bad'); }); }
  function slug() { return String(bank() || 'bank').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'bank'; }
  function file$(what) {
    var R = result(); if (!R) return;
    if (what === 'masters') return saveText(X.mastersXml(R.R, R.map, {}), 'tally-masters-' + slug() + '-' + today() + '.xml');
    if (what === 'vouchers') {
      saveText(X.vouchersXml(R.R, R.map, {}, null, { bills: true }), 'tally-vouchers-' + slug() + '-' + today() + '.xml');
      /* remember: these lines are in a file now, and the ledgers just made will be in Tally after the import */
      var done = ls(DK, {}), dt = today(), inV = {};
      R.R.vouchers.forEach(function (v) { if (v.line != null) inV[v.line] = 1; });
      Object.keys(inV).forEach(function (i) { done[ST.keys[i]] = dt; ST.done[i] = dt; });
      var k = Object.keys(done); if (k.length > 20000) k.slice(0, k.length - 20000).forEach(function (x) { delete done[x]; });
      lsPut(DK, done);
      ST.rules = B.learn(ST.rules, Object.keys(inV).filter(function (i) { return !ST.set[i] && ST.sug[i].conf !== 'rule'; }).map(function (i) { var l = ST.lines[i]; return { line: l, name: ST.picks[i], k: kindOf(ST.picks[i], l) }; }));
      lsPut(RK, ST.rules);
      Object.keys(R.map).forEach(function (x) { var mp = R.map[x]; if (!mp.fromTally) ST.info[x] = { name: mp.to, group: mp.group, exists: true }; });
      lsPut(LK, ST.info);
      SET.bank = bank(); SET.cash = cash(); lsPut(SK, SET);
      return draw();
    }
    if (what === 'list') {
      var V = [['Date', 'Voucher type', 'Ledger', 'Bank ledger', 'Amount', 'Narration', 'Statement line']];
      R.R.vouchers.forEach(function (v) { var l = ST.lines[v.line] || {}; V.push([v.date, v.type, ST.picks[v.line] || '', bank(), v.amount, v.narr, v.r]); });
      var Lf = [['Date', 'Narration', 'Withdrawal', 'Deposit', 'Why left out']];
      ST.lines.forEach(function (l, i) { if (!ST.use[i]) Lf.push([l.date, l.desc, l.dr || '', l.cr || '', !ST.picks[i] ? 'No ledger chosen' : ST.done[i] ? 'Already in a file downloaded on ' + ST.done[i] : 'Not ticked']); });
      return xl([['Vouchers', V], ['Left out', Lf], ['Check', X.checkSheet(R.R, word)]], 'Bank to Tally list ' + slug() + ' ' + today() + '.xlsx');
    }
  }
  function sample() {
    var enc = new TextEncoder(), files = Object.keys(B.SAMPLES).map(function (n) { return new File([enc.encode(B.SAMPLES[n])], n, { type: /\.xml$/.test(n) ? 'text/xml' : 'text/csv' }); });
    SET.bank = 'Sample HDFC Bank';
    take(files);
  }

  /* ---------- wiring ---------- */
  file.addEventListener('change', function () { take(file.files); file.value = ''; });
  ['dragenter', 'dragover'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('on'); }); });
  ['dragleave', 'drop'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('on'); if (e === 'drop' && ev.dataTransfer) take(ev.dataTransfer.files); }); });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var a = b.dataset.b2t;
    if (a === 'sample') return sample();
    if (a === 'pick') return file.click();
    if (a === 'susp') { ST.lines.forEach(function (l, i) { if (!ST.picks[i]) { ST.picks[i] = 'Suspense A/c'; ST.set[i] = 1; ST.use[i] = !ST.done[i]; } }); ST.info['suspense a/c'] = ST.info['suspense a/c'] || { name: 'Suspense A/c', group: 'Suspense A/c' }; ST.R = null; return draw(); }
    if (a === 'forget') { if (!window.confirm(t('forgetq'))) return; ST.rules = []; lsPut(RK, []); lsPut(DK, {}); lsPut(LK, {}); ST.info = {}; ST.set = {}; return run(); }
    if (a) return file$(a);
    if (b.hasAttribute('data-b2tp')) { var i = +b.dataset.b2tp; choose(i, ST.sug[i].payee); return draw(); }
    if (b.hasAttribute('data-b2tcols')) { var c = +b.dataset.b2tcols; ST.cols = ST.cols === c ? -1 : c; draw(); var x = out.querySelector('[data-b2tbox]'); if (x) x.scrollIntoView({ block: 'nearest' }); return; }
    if (b.hasAttribute('data-b2tpg')) { ST.page += +b.dataset.b2tpg; draw(); var tw = out.querySelector('.b2t-tw'); if (tw) tw.scrollIntoView({ block: 'start' }); return; }
    if (b.hasAttribute('data-b2tuse')) {
      var s = ST.st[+b.dataset.b2tuse], box = out.querySelector('[data-b2tbox]'), map = {}, hr = +box.querySelector('[data-b2thr]').value;
      [].forEach.call(box.querySelectorAll('[data-b2tf]'), function (sel) { if (sel.value !== '') map[sel.dataset.b2tf] = +sel.value; });
      if (map.date == null || map.dr == null && map.cr == null && map.amt == null) { NS.toast(t('colsneed'), 'bad'); return; }
      var ns = stmt(s.name, s.rows, map, hr); ST.st[+b.dataset.b2tuse] = ns;
      var saved = ls(CK, {}); saved[sig(s.rows[hr])] = map; lsPut(CK, saved);
      ST.cols = -1; ST.set = {}; return run();
    }
  });
  root.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'b2t-mfile') { take(el.files, true); el.value = ''; return; }
    if (el.id === 'b2t-bank') { SET.bank = el.value.trim(); lsPut(SK, SET); suggestAll(); return draw(); }
    if (el.id === 'b2t-cash') { SET.cash = el.value.trim() || 'Cash'; lsPut(SK, SET); suggestAll(); return draw(); }
    if (el.id === 'b2t-narr') { SET.narr = el.value; lsPut(SK, SET); ST.R = null; return draw(); }
    if (el.id === 'b2t-show') { ST.show = el.value; ST.page = 0; return draw(); }
    if (el.hasAttribute('data-b2tl')) { choose(+el.dataset.b2tl, el.value); return draw(); }
    if (el.hasAttribute('data-b2tu')) { ST.use[+el.dataset.b2tu] = el.checked; ST.set[+el.dataset.b2tu] = 1; ST.R = null; return draw(); }
    if (el.hasAttribute('data-b2tg')) { var k = el.dataset.b2tg, mp = result().map[k]; ST.info[k] = { name: mp.to, group: el.value.trim() }; ST.R = null; suggestAll(); return draw(); }
    if (el.hasAttribute('data-b2tx')) { var k2 = el.dataset.b2tx, mp2 = result().map[k2]; ST.info[k2] = { name: mp2.to, group: mp2.group, exists: el.checked }; ST.R = null; return draw(); }
  });
  var qt = 0;
  root.addEventListener('input', function (e) { if (e.target.id !== 'b2t-q') return; clearTimeout(qt); var v = e.target.value; qt = setTimeout(function () { ST.q = v; ST.page = 0; draw(); var q = out.querySelector('#b2t-q'); if (q) { q.focus(); q.setSelectionRange(v.length, v.length); } }, 250); });
})();
