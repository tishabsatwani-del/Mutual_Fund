/* Where You Stand — the parts every tool uses.
 *
 * Formatting, the copy-slot reader, the data door, and the router. Four tools
 * share one search, one data layer and one design system, so they share this.
 */
(function (root) {
  'use strict';

  var E = root.SimEngines, S = root.SimSchemes, COPY = root.SIM_COPY;

  /* Review v4 §11 and §13: every figure in the product goes through ONE
   * formatting module, and nothing is formatted at the point of use. These
   * four are thin adapters onto sim/format.js so the four screens, the older
   * tool and the workbook cannot drift apart again. */
  var F = root.SimFormat;

  function $(s, within) { return (within || document).querySelector(s); }
  function $$(s, within) { return Array.prototype.slice.call((within || document).querySelectorAll(s)); }

  function money(n) { return F.money(n); }
  function moneyWords(n) { return F.moneyWords(n); }
  function pct(r, dp) { return F.pct(r, { dp: dp }); }
  function date(t) { return F.date(t); }
  function span(a, b) { return F.span(a, b); }
  function years(y) { return F.years(y); }
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function count(n) { return F.count(n); }

  /* A slot the author has not written is NAMED on screen. A blank where a
   * sentence belongs looks like a bug; a named empty slot looks like what it
   * is, and tells whoever is reviewing exactly what to send. */
  /* Where each tool name goes when the author writes it in brackets. Her next
   * steps read "[This fund's record], and the worst window there", so the tool
   * name is the action -- it should be the thing you tap. Both apostrophes are
   * accepted, because a deck edited in a word processor will carry the curly
   * one and a deck edited in an editor will carry the straight one. */
  var TOOL_HREF = { mine: 'mine', record: 'record', stand: 'stand', plan: 'plan' };
  function toolLinks(html) {
    var names = COPY.tools || {};
    var order = [['myReturn','mine'], ['thisFundsRecord','record'],
                 ['myMoneyInThisFund','stand'], ['myPlanTested','plan']];
    order.forEach(function (pair) {
      var name = names[pair[0]];
      if (!name) return;
      var loose = esc(name).replace(/['\u2019]/g, "['\u2019]");
      html = html.replace(new RegExp('\\[' + loose + '\\]', 'g'),
        '<a href="#' + TOOL_HREF[pair[1]] + '">' + esc(name) + '</a>');
    });
    return html;
  }

  /* A slot the author has not written is NAMED on screen. A blank where a
   * sentence belongs looks like a bug; a named empty slot looks like what it
   * is, and tells whoever is reviewing exactly what to send.
   *
   * Order matters here: the text is escaped FIRST, then the engine's figures
   * are substituted in (escaped themselves), then the author's tool names
   * become links. Substituting before escaping would let a figure carry markup
   * into the page, and linkifying before escaping would have the escape eat
   * the anchor it had just written. */
  function slot(id, subs, tone) {
    var s = COPY.slots[id];
    if (s && s.text) {
      var text = esc(s.text);
      if (subs) Object.keys(subs).forEach(function (k) {
        text = text.split('[' + k + ']').join(esc(subs[k]));
      });
      return '<p class="sentence' + (tone ? ' ' + tone : '') + '">' + toolLinks(text) + '</p>';
    }
    return '<p class="slot-empty">Awaiting copy slot <code>' + esc(id) + '</code></p>';
  }

  /* Is this slot written yet? The screens print their own arithmetic beside a
   * slot only while it is empty, so a safety warning is never silent -- and
   * stand down the moment the author's sentence arrives, which is both the
   * copy rule and the word budget. */
  function written(id) {
    var s = COPY.slots[id];
    return !!(s && s.text);
  }

  /* A reading: the author's sentence where she has written one, and the
   * arithmetic plus the named slot where she has not. */
  function saying(id, subs, arithmetic, tone) {
    if (written(id)) return slot(id, subs, tone);
    return '<div class="refusal"><p>' + esc(arithmetic) + '</p>' + slot(id, subs) + '</div>';
  }

  /* ------------------------------------------------------------- the door
   *
   * Review v4 §3, settled: the tool does not fetch anything. There is one
   * door and it is the file the reader downloaded themselves, so there is no
   * provider seam here to register anything into and no search that could
   * quietly start making requests.
   *
   * The reason is said on screen rather than implied by an absence, because a
   * reader arriving from a calculator that fetches will read "load a file" as
   * this tool being less capable unless the first thing they meet is why:
   * fetching is where the failures live, and a file you downloaded is one you
   * can open and check.
   */

  /* One file into something sim/upload.js can read: text for .csv, .txt and
     .json, rows for a workbook. */
  function contentOf(file) {
    if (/\.xlsx?$/i.test(file.name || '')) {
      return root.SimWorkbook.readWorkbook(file)
        .then(function (rows) { return { name: file.name, rows: rows }; })
        .catch(function () {
          throw new Error('That Excel file could not be read here. Open it and save it as CSV, ' +
                          'then load that.');
        });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be opened.')); };
      reader.onload = function () { resolve({ name: file.name, text: String(reader.result) }); };
      reader.readAsText(file);
    });
  }

  /* --------------------------------------------------------------- the door
   *
   * Review v4 §5. Upload is the only door, so it holds a conversation rather
   * than just parsing: three of §5's rules are questions the reader is the
   * only one who can answer, and each is asked ONCE and then remembered.
   *
   * The screen supplies the ids and what to do with a loaded series; every
   * question, refusal and confirmation is handled here, so all three doors
   * behave identically and there is one place to change them.
   */
  function door(opts) {
    var open = $('#' + opts.openId), input = $('#' + opts.fileId), state = $('#' + opts.stateId);
    if (!open || !input || !state) return;
    var answers = {}, chosen = [];

    var panel = document.createElement('div');
    panel.className = 'door-ask';
    panel.hidden = true;
    state.parentNode.insertBefore(panel, state.nextSibling);

    /* ------------------------------------------------------- paste
     *
     * A reader with the NAV column already open in a spreadsheet has the data
     * in their hands and no file to give. Downloading a sheet in order to
     * upload it back is a step that exists only because the door had one shape.
     *
     * Pasted columns go through exactly the same read() as a file: the
     * day-first question, the scheme picker, the IDCW refusal, stitching and
     * the confirmation all behave identically. Excel and Sheets both put a
     * tab-separated block on the clipboard, which parse.js already scores. */
    var pasteOpen = document.createElement('button');
    pasteOpen.type = 'button';
    pasteOpen.className = 'linkish';
    pasteOpen.id = opts.fileId + '-paste-open';
    pasteOpen.textContent = 'Paste two columns instead';
    open.parentNode.insertBefore(pasteOpen, open.nextSibling);

    var pasteBox = document.createElement('div');
    pasteBox.className = 'boxed paste-box';
    pasteBox.hidden = true;
    pasteBox.innerHTML =
      '<p class="label">The date, then the NAV</p>' +
      '<textarea id="' + opts.fileId + '-paste" rows="6" spellcheck="false" ' +
      'aria-label="Paste two columns: the date, and the NAV on that date"></textarea>' +
      '<button class="primary" id="' + opts.fileId + '-paste-read" type="button">Read these</button>';
    pasteOpen.parentNode.insertBefore(pasteBox, pasteOpen.nextSibling);

    pasteOpen.addEventListener('click', function () {
      pasteBox.hidden = !pasteBox.hidden;
      if (!pasteBox.hidden) $('#' + opts.fileId + '-paste').focus();
    });
    $('#' + opts.fileId + '-paste-read').addEventListener('click', function () {
      var text = $('#' + opts.fileId + '-paste').value;
      if (!text.trim()) { state.textContent = ''; return; }
      answers = {};
      chosen = [];
      state.textContent = 'Reading what you pasted…';
      /* pasted:true so a refusal says "copy the columns", not "download the
         table" -- there is no file to download again. */
      render(root.SimUpload.read([{ name: '', pasted: true, text: text }], answers));
      lastPaste = text;
    });

    var lastPaste = null;

    open.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function (e) {
      var picked = Array.prototype.slice.call(e.target.files || []);
      if (!picked.length) return;
      answers = {};                       /* a new pile is a new conversation */
      chosen = picked;
      lastPaste = null;
      state.textContent = picked.length === 1
        ? 'Reading ' + picked[0].name + '…'
        : 'Reading ' + count(picked.length) + ' files…';
      go();
    });

    function go() {
      /* Whatever the reader gave us last -- files or a paste -- is what a
         question re-reads once they have answered it. */
      if (!chosen.length && lastPaste != null) {
        render(root.SimUpload.read([{ name: '', pasted: true, text: lastPaste }], answers));
        return;
      }
      Promise.all(chosen.map(contentOf)).then(function (files) {
        render(root.SimUpload.read(files, answers));
      }).catch(function (err) {
        panel.hidden = true;
        state.textContent = err.message;
      });
    }

    function render(v) {
      if (v.ok) {
        /* Clear it, not just hide it: a hidden panel that still holds the last
           question keeps those buttons in the document, where a keyboard and a
           screen reader can still reach them. */
        panel.hidden = true;
        panel.innerHTML = '';
        pasteBox.hidden = true;
        state.textContent = v.confirmation;
        /* A gap is not a refusal -- the series is usable -- so it is said
           beside the confirmation rather than instead of it. */
        if (v.gapMessage) {
          panel.hidden = false;
          panel.innerHTML = '<p class="gloss">' + esc(v.gapMessage) + '</p>';
        }
        opts.onLoad(v.series, v.name, v);
        return;
      }
      state.textContent = '';
      panel.hidden = false;
      if (v.ask === 'day-first') return askDayFirst(v);
      if (v.ask === 'scheme') return askScheme(v);
      if (v.ask === 'columns') return askColumns(v);
      /* a refusal is set like a reading: sentence, then what to do */
      panel.innerHTML = '<div class="refusal"><p>' + esc(v.message) + '</p></div>';
    }

    function askDayFirst(v) {
      panel.innerHTML = '<div class="refusal"><p>' + esc(v.message) + '</p>' +
        '<div class="chips"><button class="chip" type="button" data-answer="day">Day first</button>' +
        '<button class="chip" type="button" data-answer="month">Month first</button></div></div>';
      $$('[data-answer]', panel).forEach(function (b) {
        b.addEventListener('click', function () {
          answers.dayFirst = b.dataset.answer === 'day';
          go();
        });
      });
    }

    function askScheme(v) {
      var rows = [];
      v.groups.forEach(function (g) {
        rows.push('<p class="label">' + esc(g.family) + '</p>');
        g.rows.forEach(function (r) {
          rows.push('<button class="scheme" type="button" data-scheme="' + esc(r.name) + '">' +
            esc(planWords(r)) + '<span class="gloss">' + count(r.count) + ' prices</span></button>');
        });
      });
      panel.innerHTML = '<div class="refusal"><p>' + esc(v.message) + '</p>' +
        '<label class="field" for="' + opts.fileId + '-find"><span class="label">Find it by name</span>' +
        '<input type="text" id="' + opts.fileId + '-find" autocomplete="off"></label>' +
        '<div class="scheme-list">' + rows.join('') + '</div></div>';

      $$('[data-scheme]', panel).forEach(function (b) {
        b.addEventListener('click', function () {
          answers.scheme = b.dataset.scheme;
          go();
        });
      });
      var find = $('#' + opts.fileId + '-find');
      find.addEventListener('input', function () {
        var q = find.value.trim().toLowerCase();
        $$('.scheme-list > *', panel).forEach(function (el) {
          var name = (el.dataset.scheme || el.textContent || '').toLowerCase();
          el.hidden = q !== '' && name.indexOf(q) < 0;
        });
      });
    }

    /* A file whose columns cannot be found is a question, not a dead end. The
     * reader can see their own file and the tool cannot, so it shows them the
     * top of it -- each column with its own cells in it -- and asks which two
     * matter. A parser that has run out of guesses is exactly when a person is
     * fastest. */
    function askColumns(v) {
      var head = '<div class="refusal"><p>' + esc(v.message) + '</p>' +
        '<div class="scroller"><table class="ledger cols"><thead><tr>' +
        '<th>Column</th><th>Dates</th><th>NAV</th></tr></thead><tbody>';
      var body = v.columns.map(function (c) {
        var name = c.heading || ('Column ' + (c.index + 1));
        var hint = c.samples.join(' · ');
        return '<tr><td><b>' + esc(name) + '</b>' +
          '<br><span class="gloss">' + esc(hint) + '</span></td>' +
          '<td class="n"><input type="radio" name="' + opts.fileId + '-d" value="' + c.index + '"' +
            (c.index === v.guess.dateCol ? ' checked' : '') +
            ' aria-label="' + esc(name) + ' holds the dates"></td>' +
          '<td class="n"><input type="radio" name="' + opts.fileId + '-v" value="' + c.index + '"' +
            (c.index === v.guess.valueCol ? ' checked' : '') +
            ' aria-label="' + esc(name) + ' holds the NAV"></td></tr>';
      }).join('');
      panel.innerHTML = head + body + '</tbody></table></div>' +
        '<p class="gloss" id="' + opts.fileId + '-cols-note" aria-live="polite"></p>' +
        '<button class="primary" id="' + opts.fileId + '-cols-go" type="button">Read it this way</button>' +
        '</div>';

      $('#' + opts.fileId + '-cols-go').addEventListener('click', function () {
        var d = panel.querySelector('input[name="' + opts.fileId + '-d"]:checked');
        var val = panel.querySelector('input[name="' + opts.fileId + '-v"]:checked');
        var note = $('#' + opts.fileId + '-cols-note');
        if (!d || !val) { note.textContent = 'Point at one column of dates and one of NAVs.'; return; }
        if (d.value === val.value) { note.textContent = 'The dates and the NAVs are different columns.'; return; }
        answers.dateCol = +d.value;
        answers.valueCol = +val.value;
        go();
      });
    }

    /* "Direct · Growth" reads faster than the whole scheme name repeated four
       times, and plan and option are the only thing that differs inside a
       family. */
    function planWords(r) {
      var plan = r.plan === 'direct' ? 'Direct' : r.plan === 'regular' ? 'Regular' : '';
      var option = r.option === 'growth' ? 'Growth' : r.option === 'idcw' ? 'IDCW' : '';
      var said = [plan, option].filter(Boolean).join(' · ');
      return said || r.name;
    }
  }

  /* --------------------------------------------------------------- routing */
  var views = {};
  function view(name, fns) { views[name] = fns; }

  function go(name) {
    if (location.hash.slice(1) !== name) { location.hash = name; return; }
    render();
  }

  function render() {
    var name = location.hash.slice(1) || 'home';
    if (!views[name]) name = 'home';
    /* Scoped to the sections inside main. An unscoped [data-view] also matches
       <body>, which carries the same attribute as a styling hook — and hiding
       the body hides the whole page. */
    $$('#main > [data-view]').forEach(function (el) { el.hidden = el.dataset.view !== name; });
    var back = $('#back');
    if (back) back.hidden = name === 'home';
    if (views[name].enter) views[name].enter();
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }

  function start() {
    window.addEventListener('hashchange', render);
    var back = $('#back');
    if (back) back.addEventListener('click', function () { location.hash = 'home'; });
    render();
  }

  /* One orchestrated moment: the figures land in reading order, 250ms apart. */
  function land(i) { return ' class="land" style="animation-delay:' + (i * 250) + 'ms"'; }

  root.WYS = {
    $: $, $$: $$, money: money, moneyWords: moneyWords, pct: pct, date: date,
    span: span, years: years, esc: esc, count: count, checkInput: F.checkInput, echo: F.echo,
    slot: slot, saying: saying, written: written, land: land,
    door: door, contentOf: contentOf,
    view: view, go: go, start: start, render: render,
    copy: COPY
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
