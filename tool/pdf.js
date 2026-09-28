/* SAVE AS PDF, IN THE BROWSER
 *
 * window.print() opened the phone's print sheet, where "Save as PDF" hides
 * behind a printer choice, and printed the dark theme as black pages. This
 * builds the PDF here -- html2pdf.js (jsPDF + html2canvas), bundled with the
 * site under tool/vendor and loaded from this address only, never from a CDN
 * -- from a dedicated light print layout, and downloads it as a file.
 *
 *   PRCPdf.ready()            preloads the library (call it on pointerdown)
 *   PRCPdf.save({ root, title, shortName, inputs, footerLine })  -> Promise
 *
 * The clone: every result tab open (the screen shows one at a time on a
 * phone), every <details> open, every chart rasterised to a PNG so the print
 * does not depend on the stylesheet, and a footer on every page carrying the
 * not-a-forecast line and the page number.
 */
(function (root) {
  'use strict';

  var LIB = 'vendor/html2pdf.bundle.min.js';
  var BLOCKED = 'Your browser blocked the download. Use Share → Print → Save as PDF.';
  var loading = null;

  function ready() {
    if (root.html2pdf) return Promise.resolve(root.html2pdf);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB;
      s.async = true;
      s.onload = function () {
        if (root.html2pdf) resolve(root.html2pdf);
        else reject(new Error('html2pdf did not load'));
      };
      s.onerror = function () { loading = null; reject(new Error('html2pdf failed to load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* The light palette, written over the site's own tokens on the clone. */
  var LIGHT =
    '--bg:#ffffff;--surface:#ffffff;--surface-2:#f4f6f8;--surface-3:#eef1f4;' +
    '--ink:#111111;--ink-2:#333333;--ink-3:#555555;--muted:#666666;' +
    '--accent:#0b6b7a;--accent-ink:#ffffff;--accent-soft:#e6f2f4;' +
    '--line:#cccccc;--line-strong:#999999;--critical:#b00020;--warn:#8a5a00;' +
    '--good:#1b6e2e;--series-1:#0b6b7a;--series-2:#b00020;--series-3:#6a5acd;' +
    '--ix-fund:#0b6b7a;--ix-bench:#b36b00;';

  var CSS =
    '.pdfhide{position:absolute;left:-10000px;top:0;width:718px;overflow:visible;pointer-events:none}' +
    '.pdfclone{position:static;width:718px;background:#fff;color:#111;' +
    'font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:12px;' +
    'line-height:1.45;padding:0 8px;box-sizing:border-box;-webkit-user-select:text;user-select:text}' +
    '.pdfclone *{box-shadow:none!important;text-shadow:none!important}' +
    '.pdfclone .pdf-h1{font-size:22px;margin:0 0 4px}' +
    '.pdfclone .pdf-sub{color:#555;margin:0 0 14px;font-size:11px}' +
    '.pdfclone .card,.pdfclone .meaning,.pdfclone .notice,.pdfclone .result,.pdfclone .stat,' +
    '.pdfclone .qtile,.pdfclone .resulthead,.pdfclone .explain{background:#fff;color:#111;' +
    'border-color:#ccc;page-break-inside:avoid;break-inside:avoid}' +
    '.pdfclone .card{border:1px solid #ccc;border-radius:6px;padding:10px;margin:0 0 10px}' +
    '.pdfclone table{width:100%;border-collapse:collapse;color:#111;font-size:11px}' +
    '.pdfclone th,.pdfclone td{border-bottom:1px solid #ddd;padding:3px 4px;color:#111;' +
    'background:#fff;position:static!important}' +
    '.pdfclone th{color:#444}' +
    '.pdfclone .ixpanel{display:block!important}' +
    '.pdfclone .ixpanel-h{display:block!important;font-size:16px;margin:14px 0 6px;' +
    'border-bottom:1px solid #999}' +
    '.pdfclone .ixtabs,.pdfclone .pdfrow,.pdfclone .totop,.pdfclone .pdfbtn,.pdfclone .printbtn,' +
    '.pdfclone .yearchips,.pdfclone .wincsv,.pdfclone .ratepresets,.pdfclone button,' +
    '.pdfclone .scroll.fade::after{display:none!important}' +
    '.pdfclone details>*{display:block}' +
    '.pdfclone details summary{font-weight:700;list-style:none;margin:6px 0}' +
    '.pdfclone .winbox{max-height:none!important;overflow:visible!important;border:0}' +
    '.pdfclone .scroll{overflow:visible!important}' +
    '.pdfclone img.pdfchart{max-width:100%;height:auto;display:block}' +
    '.pdfclone .pastnote{border:1px solid #8a5a00;color:#5a3a00;padding:6px 8px;border-radius:6px}' +
    '.pdfclone .hint{color:#555}' +
    '.pdfclone .value{font-size:20px;font-weight:700}' +
    '.pdfclone .legend-dot.fund{background:#0b6b7a}.pdfclone .legend-dot.bench{background:#b36b00}';

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function today() {
    var d = new Date();
    return { iso: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
             pretty: pad2(d.getDate()) + '-' + MON[d.getMonth()] + '-' + d.getFullYear() };
  }

  function slug(name) {
    return String(name || 'results').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'results';
  }

  /* Inline the computed presentation of every SVG element, so the picture
     survives leaving the stylesheet behind. */
  var SVG_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
                   'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'font-weight',
                   'text-anchor', 'fill-opacity', 'stroke-opacity'];
  function inlineSvg(svg) {
    var all = svg.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs = root.getComputedStyle(el);
      var css = '';
      for (var j = 0; j < SVG_PROPS.length; j++) {
        var v = cs.getPropertyValue(SVG_PROPS[j]);
        if (v) css += SVG_PROPS[j] + ':' + v + ';';
      }
      el.setAttribute('style', css);
    }
    var bg = root.getComputedStyle(svg);
    svg.setAttribute('style', 'background:#fff;font-family:' + (bg.fontFamily || 'sans-serif'));
  }

  function rasterise(svg) {
    return new Promise(function (resolve) {
      try {
        inlineSvg(svg);
        var w = svg.getBoundingClientRect().width || 700;
        var vb = svg.viewBox && svg.viewBox.baseVal;
        var ratio = vb && vb.width ? vb.height / vb.width : 0.5;
        var h = w * ratio;
        if (!svg.getAttribute('width')) svg.setAttribute('width', w);
        if (!svg.getAttribute('height')) svg.setAttribute('height', h);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        var xml = new XMLSerializer().serializeToString(svg);
        var img = new Image();
        var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        img.onload = function () {
          try {
            var c = document.createElement('canvas');
            c.width = Math.round(w * 2); c.height = Math.round(h * 2);
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var out = new Image();
            out.className = 'pdfchart';
            out.style.width = w + 'px';
            out.src = c.toDataURL('image/png');
            svg.parentNode.replaceChild(out, svg);
          } catch (e) { /* leave the svg in place */ }
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = url;
      } catch (e) { resolve(); }
    });
  }

  function buildClone(opts) {
    var hide = document.createElement('div');
    hide.className = 'pdfhide';
    var wrap = document.createElement('div');
    wrap.className = 'pdfclone';
    wrap.setAttribute('style', LIGHT);
    hide.appendChild(wrap);
    var style = document.createElement('style');
    style.textContent = CSS;
    wrap.appendChild(style);
    var h1 = document.createElement('h1');
    h1.className = 'pdf-h1';
    h1.textContent = opts.title || 'Where You Stand';
    wrap.appendChild(h1);
    var sub = document.createElement('p');
    sub.className = 'pdf-sub';
    sub.textContent = 'Where You Stand · saved ' + today().pretty +
      ' · worked out on your device from a file you chose';
    wrap.appendChild(sub);
    if (opts.inputs) {
      if (typeof opts.inputs === 'string') {
        var d = document.createElement('div'); d.innerHTML = opts.inputs; wrap.appendChild(d);
      } else wrap.appendChild(opts.inputs.cloneNode(true));
    }
    var body = opts.root.cloneNode(true);
    body.removeAttribute('id');
    /* The window table -- thousands of rows -- does not go through the
       canvas: a canvas that tall is beyond what a browser will draw, and
       came back blank. It is written as text pages at the end instead
       (opts.appendix), so it is both present and legible. */
    var drop = body.querySelectorAll('.pdfrow, .totop, .pdfbtn, .printbtn, .ixtabs, .yearchips, ' +
                                     '.wincsv, .windowlist');
    for (var i = 0; i < drop.length; i++) drop[i].parentNode.removeChild(drop[i]);
    var dets = body.querySelectorAll('details');
    for (var k = 0; k < dets.length; k++) dets[k].setAttribute('open', '');
    var panels = body.querySelectorAll('.ixpanel');
    for (var m = 0; m < panels.length; m++) panels[m].classList.add('on');
    wrap.appendChild(body);
    document.body.appendChild(hide);
    /* What went into the print layout, for the test suite: the page body
       itself is rasterised, so nothing downstream can read it as text. */
    root.PRCPdf.lastBuild = {
      panels: body.querySelectorAll('.ixpanel').length,
      details: dets.length,
      rows: body.querySelectorAll('tr').length,
      svgs: body.querySelectorAll('svg').length,
      inputs: !!opts.inputs || !!body.querySelector('.card h2'),
      appendixRows: opts.appendix && opts.appendix.rows ? opts.appendix.rows.length : 0,
      pages: 0
    };
    return wrap;
  }
  function dropClone(clone) {
    var hide = clone && clone.parentNode;
    if (hide && hide.parentNode) hide.parentNode.removeChild(hide);
  }

  /* The window rows as text, a page at a time: a heading, the column
     names, then rows in a fixed grid, numbers right-aligned. */
  function writeAppendix(pdf, ap) {
    var pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    var x0 = 12, top = 24, lineH = 4.6, bottom = ph - 18;
    var cols = ap.columns || [];
    var n = cols.length || (ap.rows[0] || []).length;
    var usable = pw - 2 * x0;
    var widths = ap.widths || cols.map(function () { return usable / n; });
    var xs = [x0];
    for (var w = 1; w < n; w++) xs.push(xs[w - 1] + widths[w - 1]);
    var numeric = ap.numeric || cols.map(function (c, i) { return i >= 2; });
    var y = bottom + 1, page = 0;
    function head() {
      pdf.addPage(); page++;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(17);
      pdf.text((ap.title || 'Every window') + (page > 1 ? ' (continued)' : ''), x0, 14);
      pdf.setFontSize(8.5); pdf.setTextColor(60);
      for (var c = 0; c < n; c++) {
        var label = String(cols[c] == null ? '' : cols[c]);
        if (numeric[c]) pdf.text(label, xs[c] + widths[c] - 1, top, { align: 'right' });
        else pdf.text(label, xs[c], top);
      }
      pdf.setDrawColor(150); pdf.line(x0, top + 1.5, pw - x0, top + 1.5);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(17);
      y = top + lineH + 1.5;
    }
    for (var r = 0; r < ap.rows.length; r++) {
      if (y > bottom) head();
      var row = ap.rows[r];
      for (var c2 = 0; c2 < n; c2++) {
        var v = String(row[c2] == null ? '' : row[c2]);
        if (numeric[c2]) pdf.text(v, xs[c2] + widths[c2] - 1, y, { align: 'right' });
        else pdf.text(v, xs[c2], y);
      }
      y += lineH;
    }
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function save(opts) {
    opts = opts || {};
    if (!opts.root) return Promise.reject(new Error(BLOCKED));
    var clone = null;
    var footer = opts.footerLine || 'Educational tool, not investment advice.';
    var name = 'Where-You-Stand-' + slug(opts.shortName) + '-' + today().iso + '.pdf';
    /* html2canvas measures a fixed-position container against the window's
       scroll offset, so a page scrolled to its results rendered two blank
       pages of nothing before the content. The window is taken to the top
       for the render and put back afterwards. */
    var sx = root.scrollX || root.pageXOffset || 0, sy = root.scrollY || root.pageYOffset || 0;
    function restore() { try { root.scrollTo(sx, sy); } catch (e) { /* nothing */ } }
    return ready().then(function (html2pdf) {
      try { root.scrollTo(0, 0); } catch (e) { /* nothing */ }
      clone = buildClone(opts);
      var svgs = Array.prototype.slice.call(clone.querySelectorAll('svg'));
      return Promise.all(svgs.map(rasterise)).then(function () {
        return html2pdf().set({
          margin: [12, 10, 16, 10],
          image: { type: 'jpeg', quality: 0.92 },
          html2canvas: { scale: 1.6, useCORS: false, backgroundColor: '#ffffff', logging: false,
                         windowWidth: 800, scrollX: 0, scrollY: 0 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['.card', '.meaning', 'tr', '.qgrid', '.stats'] }
        }).from(clone).toPdf().get('pdf').then(function (pdf) {
          if (opts.appendix && opts.appendix.rows && opts.appendix.rows.length) {
            writeAppendix(pdf, opts.appendix);
          }
          var n = pdf.internal.getNumberOfPages();
          if (root.PRCPdf.lastBuild) root.PRCPdf.lastBuild.pages = n;
          var pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
          for (var i = 1; i <= n; i++) {
            pdf.setPage(i);
            pdf.setFontSize(8);
            pdf.setTextColor(90);
            pdf.text(footer, 10, ph - 6, { maxWidth: pw - 40 });
            pdf.text('Page ' + i + ' of ' + n, pw - 10, ph - 6, { align: 'right' });
          }
          return pdf.output('blob');
        });
      });
    }).then(function (blob) {
      download(blob, name);
      return name;
    }).catch(function (err) {
      if (root.console && console.warn) console.warn('Save as PDF failed:', err);
      throw new Error(BLOCKED);
    }).then(function (v) {
      dropClone(clone); restore();
      return v;
    }, function (err) {
      dropClone(clone); restore();
      throw err;
    });
  }

  root.PRCPdf = { ready: ready, save: save, BLOCKED: BLOCKED, _build: buildClone, _drop: dropClone,
                  _rasterise: rasterise };
})(typeof window !== 'undefined' ? window : this);
