/* DOM-shim smoke test for the unified dashboard (oracle-ui.js).
 * Run: node tests/test_oracle_ui.js
 * Drives the full render path against real engine output with a minimal DOM
 * stub, so a broken data-access or formatter throws here rather than only in a
 * browser. Asserts every section renders and no NaN/undefined leaks out. */
'use strict';
const O = require('../oracle.js');
const F = require('../oracle-future.js');
const Wf = require('../oracle-workflow.js');
const IO = require('../oracle-io.js');
const SIM = require('../oracle-sim.js');
const DATA = require('../oracle-data.js');
const CH = require('../oracle-charts.js');

const captured = [];
function stubEl() {
  return new Proxy({ children: [], _html: '', classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {} }, {
    get(t, p) {
      if (p === 'appendChild') return (c) => { t.children.push(c); return c; };
      if (p === 'addEventListener') return () => {};
      if (p === 'querySelectorAll') return () => [];
      if (p === 'querySelector') return () => stubEl();
      if (p === 'setAttribute' || p === 'getAttribute') return () => {};
      if (p === 'innerHTML') return t._html;
      if (p === 'content') return { firstElementChild: stubEl() };
      if (p === 'reset' || p === 'showModal') return () => {};
      if (p in t) return t[p];
      return undefined;
    },
    set(t, p, v) { if (p === 'innerHTML') { t._html = v; captured.push(String(v)); } else t[p] = v; return true; },
  });
}
global.window = { ORACLE: O, FUTURE: F, WORKFLOW: Wf, ORACLE_IO: IO, SIM, ORACLE_DATA: DATA, ORACLE_CHARTS: CH, print() {} };
global.FormData = class { get() { return null; } };
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = {
  getElementById: () => stubEl(), createElement: () => stubEl(), body: stubEl(),
  documentElement: stubEl(), querySelector: () => stubEl(), querySelectorAll: () => [],
};

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

try {
  require('../oracle-ui.js');
  // Render every tab so the smoke covers all cards, not just the default view.
  for (const t of ['current', 'future', 'actions', 'overview']) global.window.__ORACLE_UI.renderTab(t);
} catch (e) {
  console.log('  ✗ UI render threw: ' + e.message + '\n' + e.stack);
  process.exit(1);
}
const html = captured.join('\n');
const must = [
  // overview (default tab)
  'Portfolio Health', 'What to do next', 'If you sold everything today',
  // actions tab
  'Unified Portfolio Health Score', 'Live Action Board',
  // future tab
  'Dynamic Financial Freedom Number', 'Autonomous Glide-Path', 'Valuation-Based Rebalancing',
  'What-If', 'Monte Carlo projection', 'Chance of hitting your FFN', 'Your custom crash',
  // current tab
  'Portfolio at a glance', 'Spendable Wealth Counter', 'Fund-by-fund X-ray', 'Zoo of Schemes',
  'Hidden cost leakage', 'DEADWOOD', 'RED FLAG', 'Max DD', 'Sortino',
  // actions content
  'Book profit', 'Harvest tax now', 'Rebalance portfolio',
];
for (const m of must) ok('renders: ' + m, html.includes(m));
ok('no NaN/undefined leaked into output', !/NaN|undefined/.test(html));
ok('embeds SVG charts (gauge/donut/fan)', (html.match(/<svg/g) || []).length >= 4);
// Init renders the sample, which should autosave to localStorage and restore.
ok('autosaves the portfolio to localStorage', !!store['oracle.portfolio.v1']);
ok('saved portfolio round-trips back through the importer', (() => {
  try { return IO.parsePortfolioJSON(store['oracle.portfolio.v1']).holdings.length === 6; } catch (e) { return false; }
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
