/* DOM-shim smoke test for the unified dashboard (oracle-ui.js).
 * Run: node tests/test_oracle_ui.js
 * Drives the full render path against real engine output with a minimal DOM
 * stub, so a broken data-access or formatter throws here rather than only in a
 * browser. Asserts every section renders and no NaN/undefined leaks out. */
'use strict';
const O = require('../oracle.js');
const F = require('../oracle-future.js');
const Wf = require('../oracle-workflow.js');

const captured = [];
function stubEl() {
  return new Proxy({ children: [], _html: '', classList: { add() {}, remove() {} }, dataset: {}, style: {} }, {
    get(t, p) {
      if (p === 'appendChild') return (c) => { t.children.push(c); return c; };
      if (p === 'addEventListener') return () => {};
      if (p === 'querySelectorAll') return () => [];
      if (p === 'querySelector') return () => stubEl();
      if (p === 'innerHTML') return t._html;
      if (p === 'content') return { firstElementChild: stubEl() };
      if (p === 'reset' || p === 'showModal') return () => {};
      if (p in t) return t[p];
      return undefined;
    },
    set(t, p, v) { if (p === 'innerHTML') { t._html = v; captured.push(String(v)); } else t[p] = v; return true; },
  });
}
global.window = { ORACLE: O, FUTURE: F, WORKFLOW: Wf };
global.FormData = class { get() { return null; } };
global.document = { getElementById: () => stubEl(), createElement: () => stubEl(), body: stubEl() };

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

try {
  require('../oracle-ui.js');
} catch (e) {
  console.log('  ✗ UI render threw: ' + e.message + '\n' + e.stack);
  process.exit(1);
}
const html = captured.join('\n');
const must = [
  'Unified Portfolio Health Score', 'Live Action Board', 'Dynamic Financial Freedom Number',
  'Autonomous Glide-Path', 'Valuation-Based Rebalancing', 'What-If', 'Portfolio at a glance',
  'Spendable Wealth Counter', 'Fund-by-fund X-ray', 'Zoo of Schemes', 'Hidden cost leakage',
  'DEADWOOD', 'RED FLAG', 'Book profit', 'Harvest tax now', 'Rebalance portfolio',
];
for (const m of must) ok('renders: ' + m, html.includes(m));
ok('no NaN/undefined leaked into output', !/NaN|undefined/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
