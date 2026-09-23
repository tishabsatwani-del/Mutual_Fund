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
  /* ------------------------------------------------------------- a drop zone
   * The file is already on the reader's desktop; making them find it through a
   * picker is a step that exists only because the door had one shape.
   *
   * The picker STAYS. A zone that is only a zone cannot be reached from a
   * keyboard and does not exist at all on a phone, where most of these readers
   * are. Drop is the shortcut, never the way in.
   *
   * dragenter and dragleave fire again for every child element the pointer
   * crosses, so the highlight is counted in and out rather than toggled. */
  function dropzone(el, onFiles) {
    if (!el || !onFiles) return;
    var depth = 0;
    function allow(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
    el.addEventListener('dragenter', function (e) { allow(e); depth++; el.classList.add('dropping'); });
    el.addEventListener('dragover', allow);
    el.addEventListener('dragleave', function () {
      if (--depth <= 0) { depth = 0; el.classList.remove('dropping'); }
    });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      el.classList.remove('dropping');
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) onFiles(files);
    });
  }

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
    /* A space, deliberately. Both buttons are inline, and where the door's own
       markup is written by JS there is no whitespace text node between them --
       the index door on Tool 2 rendered "Load an index fundPaste two columns
       instead", run together with no gap. The door inserts this button, so the
       door owns the separation rather than depending on how each caller happens
       to have formatted its template. */
    open.parentNode.insertBefore(document.createTextNode(' '), open.nextSibling);
    open.parentNode.insertBefore(pasteOpen, open.nextSibling.nextSibling);

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
      take(Array.prototype.slice.call(e.target.files || []));
    });
    /* Dropped anywhere in the door's own box, which is the thing the reader is
       already looking at when they reach for the file. */
    dropzone(opts.dropId ? $('#' + opts.dropId) : open.parentNode, take);

    function take(picked) {
      if (!picked.length) return;
      answers = {};                       /* a new pile is a new conversation */
      chosen = picked;
      lastPaste = null;
      pasteBox.hidden = true;
      state.textContent = picked.length === 1
        ? 'Reading ' + picked[0].name + '…'
        : 'Reading ' + count(picked.length) + ' files…';
      go();
    }

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

  /* ---------------------------------------------------- the ledger's own door
   * Tool 1 and Tool 3 both let the reader hand over a list of what they paid
   * in. They had one way in each -- a textarea -- and the same forty lines of
   * handling copied between them. This is that handling, once, with two more
   * ways in: a CSV or workbook picked from disk, and the same file dropped.
   *
   * All three land on sim/upload.js's one ledger reader, so the columns are
   * found the same way, a header is recognised the same way, and the question
   * about which words mean money out is asked the same way. Nothing about the
   * reader's money is decided differently because of how the rows arrived.
   */
  function ledgerDoor(opts) {
    var openBtn = $('#' + opts.openId), box = $('#' + opts.boxId);
    var text = $('#' + opts.textId), readBtn = $('#' + opts.readId);
    var note = $('#' + opts.noteId), askPanel = $('#' + opts.askId);
    var fileOpen = $('#' + opts.fileOpenId), input = $('#' + opts.fileId);
    if (!openBtn || !box || !text || !readBtn || !note) return;

    var answers = {}, source = null, sourceName = '';

    openBtn.addEventListener('click', function () {
      box.hidden = !box.hidden;
      if (!box.hidden) text.focus();
    });
    readBtn.addEventListener('click', function () {
      answers = {};
      sourceName = '';
      begin(text.value);
    });

    if (fileOpen && input) {
      fileOpen.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function (e) {
        var picked = Array.prototype.slice.call(e.target.files || []);
        if (picked.length) fromFile(picked[0]);
      });
    }
    dropzone(opts.dropId ? $('#' + opts.dropId) : null, function (files) {
      fromFile(files[0]);
    });

    function fromFile(file) {
      answers = {};
      sourceName = file.name || '';
      say('Reading ' + (sourceName || 'that file') + '…', false);
      contentOf(file).then(function (got) {
        /* A workbook comes back as rows, a CSV as text. The ledger reader takes
           either, so neither is turned into the other on the way. */
        begin(got.rows ? got.rows : got.text);
      }).catch(function (err) { say(err.message, true); });
    }

    function begin(src) {
      source = src;
      if (typeof source === 'string' && !source.trim()) { say('', false); return; }
      run();
    }

    function run() {
      var read = root.SimUpload.ledgerRows(source, answers);
      if (askPanel) { askPanel.hidden = true; askPanel.innerHTML = ''; }

      if (read.ask === 'direction') return askDirection(read);
      if (!read.ok) return say(read.message, true);

      opts.onRows(read.rows, read);

      /* What was read, and what was not. Rows it cannot read are counted and
         shown rather than quietly dropped. */
      var said = count(read.rows.length) + (read.rows.length === 1 ? ' line read' : ' lines read');
      if (sourceName) said += ' from ' + sourceName;
      if (read.skipped) said += ', ' + count(read.skipped) + ' skipped';
      var out = read.rows.filter(function (r) { return r.dir === 'out'; }).length;
      if (out) said += '. ' + count(out) + (out === 1 ? ' is money out' : ' are money out');
      said += '.';
      if (!read.dateCertain && read.example) {
        said += ' These dates read two ways; ' + read.example.raw + ' has been read as ' +
                read.example.dayFirst + '. Check the lines above.';
      }
      say(said, false);
      text.value = '';
      box.hidden = true;
      if (input) input.value = '';
    }

    /* The words out of the reader's own file, with how many lines each one
     * covers, and nothing ticked. Ticking nothing is a real answer -- it reads
     * every line as money in, which is what the file said before this question
     * existed -- so a reader who does not recognise the column is never stuck
     * inside it. */
    function askDirection(read) {
      if (!askPanel) return say(read.message, true);
      say('', false);
      /* The rows were accepted; only their direction is outstanding. Leaving
         the paste box open pushes the question down the screen behind a
         textarea that has nothing left to say. A refusal is the opposite case
         and keeps its box, because the text in it is what needs fixing. */
      box.hidden = true;
      /* Pre-ticked from the broker dictionary, never decided by it: a word it
         does not know stays unticked, which reads as money in, exactly as it
         did before the dictionary existed. */
      var rows = read.words.map(function (w, i) {
        return '<label class="tick"><input type="checkbox" data-word="' + esc(w.word) + '"' +
          (w.guess === 'out' ? ' checked' : '') +
          ' id="' + opts.askId + '-w' + i + '">' +
          '<span>' + esc(w.word) + ' <span class="gloss">' +
          count(w.count) + (w.count === 1 ? ' line' : ' lines') +
          (w.guess ? ' \u00b7 read as money ' + w.guess : '') + '</span></span></label>';
      }).join('');
      askPanel.hidden = false;
      askPanel.innerHTML = '<div class="refusal"><p>' + esc(read.message) + '</p>' +
        '<div class="ticks">' + rows + '</div>' +
        '<p class="gloss">Anything left unticked is read as money in.</p>' +
        '<button class="primary" type="button" id="' + opts.askId + '-go">Read them this way</button>' +
        '</div>';
      $('#' + opts.askId + '-go').addEventListener('click', function () {
        var map = {};
        $$('[data-word]', askPanel).forEach(function (b) {
          map[b.dataset.word] = b.checked ? 'out' : 'in';
        });
        answers.direction = map;
        run();
      });
    }

    function say(words, refuse) {
      note.textContent = words;
      note.classList[refuse ? 'add' : 'remove']('refuse');
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
    door: door, ledgerDoor: ledgerDoor, dropzone: dropzone, contentOf: contentOf,
    view: view, go: go, start: start, render: render,
    copy: COPY
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
