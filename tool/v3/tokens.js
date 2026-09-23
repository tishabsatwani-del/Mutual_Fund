/* Where You Stand — the token sheet, review v4 §13's last deliverable.
 *
 * A token sheet that is TYPED OUT goes stale the first time a value moves, and
 * then quietly misleads whoever is designing against it. This one reads
 * theme.css itself and calls sim/format.js for every example, so the sheet and
 * the build cannot disagree: if a figure here is wrong, it is wrong in the
 * product.
 *
 * The contrast ratios are measured here too, not quoted. A number a designer
 * cannot check is a number they have to take on trust, and this whole product
 * is an argument against doing that.
 */
(function (root) {
  'use strict';

  var F = root.SimFormat;

  /* What each token is for. The values come from the stylesheet; only the
   * meanings live here, because a stylesheet cannot carry intent. */
  var MEANING = {
    '--paper':       'The page.',
    '--ink':         'The fund, and everything written.',
    '--muted':       'Glosses, axis text, the footer.',
    '--marker-band': 'The reader, by day: a band behind their ink.',
    '--marker-ink':  'The reader’s own figures.',
    '--marker-line': 'The marker drawn as a line, on the life-line.',
    '--slate':       'The comparison series only.',
    '--rule':        'A divider, allowed to be quiet.',
    '--rule-edge':   'The edge of something tappable, so 3:1.',
    '--on-ink':      'Text on an ink-filled button.'
  };

  /* Which floor each pair has to clear, and against what. */
  var NEEDS = {
    '--ink': 4.5, '--muted': 4.5, '--slate': 4.5, '--marker-ink': 4.5,
    '--rule-edge': 3, '--rule': 0
  };

  /* ------------------------------------------------------------- contrast */
  function channels(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); });
  }
  function luminance(hex) {
    return channels(hex).map(function (v) { return v / 255; })
      .map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (sum, v, i) { return sum + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b) {
    var x = luminance(a), y = luminance(b);
    if (x < y) { var t = x; x = y; y = t; }
    return (x + 0.05) / (y + 0.05);
  }
  function isHex(v) { return /^#[0-9a-f]{3,8}$/i.test(String(v || '').trim()); }

  /* ------------------------------------------------ the stylesheet, parsed
   * Both palettes are in one file but only one is ever computed at a time, so
   * the sheet is read as text rather than through getComputedStyle. That also
   * means the sheet documents what is WRITTEN, which is what a designer edits. */
  function tokensFrom(css, block) {
    var start = css.indexOf(block);
    if (start < 0) return {};
    var open = css.indexOf('{', start), depth = 0, i = open, end = -1;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    var body = css.slice(open + 1, end < 0 ? css.length : end);
    var out = {}, re = /(--[a-z-]+)\s*:\s*([^;]+);/gi, m;
    while ((m = re.exec(body))) out[m[1]] = m[2].trim();
    return out;
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function colourCell(value) {
    var td = document.createElement('td');
    if (isHex(value)) {
      var chip = el('span', 'chip-colour');
      chip.style.background = value;
      td.appendChild(chip);
    }
    td.appendChild(document.createTextNode(value));
    return td;
  }

  function ratioCell(value, paper, need) {
    var td = el('td', 'n');
    if (!isHex(value) || !isHex(paper)) { td.textContent = '—'; return td; }
    var r = ratio(value, paper);
    td.textContent = r.toFixed(2) + ':1';
    /* A divider is allowed to be quiet, so it has no floor to fail. */
    if (need) td.className = 'n ' + (r >= need ? 'pass' : 'fail');
    return td;
  }

  /* A token is measured against the ground it actually sits on. The reader's
   * own figures are ink on the composited marker band by day, not ink on
   * paper, so measuring them against paper would report a pair that never
   * appears on screen. */
  function groundFor(name, palette, band) {
    if (name === '--marker-ink' && band) return band;
    if (name === '--on-ink') return palette['--ink'];
    return palette['--paper'];
  }

  /* Which sheet each token is actually used on, read from the stylesheet
   * rather than assumed. A token nobody uses should not sit in a sheet a
   * designer is working from as though it were live. */
  function usage(css, name) {
    var dark = css.indexOf('@media (prefers-color-scheme: dark)');
    var uses = [], re = new RegExp('var\\(' + name + '[\\),]', 'g'), m;
    while ((m = re.exec(css))) uses.push(m.index);
    if (!uses.length) return 'not used';
    /* every use inside a dark block, and none outside one */
    var anyDay = uses.some(function (i) { return !insideDark(css, i); });
    var anyNight = uses.some(function (i) { return insideDark(css, i); });
    if (anyDay && anyNight) return 'both';
    return anyDay ? 'day and night' : 'night only';
  }

  function insideDark(css, index) {
    var head = css.lastIndexOf('@media (prefers-color-scheme: dark)', index);
    if (head < 0) return false;
    var depth = 0, started = false;
    for (var i = css.indexOf('{', head); i < css.length; i++) {
      if (css[i] === '{') { depth++; started = true; }
      else if (css[i] === '}') { depth--; }
      if (started && depth === 0) return index < i;
    }
    return false;
  }

  function drawColours(day, night, css) {
    var body = document.querySelector('#colours tbody');
    var band = composite(day['--marker-band'], day['--paper']);
    Object.keys(MEANING).forEach(function (name) {
      var dv = day[name], nv = night[name] || dv;
      var tr = document.createElement('tr');
      var use = usage(css, name);
      tr.appendChild(el('td', null, name));
      tr.appendChild(colourCell(dv));
      tr.appendChild(use === 'night only'
        ? el('td', 'n', 'not used by day')
        : ratioCell(dv, groundFor(name, day, band), NEEDS[name]));
      tr.appendChild(colourCell(nv));
      tr.appendChild(ratioCell(nv, groundFor(name, night, null), NEEDS[name]));
      tr.appendChild(el('td', null, MEANING[name] +
        (use === 'not used' ? ' (declared but unused)' : '')));
      body.appendChild(tr);
    });

    /* The band is translucent, so the pair that has to clear 4.5:1 is ink on
       the COMPOSITED band, and that composite is worth naming. */
    if (band) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, 'the composited band'));
      tr.appendChild(colourCell(band));
      tr.appendChild(ratioCell(day['--ink'], band, 4.5));
      tr.appendChild(el('td', null, 'n/a'));
      tr.appendChild(el('td', 'n', '—'));
      tr.appendChild(el('td', null, 'By night there is no band; the marker is the ink.'));
      body.appendChild(tr);
    }
  }

  function composite(rgba, over) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(String(rgba || ''));
    if (!m || !isHex(over)) return null;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    var base = channels(over);
    return '#' + [1, 2, 3].map(function (i) {
      var v = Math.round(+m[i] * a + base[i - 1] * (1 - a));
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  /* ------------------------------------------------------------------ type */
  function drawType(day) {
    var host = document.querySelector('#type');
    [
      ['--figure',   'figure',   '11.4%',                       'var(--serif)'],
      ['--sentence', 'sentence', 'Your number, placed.',        'var(--serif)'],
      ['--body',     'body',     'One ruled line per entry.',   'var(--sans)'],
      ['--label',    'label',    'Your speed',                  'var(--sans)']
    ].forEach(function (row) {
      var wrap = el('div', 'spec');
      var tag = el('p', 'label', row[1] + ' · ' + day[row[0]] + ' · ' + px(day[row[0]]));
      var sample = el('p', null, row[2]);
      sample.style.font = '400 ' + day[row[0]] + '/1.2 ' + row[3];
      sample.style.margin = '.2rem 0 0';
      if (row[1] === 'label') {
        sample.style.fontVariantCaps = 'all-small-caps';
        sample.style.letterSpacing = '.11em';
        sample.style.color = 'var(--muted)';
      }
      if (row[1] === 'figure') sample.style.fontVariantNumeric = 'lining-nums tabular-nums';
      wrap.appendChild(tag); wrap.appendChild(sample);
      host.appendChild(wrap);
    });

    document.querySelector('#fontstacks').innerHTML =
      '<b>Serif</b> ' + esc(day['--serif']) + '<br><b>Sans</b> ' + esc(day['--sans']) +
      '<br>The named faces are not in the repository yet, so these fall back to the system’s own ' +
      'and the page makes no external request either way. Adding the subsets is a drop-in.';
  }

  function px(rem) {
    var n = parseFloat(rem);
    return /rem$/.test(rem) ? Math.round(n * 16) + 'px' : rem;
  }
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
  }

  /* ------------------------------------------------------ spacing and radii */
  function drawMetrics() {
    var rows = [
      ['Design width', '360px', 'Phone first. 320px is the floor and is tested.'],
      ['Page margin', '20px', '.page — 1.25rem either side'],
      ['Between blocks', '32px', '.section — 1.75rem of padding above the rule'],
      ['Within a block', '12px', 'label to figure, figure to gloss'],
      ['Vertical rhythm', '8px grid', 'every spacing above is a multiple of it'],
      ['Header', '48px, one line', '.bar — name left, All tools right'],
      ['Tap target', '44px minimum', 'every control, measured in the suite at 320 and 390'],
      ['Radius', '6px', 'the two boxed things: the ledger and the reading'],
      ['Radius, small', '3px', 'chips and swatches'],
      ['Hairline', '1px', 'every rule; two grades, quiet and tappable'],
      ['Figures land', '250ms apart', 'in reading order, sentence last'],
      ['Life-line draws', 'under 1s', 'once, left to right'],
      ['Page change', '200ms fade', 'and all of it collapses to instant under reduced motion']
    ];
    var body = document.querySelector('#metrics tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, r[0]));
      tr.appendChild(el('td', 'n', r[1]));
      tr.appendChild(el('td', null, r[2]));
      body.appendChild(tr);
    });
  }

  /* --------------------------------------------------------------- numbers */
  function drawNumbers() {
    var body = document.querySelector('#numbers tbody');
    [
      ['Under ₹1,00,000', 87500],
      ['₹1 lakh to under ₹1 crore', 420000],
      ['₹1 crore to under ₹1,000 crore', 12642444],
      ['₹1,000 crore and above', 43120000000]
    ].forEach(function (row) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, row[0]));
      tr.appendChild(el('td', 'n', F.moneyWords(row[1])));
      tr.appendChild(el('td', 'n', F.money(row[1])));
      body.appendChild(tr);
    });

    var other = document.querySelector('#other-formats tbody');
    [
      ['Percentage', 'one decimal, sign closed up', F.pct(0.092)],
      ['Negative', 'a true minus (U+2212), never a hyphen', F.pct(-0.0342)],
      ['Signed', 'a plus only where it can go either way', F.pct(0.092, { signed: true })],
      ['Years', 'one decimal', F.years(5.4)],
      ['Date', 'dd-MMM-yyyy, in inputs as well as output', F.date(Date.UTC(2021, 3, 1))],
      ['A span', '"to" between dates, never a dash', F.span(Date.UTC(2021, 3, 1), Date.UTC(2026, 7, 30))],
      ['Count', 'Indian grouping', F.count(3132)],
      ['Under a rupee input', 'the helper the review asks for', F.echo(10000000)],
      ['Nothing to show', 'an em dash, never NaN or Infinity', F.money(NaN)]
    ].forEach(function (row) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, row[0]));
      tr.appendChild(el('td', null, row[1]));
      tr.appendChild(el('td', 'n', row[2]));
      other.appendChild(tr);
    });

    var caps = document.querySelector('#caps tbody');
    [['rate', 'A return'], ['stepUp', 'A step-up'], ['inflation', 'Inflation'],
     ['years', 'Years'], ['rupees', 'Any rupee amount']].forEach(function (pair) {
      var c = F.CAPS[pair[0]];
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, pair[1]));
      tr.appendChild(el('td', 'n', pair[0] === 'rupees'
        ? F.money(c.min) + ' to ' + F.moneyWords(c.max)
        : c.min + c.unit + ' to ' + c.max + c.unit));
      tr.appendChild(el('td', null, F.checkInput(pair[0], c.max + 1) || ''));
      caps.appendChild(tr);
    });
  }

  fetch('theme.css').then(function (r) { return r.text(); }).then(function (css) {
    var day = tokensFrom(css, ':root {');
    var night = tokensFrom(css, '@media (prefers-color-scheme: dark)');
    drawColours(day, night, css);
    drawType(day);
    drawMetrics();
    drawNumbers();
    document.body.dataset.ready = 'yes';
  }).catch(function () {
    document.querySelector('#main').insertAdjacentHTML('afterbegin',
      '<div class="refusal"><p>This sheet reads theme.css to build itself, and could not ' +
      'reach it. Open it from a served address rather than from a file.</p></div>');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
