/* Where You Stand — "Save this reading", review v4 §6.
 *
 * "One tap renders the four figures, the sentence and the date as an image, on
 * the phone, for the reader's records. No fund advice on it, ever."
 *
 * Three decisions worth knowing.
 *
 * It is drawn, not screenshotted. A screenshot carries whatever else is on the
 * screen; this carries exactly the four figures, the sentence, the fund and
 * the date, and nothing can wander into it.
 *
 * It ALWAYS renders in the day palette, whatever sheet the reader is on (§6),
 * so it looks like a page from the book wherever it ends up — in a gallery, in
 * a message, printed.
 *
 * And it carries no next step and no advice. The next step is a thing to do
 * inside the tool; an image that leaves the phone should say only what was
 * measured. That is the "no fund advice on it, ever" rule, and it is why this
 * file takes a figures object rather than scraping the DOM: nothing can end up
 * on the image that was not handed to it deliberately.
 */
(function (root) {
  'use strict';

  var F = root.SimFormat;

  /* §6's day palette, fixed. Not var(--paper): a canvas has no sheet. */
  var PAPER = '#F1EFEA', INK = '#1E2433', MUTED = '#5F6779',
      MARKER = 'rgba(255,229,102,0.55)', RULE = '#B7C1D3';
  var SERIF = '"Source Serif 4","Source Serif Pro",Georgia,"Times New Roman",serif';
  var SANS = '"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

  var W = 1080, PAD = 72, SCALE = 1;

  function wrap(ctx, text, maxWidth) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], line = '';
    words.forEach(function (w) {
      var trial = line ? line + ' ' + w : w;
      if (ctx.measureText(trial).width <= maxWidth) line = trial;
      else { if (line) lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    return lines;
  }

  /* Cut to fit, with an ellipsis, so nothing can ever cross into the margin. */
  function fit(ctx, text, maxWidth) {
    var s = String(text || '');
    if (ctx.measureText(s).width <= maxWidth) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  /* reading: { fund, dateT, hero: {label, value, unit}, lines: [{what, value}],
   *            sentence }  — everything, and only what is handed over. */
  function draw(reading) {
    var inner = W - PAD * 2;

    /* measure first, so the canvas is exactly as tall as its content */
    var probe = document.createElement('canvas').getContext('2d');
    probe.font = '400 40px ' + SERIF;
    var sentenceLines = reading.sentence ? wrap(probe, reading.sentence, inner) : [];

    /* The date is the reading's own, not the day it was saved: a figure
     * without the date it was measured on is the thing the book warns about.
     * Wrapped like everything else -- it ran off the right edge as one line,
     * which is section 11's "never wider than its container" in text. */
    /* AMFI scheme names are long -- "Fund Name - Direct Plan - Growth" is the
     * short form -- so the fund wraps rather than running off the edge. */
    probe.font = '400 44px ' + SERIF;
    var fundLines = wrap(probe, reading.fund || '', inner);

    probe.font = '400 24px ' + SANS;
    var footLines = wrap(probe,
      'Measured to ' + F.date(reading.dateT) + ' · worked out on the reader’s own device · ' +
      'before tax and exit load', inner);

    var height = PAD                       /* top */
      + 34 + 20                            /* product name */
      + fundLines.length * 52 + 8           /* fund, over as many lines as it needs */
      + 26 + 34                            /* span line */
      + 30 + 96 + 30                       /* hero label + figure */
      + reading.lines.length * 78          /* the ruled lines */
      + (sentenceLines.length ? 40 + sentenceLines.length * 54 : 0)
      + 40 + footLines.length * 30          /* footer rule + its lines */
      + PAD;

    var canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = Math.round(height) * SCALE;
    var c = canvas.getContext('2d');
    c.scale(SCALE, SCALE);

    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, height);

    var y = PAD;

    c.fillStyle = MUTED;
    c.font = '400 26px ' + SANS;
    c.fillText('WHERE YOU STAND', PAD, y + 22);
    y += 34 + 20;

    c.fillStyle = INK;
    c.font = '400 44px ' + SERIF;
    fundLines.forEach(function (ln) { c.fillText(ln, PAD, y + 36); y += 52; });
    y += 8;

    c.fillStyle = MUTED;
    c.font = '400 26px ' + SANS;
    c.fillText(reading.span || '', PAD, y + 20);
    y += 26 + 34;

    /* the hero, wearing the marker exactly as the screen does */
    c.fillStyle = MUTED;
    c.font = '400 24px ' + SANS;
    c.fillText(String(reading.hero.label || '').toUpperCase(), PAD, y + 18);
    y += 30;

    c.font = '400 96px ' + SERIF;
    var heroWidth = c.measureText(reading.hero.value).width;
    c.fillStyle = MARKER;
    c.fillRect(PAD - 8, y + 12, heroWidth + 16, 84);
    c.fillStyle = INK;
    c.fillText(reading.hero.value, PAD, y + 82);
    if (reading.hero.unit) {
      c.fillStyle = MUTED;
      c.font = '400 30px ' + SANS;
      c.fillText(reading.hero.unit, PAD + heroWidth + 22, y + 82);
    }
    y += 96 + 30;

    /* the ruled lines: what it is on the left, the figure on the right */
    reading.lines.forEach(function (line) {
      c.strokeStyle = RULE;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(PAD, y + 0.5); c.lineTo(W - PAD, y + 0.5); c.stroke();
      /* The figure has the right of way: it is measured first and the label
         is truncated into whatever is left, so the two can never overlap. */
      c.font = '400 36px ' + SERIF;
      var valueWidth = c.measureText(line.value).width;
      c.fillStyle = INK;
      c.textAlign = 'right';
      c.fillText(line.value, W - PAD, y + 50);
      c.textAlign = 'left';
      c.font = '400 32px ' + SANS;
      c.fillText(fit(c, line.what, inner - valueWidth - 32), PAD, y + 50);
      y += 78;
    });

    /* the author's sentence, in the serif, exactly as on screen */
    if (sentenceLines.length) {
      y += 40;
      c.fillStyle = INK;
      c.font = '400 40px ' + SERIF;
      sentenceLines.forEach(function (ln) { c.fillText(ln, PAD, y + 32); y += 54; });
    }

    y += 40;
    c.strokeStyle = RULE;
    c.beginPath(); c.moveTo(PAD, y + 0.5); c.lineTo(W - PAD, y + 0.5); c.stroke();
    c.fillStyle = MUTED;
    c.font = '400 24px ' + SANS;
    footLines.forEach(function (ln) { c.fillText(ln, PAD, y + 30); y += 30; });

    return canvas;
  }

  function fileName(reading) {
    var fund = String(reading.fund || 'reading').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    return 'where-you-stand-' + fund.toLowerCase() + '-' + F.date(reading.dateT) + '.png';
  }

  /* Share where a phone can, save where it cannot. Both end with the image in
   * the reader's own hands and nothing sent anywhere. */
  function save(reading) {
    return new Promise(function (resolve, reject) {
      var canvas;
      try { canvas = draw(reading); }
      catch (e) { reject(new Error('This reading could not be drawn here.')); return; }
      if (!canvas.toBlob) { reject(new Error('This browser cannot save an image.')); return; }
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('This reading could not be saved.')); return; }
        var name = fileName(reading);
        var file = null;
        try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { /* older browser */ }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] })
            .then(function () { resolve('shared'); })
            .catch(function () { download(blob, name); resolve('saved'); });
          return;
        }
        download(blob, name);
        resolve('saved');
      }, 'image/png');
    });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  root.WYSReading = { draw: draw, save: save, fileName: fileName, PALETTE: { PAPER: PAPER, INK: INK } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
