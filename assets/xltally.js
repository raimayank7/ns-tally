/* tally.niveshsahayak.in, "Excel to Tally XML" (byof2-tally, 28 Nov 2026): drop an Excel / CSV of sales, purchases, credit and debit
   notes, receipts, payments, contra or journal entries (any headings, one row per entry or per line) and, optionally, a masters export
   of the Tally company; every row is checked, the ledgers and stock items that are new are listed (map each to the name your Tally
   uses, or let it be created), then download the masters and vouchers XML, or send them straight to TallyPrime with the NSBiz Helper
   add-on. Everything stays in the browser. Working: xltcore.js (NSXlTally); reading: tplcore.js (NSTpl.pick 'xltally'), tallyin.js
   (masters), SheetJS (engine/vendor, offline). Screen words: NS.t('xt.*'), English only for now (owner, 28 Nov).
   Designed & Developed by: Nivesh Sahayak (https://www.niveshsahayak.in/) */
(function () {
  'use strict';
  var NS = window.NS, X = window.NSXlTally, TP = window.NSTpl, TI = window.NSTallyIn;
  if (!NS || !X || !TP) return;
  var root = document.getElementById('xt');
  if (!root) return;
  var esc = NS.esc, t = function (k, v) { return NS.t('xt.' + k, v); };
  var XLJS = '/assets/vendor/xlsx-0.20.3.full.min.js', PER = 100;
  var ST = { srcs: [], T: null, R: null, map: {}, imap: {}, cols: -1, page: 0, lpage: 0, only: 'all' };
  var LKEY = 'ns-xlt-layouts', MKEY = 'ns-xlt-map', SKEY = 'ns-xlt-set';
  function ls(k, d) { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } }
  function lsPut(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function remember(sig, map) { var L = ls(LKEY, {}); L[sig] = { map: map, at: Date.now() }; var k = Object.keys(L); if (k.length > 40) delete L[k.sort(function (a, b) { return L[a].at - L[b].at; })[0]]; lsPut(LKEY, L); }
  var SET = Object.assign({ state: '', fy: 'auto', byRate: false, round: true, stock: true, bills: true }, ls(SKEY, {}));
  function m(v) { return NS.money ? NS.money(v, false) : String(v); }
  function d(s) { return s ? (NS.fmtDate ? NS.fmtDate(s) : s) : ''; }
  function key(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  var out = root.querySelector('#xt-out'), file = root.querySelector('#xt-file'), drop = root.querySelector('.xt-drop');

  /* ---------- reading the files ---------- */
  function readOne(f) {
    var name = f.name || 'file';
    return f.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var head = new TextDecoder(b[0] === 0xFF && b[1] === 0xFE ? 'utf-16le' : 'utf-8').decode(b.subarray(0, 4000));
      if (/\.xml$/i.test(name) || /<ENVELOPE|<TALLYMESSAGE/i.test(head)) {
        if (!TI) throw new Error('tally');
        var M = TI.collect([b]), T = X.tallyMasters(M);
        return [{ name: name, kind: 'tally', T: T, n: Object.keys(T.ledgers).length, items: Object.keys(T.items).length, vch: (M.vouchers || []).length }];
      }
      var csv = /\.(csv|txt)$/i.test(name) || !(b[0] === 0x50 && b[1] === 0x4B) && !(b[0] === 0xD0 && b[1] === 0xCF);
      return NS.loadJs(XLJS, '').then(function () {
        var XL = window.XLSX, wb = csv ? XL.read(new TextDecoder().decode(buf), { type: 'string', raw: true }) : XL.read(buf, { type: 'array', cellDates: false });
        return wb.SheetNames.map(function (n) {
          var rows = XL.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }).map(function (r) { return r.map(function (c) { return c == null ? '' : String(c).trim(); }); });
          while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
          return { name: csv ? name : name + ' · ' + n, kind: 'sheet', raw: rows, tname: n + ' ' + name };
        });
      }, function () {   /* no SheetJS (offline before the first visit): the small reader for .xlsx and .csv */
        return NS.loadLazy(['xlsx.js']).then(function () { return NS.xlsx.read(f, { keepEmpty: true }); }).then(function (rows) { return [{ name: name, kind: 'sheet', raw: rows, tname: name }]; });
      });
    });
  }
  function take(files, keep) {
    files = [].slice.call(files || []); if (!files.length) return;
    out.innerHTML = '<p class="soft" role="status">' + esc(t('reading')) + '</p>';
    var all = keep ? ST.srcs.slice() : [];
    files.reduce(function (p, f) { return p.then(function () { return readOne(f).then(function (list) { all = all.concat(list); }, function (e) { all.push({ name: f.name, kind: 'bad', why: e && e.message === 'xls' ? t('noxls') : t('noread') }); }); }); }, Promise.resolve())
      .then(function () { ST.srcs = all.map(prep); ST.page = 0; ST.lpage = 0; ST.cols = -1; setTimeout(run, 0); });
  }
  function prep(s) {
    if (s.kind !== 'sheet') return s;
    if (s.raw.filter(function (r) { return r.some(Boolean); }).length < 2) { s.kind = 'unused'; return s; }
    s.L = TP.pick('xltally', s.raw, ls(LKEY, {}));
    if (!s.L) { s.kind = 'unused'; return s; }
    s.vt = s.vt || X.typeFromName(s.tname || s.name);
    return s;
  }
  function needsType(s) { return s.kind === 'sheet' && !('vtype' in (s.L.map || {})); }
  function usable(s) { return s.kind === 'sheet' && !s.L.missing.length && (!needsType(s) || s.vt) && hasAmt(s.L.map); }
  function hasAmt(mp) { return ['taxable', 'amt', 'total', 'dr', 'cr', 'rate', 'cgst', 'igst'].some(function (k) { return k in mp; }); }
  function run() {
    var rows = [];
    ST.srcs.forEach(function (s) { if (usable(s)) rows = rows.concat(X.fromSheet(s.raw, s.L, s.name, needsType(s) ? s.vt : '')); });
    ST.T = null; ST.srcs.forEach(function (s) { if (s.kind === 'tally' && s.n) { if (!ST.T) ST.T = { ledgers: {}, items: {}, groups: [], company: s.T.company }; Object.assign(ST.T.ledgers, s.T.ledgers); Object.assign(ST.T.items, s.T.items); ST.T.groups = ST.T.groups.concat(s.T.groups); } });
    var fy = SET.fy === 'auto' ? autoFy(rows) : SET.fy === 'none' ? '' : +SET.fy;
    ST.fy = fy;
    ST.R = X.build(rows, { state: SET.state, fy: fy, byRate: SET.byRate, round: SET.round, stock: SET.stock, today: NS.today ? NS.today() : '' });
    ST.map = X.autoMap(ST.R, ST.T, ls(MKEY, {}));
    ST.imap = X.itemMap(ST.R, ST.T);
    draw();
  }
  /* the financial year most of the dates fall in */
  function autoFy(rows) {
    var c = {}; rows.forEach(function (o) { var dt = TP.date(o.date); if (dt) { var y = +dt.slice(0, 4) - (+dt.slice(5, 7) < 4 ? 1 : 0); c[y] = (c[y] || 0) + 1; } });
    var best = ''; Object.keys(c).forEach(function (y) { if (!best || c[y] > c[best]) best = y; }); return best ? +best : '';
  }

  /* ---------- the screen ---------- */
  function word(code, v) { var s = NS.t('xt.p.' + code, v || {}); return s === 'xt.p.' + code ? code : s; }
  function draw() {
    var R = ST.R, h = '';
    /* step 2: what was read */
    h += '<h3 class="xt-st"><span>2</span><b>' + esc(t('s2')) + '</b></h3><div class="xt-files">';
    ST.srcs.forEach(function (s, i) {
      if (s.kind === 'bad') { h += '<div class="card xt-src"><b>' + esc(s.name) + '</b><p class="warn">' + esc(s.why) + '</p></div>'; return; }
      if (s.kind === 'unused') { h += '<div class="card xt-src"><b>' + esc(s.name) + '</b><p class="soft">' + esc(t('unused')) + '</p></div>'; return; }
      if (s.kind === 'tally') { h += '<div class="card xt-src"><b>' + esc(s.name) + '</b><p>' + esc(s.n ? t('mread', { n: s.n, i: s.items, c: s.T.company || '—' }) : s.vch ? t('mvch') : t('mnone')) + '</p></div>'; return; }
      var miss = s.L.missing.map(function (k) { return colName(k); });
      h += '<div class="card xt-src"><b>' + esc(s.name) + '</b> <span class="soft">' + esc(t('hrow', { n: s.L.row + 1 })) + (s.L.remembered ? ' · ' + esc(t('remem')) : '') + '</span>' +
        '<div class="xt-chips">' + X.SET.cols.filter(function (c) { return c.k in s.L.map; }).map(function (c) { return '<span class="chip"><b>' + esc(c.h) + '</b> ← ' + esc(s.L.heads[s.L.map[c.k]] || '') + '</span>'; }).join('') + '</div>' +
        (miss.length ? '<p class="callout">' + esc(t('missing', { f: miss.join(', ') })) + '</p>' : '') +
        (!hasAmt(s.L.map) ? '<p class="callout">' + esc(t('noamtcol')) + '</p>' : '') +
        (needsType(s) ? '<div class="f xt-vt"><label for="xt-vt-' + i + '">' + esc(t('alltype')) + '</label><select id="xt-vt-' + i + '" data-xtvt="' + i + '"><option value="">' + esc(t('choose')) + '</option>' + X.VT.map(function (v) { return '<option' + (s.vt === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></div>' : '') +
        '<button type="button" class="btn sm" data-xtcols="' + i + '">' + esc(t('cols')) + '</button>' + (ST.cols === i ? colsBox(s, i) : '') + '</div>';
    });
    h += '</div>';
    if (!R || !R.rows) { out.innerHTML = h + '<p class="warn">' + esc(t('nothing')) + '</p>'; return; }
    var errs = R.probs.filter(function (p) { return p.lvl === 'err'; }), warns = R.probs.filter(function (p) { return p.lvl !== 'err'; });
    var cnt = {}; R.vouchers.forEach(function (v) { cnt[v.type] = (cnt[v.type] || 0) + 1; });
    h += '<div class="xt-sum"><p><b>' + esc(t('ready', { n: R.vouchers.length })) + '</b> ' + esc(Object.keys(cnt).map(function (k) { return k + ' ' + cnt[k]; }).join(' · ')) + '</p>' +
      (errs.length ? '<p class="xt-e">' + esc(t('errs', { n: errs.length })) + '</p>' : '<p class="xt-ok">' + esc(t('noerrs')) + '</p>') + (warns.length ? '<p class="soft">' + esc(t('warns', { n: warns.length })) + '</p>' : '') +
      (ST.fy ? '<p class="soft">' + esc(t('fyis', { fy: ST.fy + '-' + String(+ST.fy + 1).slice(2) })) + '</p>' : '') + '</div>';
    if (R.probs.length) {
      var P = R.probs.slice().sort(function (a, b) { return (a.lvl === 'err' ? 0 : 1) - (b.lvl === 'err' ? 0 : 1); });
      h += '<details class="card xt-probs"' + (errs.length ? ' open' : '') + '><summary>' + esc(t('probsh', { n: P.length })) + '</summary><ul>' +
        P.slice(0, 200).map(function (p) { return '<li class="' + (p.lvl === 'err' ? 'xt-e' : 'xt-w') + '"><b>' + esc(p.lvl === 'err' ? t('err') : t('warn')) + '</b> · ' + esc(p.sheet + ' · ' + t('row', { n: p.r })) + ': ' + esc(word(p.code, p.v)) + '</li>'; }).join('') + '</ul>' +
        (P.length > 200 ? '<p class="soft">' + esc(t('more', { n: P.length - 200 })) + '</p>' : '') + '<p><button type="button" class="btn sm" data-xt="check" data-ic="download">' + esc(t('dlcheck')) + '</button></p></details>';
    }
    /* the vouchers, a page at a time */
    if (R.vouchers.length) {
      var pg = R.vouchers.slice(ST.page * PER, ST.page * PER + PER), pages = Math.ceil(R.vouchers.length / PER);
      h += '<div class="tbl xt-tw"><table class="bk-t"><caption class="soft">' + esc(t('vlist')) + '</caption><thead><tr><th>' + esc(t('c.row')) + '</th><th>' + esc(t('c.date')) + '</th><th>' + esc(t('c.type')) + '</th><th>' + esc(t('c.no')) + '</th><th>' + esc(t('c.party')) + '</th><th class="n">' + esc(t('c.amt')) + '</th><th>' + esc(t('c.lines')) + '</th></tr></thead><tbody>' +
        pg.map(function (v) { return '<tr><td>' + esc(String(v.r)) + '</td><td>' + esc(d(v.date)) + '</td><td>' + esc(v.type) + '</td><td class="mono">' + esc(v.no || '—') + '</td><td>' + esc(v.party ? nm(v.party) : '—') + '</td><td class="n">' + m(v.amount) + '</td><td class="xt-ln">' + esc(v.lines.map(function (l) { return nm(l.a) + ' ' + (l.v > 0 ? 'Dr ' : 'Cr ') + m(Math.abs(l.v)); }).concat(v.inv.map(function (e) { return e.item + ' ' + e.qty + ' ' + e.unit + ' ' + m(e.amt); })).join('; ')) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + (pages > 1 ? '<div class="xt-pager"><button type="button" class="btn sm" data-xtpg="-1"' + (ST.page ? '' : ' disabled') + '>' + esc(t('prev')) + '</button><span>' + esc(t('page', { a: ST.page + 1, n: pages })) + '</span><button type="button" class="btn sm" data-xtpg="1"' + (ST.page < pages - 1 ? '' : ' disabled') + '>' + esc(t('next')) + '</button></div>' : '');
    }
    /* step 3: ledgers */
    var LK = Object.keys(R.ledgers), newL = LK.filter(function (k) { return !ST.map[k].exists; });
    h += '<h3 class="xt-st"><span>3</span><b>' + esc(t('s3')) + '</b></h3><p>' + esc(t('s3h')) + '</p>' +
      '<div class="xt-tdrop"><label class="btn" for="xt-mfile">' + esc(t('mpick')) + '</label><input type="file" id="xt-mfile" accept=".xml,.txt" hidden><span class="soft">' + esc(ST.T ? t('mhave', { n: Object.keys(ST.T.ledgers).length, c: ST.T.company || '—' }) : t('mhint')) + '</span></div>' +
      '<p><b>' + esc(t('lcount', { n: LK.length, k: newL.length })) + '</b></p>';
    var groups = X.GROUPS.concat(ST.T ? ST.T.groups.filter(function (g) { return X.GROUPS.indexOf(g) < 0; }) : []);
    var shown = LK.filter(function (k) { return ST.only === 'all' || ST.only === 'new' && !ST.map[k].exists || ST.only === 'nogroup' && !ST.map[k].exists && !ST.map[k].group; });
    var lp = shown.slice(ST.lpage * PER, ST.lpage * PER + PER), lpages = Math.ceil(shown.length / PER);
    h += '<div class="f xt-only"><label for="xt-only">' + esc(t('show')) + '</label><select id="xt-only"><option value="all"' + (ST.only === 'all' ? ' selected' : '') + '>' + esc(t('sh.all')) + '</option><option value="new"' + (ST.only === 'new' ? ' selected' : '') + '>' + esc(t('sh.new')) + '</option><option value="nogroup"' + (ST.only === 'nogroup' ? ' selected' : '') + '>' + esc(t('sh.nog')) + '</option></select></div>' +
      '<datalist id="xt-tl">' + (ST.T ? Object.keys(ST.T.ledgers).slice(0, 5000).map(function (k) { return '<option value="' + esc(ST.T.ledgers[k].name) + '">'; }).join('') : '') + '</datalist>' +
      '<datalist id="xt-gl">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
      '<div class="tbl"><table class="bk-t xt-led"><thead><tr><th>' + esc(t('c.file')) + '</th><th>' + esc(t('c.tally')) + '</th><th>' + esc(t('c.group')) + '</th><th>' + esc(t('c.have')) + '</th></tr></thead><tbody>' +
      lp.map(function (k) {
        var l = R.ledgers[k], mp = ST.map[k];
        return '<tr' + (!mp.exists && !mp.group ? ' class="xt-need"' : '') + '><th scope="row">' + esc(l.name) + (l.spellings ? ' <small class="soft">' + esc(t('spell', { s: l.spellings.join(', ') })) + '</small>' : '') + (l.both ? ' <small class="soft">' + esc(t('both')) + '</small>' : '') + (l.gstin ? ' <small class="mono soft">' + esc(l.gstin) + '</small>' : '') + '</th>' +
          '<td><input data-xtto="' + esc(k) + '" list="xt-tl" value="' + esc(mp.to) + '" aria-label="' + esc(t('c.tally') + ': ' + l.name) + '" dir="auto"></td>' +
          '<td><input data-xtg="' + esc(k) + '" list="xt-gl" value="' + esc(mp.group) + '" placeholder="' + esc(t('pickg')) + '" aria-label="' + esc(t('c.group') + ': ' + l.name) + '"' + (mp.exists ? ' disabled' : '') + '></td>' +
          '<td><label class="chk"><input type="checkbox" data-xtx="' + esc(k) + '"' + (mp.exists ? ' checked' : '') + '> ' + esc(mp.fromTally ? t('found') : t('yes')) + '</label></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (lpages > 1 ? '<div class="xt-pager"><button type="button" class="btn sm" data-xtlp="-1"' + (ST.lpage ? '' : ' disabled') + '>' + esc(t('prev')) + '</button><span>' + esc(t('page', { a: ST.lpage + 1, n: lpages })) + '</span><button type="button" class="btn sm" data-xtlp="1"' + (ST.lpage < lpages - 1 ? '' : ' disabled') + '>' + esc(t('next')) + '</button></div>' : '');
    var IK = Object.keys(R.items);
    if (IK.length) h += '<h4>' + esc(t('items', { n: IK.length })) + '</h4><div class="tbl"><table class="bk-t"><thead><tr><th>' + esc(t('c.item')) + '</th><th>' + esc(t('c.unit')) + '</th><th>' + esc(t('c.tally')) + '</th><th>' + esc(t('c.have')) + '</th></tr></thead><tbody>' +
      IK.slice(0, 500).map(function (k) { var it = R.items[k], mp = ST.imap[k]; return '<tr><th scope="row">' + esc(it.name) + '</th><td>' + esc(it.unit) + '</td><td><input data-xtito="' + esc(k) + '" value="' + esc(mp.to) + '" aria-label="' + esc(t('c.tally') + ': ' + it.name) + '"></td><td><label class="chk"><input type="checkbox" data-xtix="' + esc(k) + '"' + (mp.exists ? ' checked' : '') + '> ' + esc(t('yes')) + '</label></td></tr>'; }).join('') + '</tbody></table></div>';
    /* step 4: the files */
    var noG = LK.filter(function (k) { return !ST.map[k].exists && !String(ST.map[k].group || '').trim(); }).length;
    h += '<h3 class="xt-st"><span>4</span><b>' + esc(t('s4')) + '</b></h3>' +
      (noG ? '<p class="callout">' + esc(t('nogroup', { n: noG })) + '</p>' : '') +
      (R.vouchers.length ? '<div class="row xt-dl"><button type="button" class="btn" data-xt="masters" data-ic="download">' + esc(t('dlm', { n: newL.length + IK.filter(function (k) { return !ST.imap[k].exists; }).length })) + '</button><button type="button" class="btn primary" data-xt="vouchers" data-ic="download">' + esc(t('dlv', { n: R.vouchers.length })) + '</button><button type="button" class="btn" data-xt="list" data-ic="download">' + esc(t('dll')) + '</button></div>' +
        '<p class="hint">' + esc(t('order')) + '</p>' + live() : '<p class="warn">' + esc(t('none')) + '</p>');
    out.innerHTML = h;
  }
  function nm(a) { var mp = ST.map[key(a)]; return mp && mp.to ? mp.to : a; }
  function colName(k) { var c = X.SET.cols.filter(function (c) { return c.k === k; })[0]; return c ? c.h : k; }
  function colsBox(s, i) {
    var opts = function (k) { return '<option value="">' + esc(t('notin')) + '</option>' + s.L.heads.map(function (hd, j) { return hd ? '<option value="' + j + '"' + (s.L.map[k] === j ? ' selected' : '') + '>' + esc(hd) + '</option>' : ''; }).join(''); };
    var hr = s.raw.slice(0, 20).map(function (r, j) { return r.some(Boolean) ? '<option value="' + j + '"' + (j === s.L.row ? ' selected' : '') + '>' + esc(t('rowof', { n: j + 1, h: r.filter(Boolean).slice(0, 4).join(', ').slice(0, 60) })) + '</option>' : ''; }).join('');
    return '<div class="xt-cols" data-xtbox="' + i + '"><div class="f"><label for="xt-hr">' + esc(t('hrowp')) + '</label><select id="xt-hr" data-xthr="' + i + '">' + hr + '</select></div><div class="xt-cgrid">' +
      X.SET.cols.map(function (c) { return '<div class="f"><label for="xt-c-' + c.k + '">' + esc(c.h) + (c.need ? ' *' : '') + '</label><select id="xt-c-' + c.k + '" data-xtf="' + c.k + '">' + opts(c.k) + '</select></div>'; }).join('') +
      '</div><p class="row"><button type="button" class="btn primary sm" data-xtuse="' + i + '">' + esc(t('use')) + '</button><button type="button" class="btn sm" data-xtcols="' + i + '">' + esc(t('close')) + '</button></p></div>';
  }

  /* ---------- downloads ---------- */
  function today() { return NS.today ? NS.today() : new Date().toISOString().slice(0, 10); }
  function saveText(text, name) { var b = new Blob([text], { type: 'application/xml' }); NS.saveFile ? NS.saveFile(b, name) : dl(b, name); NS.toast && NS.toast(t('saved', { f: name })); }
  function dl(b, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function xl(sheets, fn) { NS.loadLazy(['xlsx.js']).then(function () { var b = NS.xlsx.write(sheets); NS.saveFile ? NS.saveFile(b, fn) : dl(b, fn); NS.toast && NS.toast(t('saved', { f: fn })); }, function () { NS.toast(t('noxl'), 'bad'); }); }
  function saveMap() { var all = ls(MKEY, {}); Object.keys(ST.map).forEach(function (k) { var mp = ST.map[k]; all[k] = { to: mp.to, group: mp.group, exists: !!mp.exists && !mp.fromTally }; }); var k = Object.keys(all); if (k.length > 3000) k.slice(0, k.length - 3000).forEach(function (x) { delete all[x]; }); lsPut(MKEY, all); }
  function file$(what) {
    var R = ST.R; if (!R) return;
    if (what === 'check') return xl([['Check', X.checkSheet(R, word)]], 'Tally import check ' + today() + '.xlsx');
    if (what === 'list') return xl([['Vouchers', X.voucherSheet(R, ST.map)], ['Check', X.checkSheet(R, word)]], 'Tally vouchers list ' + today() + '.xlsx');
    if (what === 'masters') return saveText(X.mastersXml(R, ST.map, ST.imap), 'tally-masters-' + today() + '.xml');
    if (what === 'vouchers') return saveText(X.vouchersXml(R, ST.map, ST.imap, null, { bills: SET.bills }), 'tally-vouchers-' + today() + '.xml');
  }

  /* ---------- straight to TallyPrime, through the NSBiz Helper add-on (same calls as tally.js) ---------- */
  function live() {
    if (!NS.addonAny || !NS.addonAny()) return '<p class="soft">' + esc(t('noaddon')) + '</p>';
    var port = '9000'; try { port = localStorage.getItem('ns-tally-port') || '9000'; } catch (e) {}
    return '<div class="card xt-live"><h4>' + esc(t('lv')) + '</h4><p class="hint">' + esc(t('lvh')) + '</p><p class="row"><label for="xt-port">' + esc(t('port')) + '</label> <input id="xt-port" inputmode="numeric" size="6" value="' + esc(port) + '">' +
      '<button type="button" class="btn primary" data-xt="send">' + esc(t('send')) + '</button></p><div id="xt-lout" aria-live="polite"></div></div>';
  }
  function send() {
    var A = NS.addonAny && NS.addonAny(), lo = root.querySelector('#xt-lout'); if (!A || !lo) return;
    var p = +(String(root.querySelector('#xt-port').value || '').replace(/\D/g, '') || 9000); try { localStorage.setItem('ns-tally-port', String(p)); } catch (e) {}
    lo.innerHTML = '<p class="soft">…</p>';
    var res = function (r) { return esc(t('lvres', { c: r.created || 0, a: r.altered || 0, e: (r.errors || 0) + (r.exceptions || 0) })) + (r.lineErrors && r.lineErrors.length ? '<ul class="warn">' + r.lineErrors.slice(0, 50).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : ''); };
    var acc = '';
    A.call('tally', { op: 'ping', port: p }).then(function (r) {
      if (r && r.perm === false) { lo.innerHTML = '<p class="warn">' + esc(t('perm')) + '</p>'; return null; }
      acc = '<p>' + esc(t('lvco', { c: (r.companies || []).join(', ') || '—' })) + '</p>';
      return A.call('tally', { op: 'send', port: p, xml: X.mastersXml(ST.R, ST.map, ST.imap) });
    }).then(function (r) {
      if (!r) return null; acc += '<p><b>' + esc(t('lvm')) + '</b> ' + res(r) + '</p>'; lo.innerHTML = acc;
      return A.call('tally', { op: 'send', port: p, xml: X.vouchersXml(ST.R, ST.map, ST.imap, null, { bills: SET.bills }) });
    }).then(function (r) { if (r) lo.innerHTML = acc + '<p><b>' + esc(t('lvv')) + '</b> ' + res(r) + '</p>'; }, function (e) { lo.innerHTML = '<p class="warn">' + esc(e && e.message || String(e)) + '</p>'; });
  }

  /* ---------- settings ---------- */
  function settings() {
    var box = root.querySelector('#xt-set'); if (!box) return;
    var st = (NS.STATES || []).map(function (s) { return '<option value="' + s[0] + '"' + (SET.state === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');
    var y = new Date().getFullYear(), ys = []; for (var i = y + 1; i >= y - 6; i--) ys.push(i);
    box.innerHTML = '<div class="f"><label for="xt-state">' + esc(t('state')) + '</label><select id="xt-state"><option value="">' + esc(t('nostate')) + '</option>' + st + '</select></div>' +
      '<div class="f"><label for="xt-fy">' + esc(t('fy')) + '</label><select id="xt-fy"><option value="auto"' + (SET.fy === 'auto' ? ' selected' : '') + '>' + esc(t('fyauto')) + '</option>' + ys.map(function (v) { return '<option value="' + v + '"' + (String(SET.fy) === String(v) ? ' selected' : '') + '>' + v + '-' + String(v + 1).slice(2) + '</option>'; }).join('') + '<option value="none"' + (SET.fy === 'none' ? ' selected' : '') + '>' + esc(t('fynone')) + '</option></select></div>' +
      '<div class="f wide"><label class="chk"><input type="checkbox" id="xt-byrate"' + (SET.byRate ? ' checked' : '') + '> ' + esc(t('byrate')) + '</label>' +
      '<label class="chk"><input type="checkbox" id="xt-round"' + (SET.round ? ' checked' : '') + '> ' + esc(t('round')) + '</label>' +
      '<label class="chk"><input type="checkbox" id="xt-stock"' + (SET.stock ? ' checked' : '') + '> ' + esc(t('stock')) + '</label>' +
      '<label class="chk"><input type="checkbox" id="xt-bills"' + (SET.bills ? ' checked' : '') + '> ' + esc(t('bills')) + '</label></div>';
  }
  function sample() {
    var enc = new TextEncoder(), files = Object.keys(X.SAMPLES).map(function (n) { return new File([enc.encode(X.SAMPLES[n])], n, { type: 'text/csv' }); });
    if (!SET.state) { SET.state = '03'; lsPut(SKEY, SET); settings(); }   /* the made-up business is in Punjab */
    take(files);
  }

  /* ---------- wiring ---------- */
  settings();
  file.addEventListener('change', function () { take(file.files); file.value = ''; });
  ['dragenter', 'dragover'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('on'); }); });
  ['dragleave', 'drop'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('on'); if (e === 'drop' && ev.dataTransfer) take(ev.dataTransfer.files); }); });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var a = b.dataset.xt;
    if (a === 'sample') return sample();
    if (a === 'pick') return file.click();
    if (a === 'blank') return xl(X.blank(), 'Excel to Tally sheet.xlsx');
    if (a === 'send') return send();
    if (a) return file$(a);
    if (b.hasAttribute('data-xtcols')) { var i = +b.dataset.xtcols; ST.cols = ST.cols === i ? -1 : i; draw(); var x = out.querySelector('[data-xtbox]'); if (x) x.scrollIntoView({ block: 'nearest' }); return; }
    if (b.hasAttribute('data-xtpg')) { ST.page += +b.dataset.xtpg; draw(); var tw = out.querySelector('.xt-tw'); if (tw) tw.scrollIntoView({ block: 'start' }); return; }
    if (b.hasAttribute('data-xtlp')) { ST.lpage += +b.dataset.xtlp; draw(); var tl = out.querySelector('.xt-led'); if (tl) tl.scrollIntoView({ block: 'start' }); return; }
    if (b.hasAttribute('data-xtuse')) {
      var s = ST.srcs[+b.dataset.xtuse], box = out.querySelector('[data-xtbox]'), map = {};
      [].forEach.call(box.querySelectorAll('[data-xtf]'), function (sel) { if (sel.value !== '') map[sel.dataset.xtf] = +sel.value; });
      s.L = Object.assign({}, s.L, { map: map, missing: X.SET.cols.filter(function (c) { return c.need && !(c.k in map); }).map(function (c) { return c.k; }), remembered: false });
      if (!s.L.missing.length) remember(s.L.sig, map);
      ST.cols = -1; run();
    }
  });
  root.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'xt-mfile') { take(el.files, true); el.value = ''; return; }
    if (el.id === 'xt-state') { SET.state = el.value; lsPut(SKEY, SET); if (ST.srcs.length) run(); return; }
    if (el.id === 'xt-fy') { SET.fy = el.value; lsPut(SKEY, SET); if (ST.srcs.length) run(); return; }
    if (/^xt-(byrate|round|stock|bills)$/.test(el.id)) { SET[{ 'xt-byrate': 'byRate', 'xt-round': 'round', 'xt-stock': 'stock', 'xt-bills': 'bills' }[el.id]] = el.checked; lsPut(SKEY, SET); if (ST.srcs.length) run(); return; }
    if (el.id === 'xt-only') { ST.only = el.value; ST.lpage = 0; draw(); return; }
    if (el.hasAttribute('data-xtvt')) { ST.srcs[+el.dataset.xtvt].vt = el.value; run(); return; }
    if (el.hasAttribute('data-xthr')) { var s = ST.srcs[+el.dataset.xthr], r = +el.value, heads = s.raw[r] || []; s.L = { row: r, heads: heads, sig: TP.sig(heads), map: {}, missing: [] }; heads.forEach(function (h, j) { var f = TP.fieldIn(X.SET.cols, h); if (f && !(f in s.L.map)) s.L.map[f] = j; }); s.L.missing = X.SET.cols.filter(function (c) { return c.need && !(c.k in s.L.map); }).map(function (c) { return c.k; }); draw(); return; }
    if (el.hasAttribute('data-xtto')) {   /* the name in Tally: when it is one of the dropped Tally ledgers, it exists already */
      var k = el.dataset.xtto, mp = ST.map[k], hit = ST.T && (ST.T.ledgers[key(el.value)] || null);
      mp.to = el.value.trim() || ST.R.ledgers[k].name; if (hit) { mp.exists = true; mp.fromTally = true; mp.group = hit.group; } else if (mp.fromTally) { mp.exists = false; mp.fromTally = false; }
      saveMap(); draw(); return;
    }
    if (el.hasAttribute('data-xtg')) { ST.map[el.dataset.xtg].group = el.value.trim(); saveMap(); return; }
    if (el.hasAttribute('data-xtx')) { var mm = ST.map[el.dataset.xtx]; mm.exists = el.checked; if (!el.checked) mm.fromTally = false; saveMap(); draw(); return; }
    if (el.hasAttribute('data-xtito')) { ST.imap[el.dataset.xtito].to = el.value.trim() || ST.R.items[el.dataset.xtito].name; return; }
    if (el.hasAttribute('data-xtix')) { ST.imap[el.dataset.xtix].exists = el.checked; draw(); return; }
  });
  document.addEventListener('ns-lang', function () { settings(); if (ST.srcs.length) draw(); });
})();
