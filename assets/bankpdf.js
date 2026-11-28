/* NSBankPdf: a bank statement PDF -> rows of cells, in the browser (PDF.js 3.11.174, Mozilla, Apache 2.0, kept at /vendor/ so it works
   offline). Shared by the App's bank statement import (bankimp.js) and bank-reco.niveshsahayak.in (brfiles.js); moved here from
   bankimp.js on 28 Nov 2026 (byof-bankreco), behaviour unchanged.
   A bank PDF is text placed on the page. The words are put back into rows by their height on the page; the heading line (Date ...
   Balance) gives the columns, and every word goes under the heading nearest to it (NSBank.pdfLines / pdfTable, bankcore.js). A
   narration that runs onto a second line is joined to its row; the heading printed again on later pages is skipped.
   Password-protected statements (most Indian banks) ask for the password; it is used only to open the file and is not kept.
   Scanned (picture) PDFs have no text and cannot be read this way.
   rows(file, { page(n, total) }) -> Promise of rows; rejects with Error('cancel') when the password box is closed. */
(function () {
  'use strict';
  var PDFJS = '/vendor/pdf.min.js', PDFW = '/vendor/pdf.worker.min.js';
  function w(k, en) { var v = window.NS && NS.t ? NS.t(k) : ''; return v && v !== k ? v : en; }
  function askPassword(again) {
    return new Promise(function (res) {
      var d = NS.el('dialog', { 'class': 'b2-dlg bi-pw' });
      d.innerHTML = '<form method="dialog"><h3>' + NS.esc(again ? w('bpdf.again', 'Wrong password. Try again') : w('bpdf.pw', 'This statement has a password')) + '</h3>' +
        '<p class="soft">' + NS.esc(w('bpdf.pwh', 'Banks usually use your customer ID, date of birth or part of your name and mobile number. The password is used only to open the file here; it is not saved.')) + '</p>' +
        '<input type="password" class="bi-pwin" autocomplete="off" aria-label="' + NS.esc(w('bpdf.pwl', 'PDF password')) + '" style="width:100%">' +
        '<div class="row" style="margin-top:12px;gap:8px;display:flex;justify-content:flex-end"><button type="button" class="btn" value="x">' + NS.esc(w('bpdf.cancel', 'Cancel')) + '</button><button class="btn primary" value="ok">' + NS.esc(w('bpdf.open', 'Open')) + '</button></div></form>';
      document.body.appendChild(d);
      var inp = d.querySelector('.bi-pwin'), done = function (v) { d.close(); d.remove(); res(v); };
      d.querySelector('button[value=x]').addEventListener('click', function () { done(null); });
      d.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); done(inp.value); });
      d.addEventListener('cancel', function (e) { e.preventDefault(); done(null); });
      d.showModal(); inp.focus();
    });
  }
  function open(lib, data, pw, tries) {
    var o = { data: data.slice(0), isEvalSupported: false };   /* CVE-2024-4367: never let a PDF's fonts run code */
    if (pw != null) o.password = pw;
    var t = lib.getDocument(o);
    return t.promise.catch(function (err) {
      if (err && err.name === 'PasswordException' && tries < 5) return askPassword(err.code === 2).then(function (p) { if (p == null) throw new Error('cancel'); return open(lib, data, p, tries + 1); });
      throw err;
    });
  }
  function rows(file, o) {
    o = o || {};
    return NS.loadJs(PDFJS).then(function () {
      var lib = window.pdfjsLib; if (!lib) throw new Error('load');
      lib.GlobalWorkerOptions.workerSrc = PDFW;
      return file.arrayBuffer().then(function (buf) { return open(lib, new Uint8Array(buf), null, 0); });
    }).then(function (pdf) {
      /* pages one after another (a 100-page statement read all at once held the browser for several seconds) */
      var pages = [], n = 0;
      function next() {
        if (++n > pdf.numPages) return Promise.resolve(pages);
        if (o.page) o.page(n, pdf.numPages);
        return pdf.getPage(n).then(function (p) { return p.getTextContent(); }).then(function (tc) { pages.push(NSBank.pdfLines(tc.items)); return next(); });
      }
      return next();
    }).then(NSBank.pdfTable);
  }
  window.NSBankPdf = { rows: rows };
})();
