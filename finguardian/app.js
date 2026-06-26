/* ===========================================================================
   FinGuardian AI — interactive prototype
   ---------------------------------------------------------------------------
   A single-file, dependency-free SPA that demonstrates the eight product
   pillars of the FinGuardian AI spec on top of a (simulated) 100% serverless,
   event-driven AWS architecture.

   There is NO live backend. Every figure shown is computed here, in the
   browser, from on-screen inputs — the finance functions are deliberately
   small and commented so any number can be reproduced by reading the code.

   This file is wholly independent of the sibling "Two Doors, One Storm" app
   at the repo root; it shares no globals, styles, or markup with it.
   =========================================================================== */
(function () {
  "use strict";

  /* ----------------------------------------------------------------------- *
   * 0. Tiny helpers
   * ----------------------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // Indian-grouped rupee formatting: 1234567 -> "₹12,34,567".
  function fmtINR(n) {
    const neg = n < 0; n = Math.round(Math.abs(n));
    const s = String(n);
    let out;
    if (s.length <= 3) out = s;
    else {
      const last3 = s.slice(-3);
      let rest = s.slice(0, -3);
      rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
      out = rest + "," + last3;
    }
    return (neg ? "-₹" : "₹") + out;
  }
  // Compact rupees: ₹1.24 Cr / ₹8.50 L / ₹4,500.
  function fmtShort(n) {
    const neg = n < 0; const a = Math.abs(n);
    let v;
    if (a >= 1e7) v = (a / 1e7).toFixed(2) + " Cr";
    else if (a >= 1e5) v = (a / 1e5).toFixed(2) + " L";
    else return fmtINR(n);
    return (neg ? "-₹" : "₹") + v;
  }
  const pct = (x, d = 1) => (x >= 0 ? "" : "") + x.toFixed(d) + "%";

  /* ----------------------------------------------------------------------- *
   * 1. Finance engine — small, exact, auditable
   * ----------------------------------------------------------------------- */
  const annualToMonthly = (a) => Math.pow(1 + a, 1 / 12) - 1; // exact 12th-root, not a/12

  // Future value of a level monthly SIP, contributions at START of month
  // (annuity-due). n = months, i = monthly rate.
  function sipFV(sip, annual, years) {
    const i = annualToMonthly(annual), n = Math.round(years * 12);
    if (i === 0) return sip * n;
    return sip * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
  }
  // Future value of a one-time lump sum.
  function lumpFV(p, annual, years) {
    return p * Math.pow(1 + annualToMonthly(annual), Math.round(years * 12));
  }

  /* ----------------------------------------------------------------------- *
   * 2. Pillar catalogue
   *    Each pillar declares its identity + a render() returning HTML, and an
   *    optional mount(root) to wire interactivity after insertion.
   * ----------------------------------------------------------------------- */
  const PILLARS = [];
  const reg = (p) => { PILLARS.push(p); };

  const awsChips = (arr) => arr.map((c) => `<span class="chip">${esc(c)}</span>`).join("");

  /* === Pillar A — Family Wealth Cloud & Dynamic Consent ================== */
  reg({
    id: "family",
    icon: "👨‍👩‍👧",
    tag: "PILLAR A",
    title: "Family Wealth Cloud & Dynamic Consent",
    blurb: "One household, one consolidated portfolio — with privacy enforced by an explicit digital handshake.",
    aws: ["DynamoDB · PK FamilyID / SK UserID", "Step Functions (consent)", "Cognito", "SNS · WhatsApp"],
    intro: "A single DynamoDB table maps a multi-generational household. The <b>Family ID</b> is the partition key and the <b>User ID</b> is the sort key, so one query returns the whole family. Roles are enforced everywhere, and no member can ever redeem or move another member's assets. To view someone else's portfolio you must request consent — a Step Functions workflow pushes the request, and access opens only after an explicit approval.",
    render() {
      const members = [
        { id: "U#meera",  name: "Meera Rao",   role: "Admin",     emoji: "👩", worth: 8240000, you: true },
        { id: "U#arun",   name: "Arun Rao",    role: "Co-Owner",  emoji: "👨", worth: 6130000 },
        { id: "U#latha",  name: "Latha Rao",   role: "View-Only", emoji: "👵", worth: 3420000 },
        { id: "U#kabir",  name: "Kabir Rao",   role: "Minor",     emoji: "🧒", worth: 540000 },
      ];
      const total = members.reduce((s, m) => s + m.worth, 0);
      // simple consolidated asset mix
      const mix = [
        { k: "Equity", v: 0.58, c: "var(--guard)" },
        { k: "Debt",   v: 0.30, c: "var(--cool)" },
        { k: "Gold",   v: 0.12, c: "var(--gold)" },
      ];
      const roleBadge = (r) => {
        const cls = r === "Admin" ? "ok" : r === "Co-Owner" ? "cool" : r === "Minor" ? "warn" : "muted";
        return `<span class="badge ${cls}">${esc(r)}</span>`;
      };
      const bar = mix.map((m) => `<i style="width:${(m.v * 100).toFixed(0)}%;background:${m.c}"></i>`).join("");
      const rows = members.map((m) => `
        <div class="row-item" data-member="${esc(m.id)}">
          <div class="avatar">${m.emoji}</div>
          <div class="meta"><b>${esc(m.name)}</b> ${roleBadge(m.role)}
            <span class="member-line">${m.you ? "You · full access" : "consent required to view holdings"}</span></div>
          <div>${m.you
            ? `<span class="badge ok">visible</span>`
            : `<button class="chip-btn req" data-name="${esc(m.name)}">Request view</button>`}</div>
        </div>`).join("");

      return `
      <div class="panel">
        <h3>The Rao household · <span class="mono faint">FamilyID = FAM#rao-2007</span></h3>
        <p class="panel-note">One DynamoDB partition. One query (<span class="mono">FamilyID = :fam</span>) returns every member, ordered by UserID.</p>
        <div class="metrics mb">
          <div class="metric"><div class="k">Consolidated net worth</div><div class="v gold">${fmtShort(total)}</div><div class="sub">across 4 members</div></div>
          <div class="metric"><div class="k">Members</div><div class="v cool">4</div><div class="sub">2 generations</div></div>
          <div class="metric"><div class="k">Tax-harvest signals</div><div class="v green">2</div><div class="sub">joint LTCG headroom</div></div>
        </div>
        <label class="fld">Consolidated allocation (equity · debt · gold)</label>
        <div class="bar" style="height:14px">${bar}</div>
        <div class="row small faint mt-s">
          ${mix.map((m) => `<span><span class="dot" style="background:${m.c}"></span> ${m.k} ${(m.v * 100).toFixed(0)}%</span>`).join("&nbsp;&nbsp;")}
        </div>
      </div>

      <div class="panel">
        <h3>Members &amp; roles</h3>
        <p class="panel-note">Roles are enforced server-side. A View-Only or Minor account can never initiate a redemption — for anyone.</p>
        ${rows}
        <div id="consent-stage" class="mt" hidden></div>
      </div>

      <div class="panel">
        <h3>Guardrail check</h3>
        <p class="muted small mb">Try to move another member's money — the engine refuses by design.</p>
        <button class="btn warn" id="try-move">⛔ Attempt: redeem Arun's ₹5,00,000</button>
        <div id="move-result" class="mt"></div>
      </div>`;
    },
    mount(root) {
      // Consent handshake = a tiny Step Functions-style state machine.
      $$(".req", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-name");
          const stage = $("#consent-stage", root);
          stage.hidden = false;
          stage.innerHTML = `
            <div class="callout">
              <b>Consent request → ${esc(name)}</b>
              <ol class="steps mt-s" id="consent-steps">
                <li class="active"><b>StartConsentRequest</b><p>Step Functions execution opened.</p></li>
                <li><b>NotifyMember</b><p>Push sent via WhatsApp + in-app.</p></li>
                <li><b>AwaitDigitalHandshake</b><p>Waiting for ${esc(name)} to approve…</p></li>
                <li><b>GrantScopedReadAccess</b><p>Read-only, time-boxed, audit-logged.</p></li>
              </ol>
              <div class="row mt-s">
                <button class="btn" id="approve">✅ ${esc(name)} approves</button>
                <button class="btn ghost" id="deny">Deny</button>
              </div>
            </div>`;
          const steps = $$("#consent-steps li", stage);
          let i = 0;
          const advance = () => {
            if (i < steps.length - 1) {
              steps[i].classList.remove("active"); steps[i].classList.add("done");
              i++; steps[i].classList.add("active");
            }
          };
          const t1 = setTimeout(advance, 600);
          const t2 = setTimeout(advance, 1300);
          $("#approve", stage).addEventListener("click", () => {
            clearTimeout(t1); clearTimeout(t2);
            steps.forEach((s) => { s.classList.remove("active"); s.classList.add("done"); });
            stage.innerHTML = `<div class="callout"><b>✅ Access granted</b><br>
              <span class="muted small">${esc(name)}'s holdings are now visible to you — read-only, logged to CloudTrail, and revocable. No move/redeem rights were granted.</span></div>`;
          });
          $("#deny", stage).addEventListener("click", () => {
            clearTimeout(t1); clearTimeout(t2);
            stage.innerHTML = `<div class="callout alert"><b>⛔ Consent denied</b><br>
              <span class="muted small">${esc(name)} declined. Nothing was shared. The request is sealed in the audit log.</span></div>`;
          });
        });
      });

      $("#try-move", root).addEventListener("click", () => {
        $("#move-result", root).innerHTML = `
          <div class="callout alert">
            <b>⛔ Denied — AuthorizationViolation</b>
            <p class="muted small mt-s">Asset ownership is bound to the owning <span class="mono">UserID</span>. A redemption is only ever authorised when the requesting Cognito identity <em>equals</em> the asset's owner. Cross-member moves are structurally impossible — and the attempt is now immutable in CloudTrail.</p>
          </div>`;
      });
    },
  });

  /* === Pillar B — AI Regulatory Watchdog ================================= */
  reg({
    id: "regwatch",
    icon: "📜",
    tag: "PILLAR B",
    title: "AI Regulatory Watchdog",
    blurb: "Nightly scans of SEBI / AMFI / Income-Tax portals. Bedrock parses new rules; an admin approves; config updates live — no redeploy.",
    aws: ["EventBridge (nightly)", "Lambda · scrapers", "Amazon Bedrock (Claude)", "DynamoDB · config", "Human-in-the-loop"],
    intro: "Every night an EventBridge schedule fans out Lambda crawlers across the official portals. When a new circular or budget PDF appears, an Amazon Bedrock agent parses it into an exact, structured rule change. Nothing goes live automatically: the change becomes an interactive approval card. The instant an administrator clicks <b>Approve</b>, the global configuration table updates — the app's tax maths changes <em>without</em> a code deployment.",
    render() {
      return `
      <div class="panel">
        <h3>Tonight's scan · <span class="mono faint">2026-06-26 02:00 IST</span></h3>
        <p class="panel-note">EventBridge → Lambda crawlers → Bedrock parse. One new circular detected, awaiting human approval.</p>
        <ol class="steps">
          <li class="done"><b>EventBridge fired</b><p>Nightly rule <span class="mono">reg-scan-nightly</span> invoked 3 crawlers.</p></li>
          <li class="done"><b>Crawled portals</b><p>incometax.gov.in · sebi.gov.in · amfiindia.com — 1 new document on SEBI.</p></li>
          <li class="done"><b>Bedrock parsed the PDF</b><p>Extracted a structured diff to the LTCG exemption.</p></li>
          <li class="active"><b>Human-in-the-loop</b><p>Proposed config change is waiting for an administrator.</p></li>
        </ol>
      </div>

      <div class="panel" id="approval-card">
        <div class="row"><span class="badge cool">Bedrock · structured extraction</span><span class="badge warn">action required</span></div>
        <h3 class="mt-s">Circular: LTCG exemption threshold revised</h3>
        <p class="muted small">Source: <span class="mono">SEBI/Budget circular · equity LTCG</span> · confidence 0.94</p>
        <table class="tbl mt">
          <tr><th>Config key</th><th>Current</th><th>Proposed</th></tr>
          <tr><td class="mono">ltcg.equity.exemption</td><td class="num">₹1,00,000</td><td class="num" style="color:var(--guard)">₹1,25,000</td></tr>
          <tr><td class="mono">ltcg.equity.rate</td><td class="num">10.0%</td><td class="num" style="color:var(--guard)">12.5%</td></tr>
        </table>
        <div class="callout warn mt">A change here re-prices tax-harvesting suggestions for <b>every</b> user. Approve only after verifying against the source document.</div>
        <div class="row mt">
          <button class="btn" id="approve-reg">✅ Approve &amp; publish config</button>
          <button class="btn ghost" id="reject-reg">Reject</button>
          <a class="btn ghost" href="#" id="view-src">View source ↗</a>
        </div>
      </div>

      <div class="panel">
        <h3>Live impact preview</h3>
        <p class="panel-note">Worked example: ₹3,00,000 of booked equity LTCG in FY.</p>
        <div id="reg-preview"></div>
      </div>`;
    },
    mount(root) {
      const gain = 300000;
      const calc = (exempt, rate) => Math.max(0, gain - exempt) * rate;
      const render = (exempt, rate, live) => {
        const tax = calc(exempt, rate);
        $("#reg-preview", root).innerHTML = `
          <div class="metrics">
            <div class="metric"><div class="k">Exemption</div><div class="v">${fmtINR(exempt)}</div></div>
            <div class="metric"><div class="k">Rate</div><div class="v">${(rate * 100).toFixed(1)}%</div></div>
            <div class="metric"><div class="k">Tax on ₹3,00,000 gain</div><div class="v ${live ? "green" : "gold"}">${fmtINR(tax)}</div>
              <div class="sub">${live ? "using the published config" : "using the current config"}</div></div>
          </div>`;
      };
      render(100000, 0.10, false);
      $("#approve-reg", root).addEventListener("click", () => {
        $("#approval-card", root).innerHTML = `
          <div class="callout"><b>✅ Config published</b>
          <p class="muted small mt-s">DynamoDB config table updated atomically. All Lambdas read the new values on their next invocation — <b>zero deployment</b>, zero downtime. Change recorded in CloudTrail with the approver's identity.</p></div>`;
        render(125000, 0.125, true);
      });
      $("#reject-reg", root).addEventListener("click", () => {
        $("#approval-card", root).innerHTML = `<div class="callout alert"><b>Rejected</b><p class="muted small mt-s">No config changed. The extraction is archived for review.</p></div>`;
      });
      $("#view-src", root).addEventListener("click", (e) => { e.preventDefault(); alert("In production this opens the cached source PDF that Bedrock parsed, with the extracted clauses highlighted."); });
    },
  });

  /* === Pillar C — KYC Health Watchdog ==================================== */
  reg({
    id: "kyc",
    icon: "🩺",
    tag: "PILLAR C",
    title: "KYC Health Watchdog",
    blurb: "Polls KRA APIs (CVL, NDML) for every family member and catches a looming 'Hold' months before it can freeze a SIP.",
    aws: ["Lambda · KRA pollers", "DynamoDB · KYC status", "EventBridge", "SNS · WhatsApp", "Secrets Manager"],
    intro: "The backend continuously polls the KYC Registration Agencies (CVL, NDML) for every linked member. An administrative issue — an unlinked PAN–Aadhaar, an address mismatch — can silently flip an account to <b>Hold</b> or <b>Suspended</b> and freeze active SIPs. The watchdog spots the early signal and sends a one-tap re-verification link long before anything stops.",
    render() {
      return `
      <div class="panel">
        <h3>KYC fleet status</h3>
        <p class="panel-note">Last poll cycle: just now · sources CVL + NDML. Click “Run poll” to re-check.</p>
        <div id="kyc-list"></div>
        <button class="btn ghost mt" id="poll">↻ Run poll cycle</button>
      </div>
      <div class="panel">
        <h3>Why it matters</h3>
        <p class="muted small">A frozen KYC silently rejects every SIP instalment until fixed. Catching the <span class="mono">PAN_AADHAAR_UNLINKED</span> signal early — while the account is still <b>Active</b> — keeps compounding uninterrupted. The fix link is pre-filled and deep-linked to the right KRA flow.</p>
      </div>`;
    },
    mount(root) {
      const fleet = [
        { name: "Meera Rao", pan: "ABCPR1234A", status: "Active", note: "All checks pass", risk: "ok", days: null },
        { name: "Arun Rao",  pan: "ABCPR5678B", status: "At risk", note: "PAN–Aadhaar link expires in 47 days", risk: "warn", days: 47 },
        { name: "Latha Rao", pan: "ABCPR9012C", status: "Active", note: "All checks pass", risk: "ok", days: null },
        { name: "Kabir Rao (minor)", pan: "—", status: "Guardian-linked", note: "No action needed", risk: "muted", days: null },
      ];
      const draw = () => {
        $("#kyc-list", root).innerHTML = fleet.map((m, idx) => {
          const dotCls = m.risk === "ok" ? "ok" : m.risk === "warn" ? "alert" : "warn";
          const badge = m.risk === "ok" ? `<span class="badge ok">Active</span>`
            : m.risk === "warn" ? `<span class="badge warn">${esc(m.status)}</span>`
            : `<span class="badge muted">${esc(m.status)}</span>`;
          return `
          <div class="row-item">
            <span class="dot ${dotCls}"></span>
            <div class="meta"><b>${esc(m.name)}</b> ${badge}
              <span>${esc(m.note)} · <span class="mono faint">PAN ${esc(m.pan)}</span></span></div>
            ${m.risk === "warn" ? `<button class="chip-btn fix" data-i="${idx}">Send re-verify link</button>` : ""}
          </div>`;
        }).join("");
        $$(".fix", root).forEach((b) => b.addEventListener("click", () => {
          const i = +b.getAttribute("data-i");
          fleet[i].risk = "ok"; fleet[i].status = "Active"; fleet[i].note = "Re-verification link sent · status will refresh on confirmation";
          draw();
          const c = document.createElement("div"); c.className = "callout mt";
          c.innerHTML = `<b>📲 WhatsApp sent to ${esc(fleet[i].name)}</b><span class="muted small"> — a deep link straight to the CVL re-KYC flow. SIPs keep running while it's resolved.</span>`;
          $("#kyc-list", root).after(c);
          setTimeout(() => c.remove(), 4200);
        }));
      };
      draw();
      $("#poll", root).addEventListener("click", () => {
        const btn = $("#poll", root); btn.textContent = "Polling CVL + NDML…"; btn.disabled = true;
        setTimeout(() => { btn.textContent = "↻ Run poll cycle"; btn.disabled = false; draw(); }, 900);
      });
    },
  });

  /* === Pillar D — Automated Legal Claim Engine (Dead Man's Switch) ======= */
  reg({
    id: "deadman",
    icon: "🗝️",
    tag: "PILLAR D",
    title: "Legacy Vault & Dead Man's Switch",
    blurb: "After 180 days of silence, a 15-day countdown with three check-ins. If unanswered, transmission paperwork is pre-filled for the nominee.",
    aws: ["Step Functions (long-running)", "EventBridge timers", "Lambda · doc generator", "Bedrock", "S3 · secure package", "KMS"],
    intro: "Asset transmission is one of the cruellest bureaucratic ordeals a grieving family faces. FinGuardian watches for total inactivity. After <b>180 days</b> of zero interaction, a Step Functions workflow opens a <b>15-day</b> window with three automated security check-ins. If every one goes unanswered, the Dead Man's Switch activates — and instead of a bare summary, the engine pre-fills the mandatory mutual-fund transmission paperwork (Form T3, indemnity bond, per-AMC letters) into a print-ready package the nominee only has to sign.",
    render() {
      return `
      <div class="panel">
        <h3>Inactivity monitor</h3>
        <p class="panel-note">Drag the timeline to simulate days of silence. Tapping any check-in resets everything — exactly as a living user would.</p>
        <div class="field-row" style="margin-bottom:8px">
          <div>
            <label class="fld">Days since last interaction · <span class="range-val" id="dlbl">0</span></label>
            <input type="range" id="days" min="0" max="200" value="0" />
          </div>
        </div>
        <div id="dm-state"></div>
      </div>
      <div class="panel" id="dm-detail"></div>`;
    },
    mount(root) {
      const slider = $("#days", root);
      const checkins = [185, 190, 195]; // days on which security check-ins fire
      let answered = {}; // checkin index -> true

      const render = () => {
        const d = +slider.value;
        $("#dlbl", root).textContent = d;
        const state = $("#dm-state", root);
        const detail = $("#dm-detail", root);

        if (d < 180) {
          const togo = 180 - d;
          state.innerHTML = `
            <div class="callout"><b><span class="dot ok"></span> Account healthy</b>
            <span class="muted small"> — ${togo} days of silence away from the first alert. Any login, tap or SIP debit resets this to zero.</span></div>
            <div class="bar mt"><i style="width:${(d / 180 * 100).toFixed(1)}%"></i></div>`;
          detail.innerHTML = `<h3>Legacy vault</h3><p class="muted small">Nominee on file: <b>Latha Rao</b> (mother). Paperwork templates ready: Form T3, indemnity bond, 4 AMC letters. Nothing is generated until the switch arms.</p>`;
          return;
        }

        // 180+ : countdown window of 15 days, three check-ins at 185/190/195
        const dayInWindow = d - 180;
        const remaining = 15 - dayInWindow;
        const fired = checkins.filter((c) => d >= c);
        const unanswered = fired.filter((c, i) => !answered[checkins.indexOf(c)]);
        const allUnanswered = d >= 195 && checkins.every((c, i) => !answered[i]);

        state.innerHTML = `
          <div class="callout ${allUnanswered ? "alert" : "warn"}">
            <b>${allUnanswered ? "🔴 Dead Man's Switch ARMED" : "⚠️ Inactivity protocol engaged"}</b>
            <span class="muted small"> — 180 days of silence reached. ${allUnanswered ? "All three check-ins went unanswered." : `${remaining > 0 ? remaining : 0} days left in the grace window.`}</span>
          </div>
          <div class="clock ${allUnanswered ? "" : "calm"} mt">${allUnanswered ? "00 : 00" : String(Math.max(0, remaining)).padStart(2, "0") + " : days"}</div>
          <ol class="steps mt">
            ${checkins.map((c, i) => {
              const reached = d >= c;
              const ans = answered[i];
              const cls = ans ? "done" : reached ? "active" : "";
              return `<li class="${cls}"><b>Check-in ${i + 1} · day ${c - 180} of 15</b>
                <p>${ans ? "Answered — protocol cancelled." : reached ? "Sent via SMS + email + WhatsApp, awaiting reply." : "Scheduled."}
                ${reached && !ans ? `<button class="chip-btn answer" data-i="${i}">I'm here — cancel</button>` : ""}</p></li>`;
            }).join("")}
          </ol>`;

        $$(".answer", state).forEach((b) => b.addEventListener("click", () => {
          // any reply means the user is alive: reset the whole thing
          answered = {}; slider.value = 0; render();
        }));

        if (allUnanswered) {
          detail.innerHTML = `
            <h3>📦 Transmission package generated</h3>
            <p class="muted small">A Lambda assembled the historical holdings; Bedrock pre-filled every mandatory form. Encrypted with the family's KMS key and delivered to the nominee — <b>print, sign, submit.</b> Months of bureaucracy compressed to minutes.</p>
            <table class="tbl mt">
              <tr><th>Document</th><th>Status</th></tr>
              <tr><td>Form T3 — transmission request</td><td><span class="badge ok">pre-filled</span></td></tr>
              <tr><td>Indemnity bond (₹ stamp noted)</td><td><span class="badge ok">pre-filled</span></td></tr>
              <tr><td>AMC letters × 4 (folio-wise)</td><td><span class="badge ok">pre-filled</span></td></tr>
              <tr><td>Consolidated holdings statement</td><td><span class="badge ok">attached</span></td></tr>
              <tr><td>Nominee KYC checklist</td><td><span class="badge warn">signatures pending</span></td></tr>
            </table>
            <button class="btn block mt" onclick="alert('In production this streams a secure, watermarked PDF bundle to the nominee from S3 via a one-time KMS-decrypted link.')">⬇ Download print-ready package</button>`;
        } else {
          detail.innerHTML = `<h3>Holding</h3><p class="muted small">The package is <b>not</b> generated yet. It is only ever produced if all three check-ins lapse — protecting a living user who is simply on a long break.</p>`;
        }
      };
      slider.addEventListener("input", render);
      render();
    },
  });

  /* === Pillar E — Buy-the-Dip & Dynamic De-risking ======================= */
  reg({
    id: "buydip",
    icon: "📉",
    tag: "PILLAR E",
    title: "Buy-the-Dip & Dynamic De-risking",
    blurb: "Idle cash parked in liquid funds. A 4%+ fall from the 52-week high triggers an STP into equity. Goals glide to safety as they mature.",
    aws: ["EventBridge · 4:00 PM IST", "Lambda · index check", "Step Functions · STP", "DynamoDB", "SQS"],
    intro: "Lump-sum capital waits safely in a liquid fund instead of being thrown at the market. Every trading day at <b>4:00 PM IST</b> a Lambda checks the index against its 52-week high. A fall of <b>4% or more</b> automatically triggers a Systematic Transfer Plan into the chosen equity fund. Separately, as a goal enters its final two years the engine glides capital out of equity into debt — so a last-minute crash can't gut a life savings.",
    render() {
      return `
      <div class="panel">
        <h3>Buy-the-Dip engine · daily 4:00 PM IST check</h3>
        <p class="panel-note">52-week high is fixed at 24,000. Drag today's index — at −4% or deeper, the STP fires.</p>
        <div class="field-row" style="margin-bottom:8px">
          <div>
            <label class="fld">Today's index level · <span class="range-val" id="ilbl">24000</span></label>
            <input type="range" id="idx" min="18000" max="24000" value="24000" step="50" />
          </div>
          <div>
            <label class="fld">Idle liquid-fund cash</label>
            <div class="chips" id="cash-chips">
              <button class="chip-btn on" data-v="500000">₹5 L</button>
              <button class="chip-btn" data-v="1000000">₹10 L</button>
              <button class="chip-btn" data-v="2500000">₹25 L</button>
            </div>
          </div>
        </div>
        <div id="dip-state"></div>
      </div>

      <div class="panel">
        <h3>Dynamic goal de-risking · glide path</h3>
        <p class="panel-note">As a goal nears maturity, equity is rotated into debt automatically. Drag the years-to-goal.</p>
        <div class="field-row" style="margin-bottom:8px">
          <div>
            <label class="fld">Years to goal · <span class="range-val" id="glbl">5</span></label>
            <input type="range" id="yrs" min="0" max="8" value="5" step="0.5" />
          </div>
        </div>
        <div id="glide-state"></div>
      </div>`;
    },
    mount(root) {
      const HIGH = 24000;
      let cash = 500000;
      const idx = $("#idx", root);

      const renderDip = () => {
        const lvl = +idx.value;
        $("#ilbl", root).textContent = lvl.toLocaleString("en-IN");
        const dd = (lvl - HIGH) / HIGH * 100; // negative = drawdown
        const fire = dd <= -4;
        // tranche sizing: deeper falls deploy more (4-7% → 25%, 7-12% → 50%, >12% → 100%)
        let tranche = 0;
        if (fire) tranche = dd <= -12 ? 1 : dd <= -7 ? 0.5 : 0.25;
        const amt = Math.round(cash * tranche);
        $("#dip-state", root).innerHTML = `
          <div class="metrics">
            <div class="metric"><div class="k">Drawdown from 52-wk high</div><div class="v ${fire ? "red" : ""}">${dd.toFixed(1)}%</div></div>
            <div class="metric"><div class="k">Trigger (≤ −4%)</div><div class="v ${fire ? "green" : ""}">${fire ? "ARMED" : "idle"}</div></div>
            <div class="metric"><div class="k">STP this cycle</div><div class="v gold">${fmtShort(amt)}</div><div class="sub">${(tranche * 100).toFixed(0)}% of idle cash</div></div>
          </div>
          <div class="callout ${fire ? "" : "warn"} mt">
            ${fire
              ? `<b>✅ STP triggered.</b> A Step Functions execution moves ${fmtShort(amt)} from the liquid fund into equity — buying cheaper units while the market is fearful. SQS buffers the order if the RTA is slow.`
              : `<b>No action.</b> The market is within 4% of its high; capital stays safe in the liquid fund earning a steady return. The engine re-checks tomorrow at 4 PM.`}
          </div>`;
      };
      idx.addEventListener("input", renderDip);
      $$("#cash-chips .chip-btn", root).forEach((b) => b.addEventListener("click", () => {
        $$("#cash-chips .chip-btn", root).forEach((x) => x.classList.remove("on"));
        b.classList.add("on"); cash = +b.getAttribute("data-v"); renderDip();
      }));
      renderDip();

      // glide path
      const yrs = $("#yrs", root);
      const renderGlide = () => {
        const y = +yrs.value;
        $("#glbl", root).textContent = y;
        // outside the final 2 years: 80/20 equity/debt. Inside: glide linearly to 10/90 at maturity.
        let eq;
        if (y >= 2) eq = 0.80;
        else eq = 0.10 + (y / 2) * (0.80 - 0.10); // 0y -> 10%, 2y -> 80%
        const debt = 1 - eq;
        const active = y < 2;
        $("#glide-state", root).innerHTML = `
          <div class="bar" style="height:16px"><i style="width:${(eq * 100).toFixed(0)}%;background:var(--guard)"></i></div>
          <div class="row small faint mt-s">
            <span><span class="dot" style="background:var(--guard)"></span> Equity ${(eq * 100).toFixed(0)}%</span>&nbsp;&nbsp;
            <span><span class="dot" style="background:var(--cool)"></span> Debt / liquid ${(debt * 100).toFixed(0)}%</span>
          </div>
          <div class="callout ${active ? "" : "warn"} mt">
            ${active
              ? `<b>🛡️ Glide active.</b> Inside the final two years — equity is being rotated into debt automatically, shielding the corpus from a last-minute correction.`
              : `<b>Full-growth phase.</b> More than 2 years out, the goal stays growth-tilted (80% equity). The glide begins automatically at the 2-year mark.`}
          </div>`;
      };
      yrs.addEventListener("input", renderGlide);
      renderGlide();
    },
  });

  /* === Pillar F — Hidden Commission Scanner ============================== */
  reg({
    id: "commission",
    icon: "🔎",
    tag: "PILLAR F",
    title: "Hidden Commission Scanner",
    blurb: "Bedrock parses your CAS, finds Regular plans carrying broker commissions, and shows the 20-year compounding cost of staying.",
    aws: ["S3 · CAS upload", "Bedrock · PDF parse", "Lambda · projection", "DynamoDB", "Step Functions · switch"],
    intro: "Upload a Consolidated Account Statement and a Bedrock agent isolates every <b>Regular</b> mutual fund — the ones quietly paying a broker commission baked into a higher expense ratio. The scanner projects the exact wealth lost to that drag over a 20-year horizon, then offers a clean switch to the <b>Direct</b> plan, sequenced to avoid needless exit loads or tax.",
    render() {
      return `
      <div class="panel">
        <h3>Parsed Consolidated Account Statement</h3>
        <p class="panel-note">Demo CAS loaded. Bedrock tagged each folio Regular vs Direct and read its expense ratio.</p>
        <table class="tbl" id="cas">
          <tr><th>Fund</th><th>Plan</th><th class="num">Value</th><th class="num">Expense</th></tr>
        </table>
        <div class="field-row mt">
          <div>
            <label class="fld">Projection horizon · <span class="range-val" id="hlbl">20</span> years</label>
            <input type="range" id="horizon" min="5" max="30" value="20" step="1" />
          </div>
          <div>
            <label class="fld">Assumed gross return</label>
            <div class="chips" id="ret-chips">
              <button class="chip-btn" data-v="0.10">10%</button>
              <button class="chip-btn on" data-v="0.12">12%</button>
              <button class="chip-btn" data-v="0.14">14%</button>
            </div>
          </div>
        </div>
        <div id="comm-result"></div>
      </div>
      <div class="panel" id="switch-panel" hidden></div>`;
    },
    mount(root) {
      // Demo holdings: regular plans carry ~1.1% extra expense vs their direct twin.
      const holdings = [
        { fund: "Bluechip Equity Fund", plan: "Regular", value: 850000, exp: 1.65, dirExp: 0.55 },
        { fund: "Flexicap Growth Fund",  plan: "Regular", value: 620000, exp: 1.80, dirExp: 0.70 },
        { fund: "Liquid Fund",           plan: "Direct",  value: 300000, exp: 0.20, dirExp: 0.20 },
      ];
      let ret = 0.12;
      const horizon = $("#horizon", root);

      $("#cas", root).insertAdjacentHTML("beforeend", holdings.map((h) => `
        <tr>
          <td>${esc(h.fund)}</td>
          <td>${h.plan === "Regular" ? `<span class="badge warn">Regular</span>` : `<span class="badge ok">Direct</span>`}</td>
          <td class="num">${fmtShort(h.value)}</td>
          <td class="num">${h.exp.toFixed(2)}%</td>
        </tr>`).join(""));

      const calc = () => {
        const yrs = +horizon.value;
        $("#hlbl", root).textContent = yrs;
        let lost = 0, regularValue = 0;
        const rows = holdings.filter((h) => h.plan === "Regular").map((h) => {
          // commission drag = (regular expense - direct expense), as a return haircut
          const drag = (h.exp - h.dirExp) / 100;
          const fvDirect  = lumpFV(h.value, ret - h.dirExp / 100, yrs);
          const fvRegular = lumpFV(h.value, ret - h.exp / 100, yrs);
          const gap = fvDirect - fvRegular;
          lost += gap; regularValue += h.value;
          return { fund: h.fund, drag: drag * 100, gap, fvDirect, fvRegular };
        });
        $("#comm-result", root).innerHTML = `
          <div class="metrics">
            <div class="metric"><div class="k">In Regular plans</div><div class="v">${fmtShort(regularValue)}</div></div>
            <div class="metric"><div class="k">Lost to commissions in ${yrs}y</div><div class="v red">${fmtShort(lost)}</div><div class="sub">vs the Direct twin</div></div>
            <div class="metric"><div class="k">That's roughly</div><div class="v gold">${(lost / regularValue).toFixed(2)}×</div><div class="sub">of today's invested amount</div></div>
          </div>
          <table class="tbl mt">
            <tr><th>Fund</th><th class="num">Annual drag</th><th class="num">Direct in ${yrs}y</th><th class="num">Regular in ${yrs}y</th><th class="num">Cost</th></tr>
            ${rows.map((r) => `<tr><td>${esc(r.fund)}</td><td class="num">${r.drag.toFixed(2)}%</td>
              <td class="num">${fmtShort(r.fvDirect)}</td><td class="num">${fmtShort(r.fvRegular)}</td>
              <td class="num" style="color:var(--alert)">${fmtShort(r.gap)}</td></tr>`).join("")}
          </table>
          <div class="note small mt">Maths: each fund grown at <span class="mono">(gross − expense ratio)</span>, monthly-compounded over ${yrs} years. The gap is purely the expense-ratio difference between the Regular and Direct twin — nothing else changes.</div>
          <button class="btn block mt" id="do-switch">↪ Switch all Regular → Direct</button>`;
        $("#do-switch", root).addEventListener("click", () => {
          const sp = $("#switch-panel", root); sp.hidden = false;
          sp.innerHTML = `
            <h3>Switch plan · Step Functions</h3>
            <ol class="steps">
              <li class="done"><b>Check exit loads &amp; holding period</b><p>All units past exit-load window — switch is load-free.</p></li>
              <li class="done"><b>Tax-aware sequencing</b><p>Switches staged to keep realised LTCG within the annual exemption where possible.</p></li>
              <li class="done"><b>Place Regular→Direct switch orders</b><p>Same scheme, Direct variant — you stay invested throughout.</p></li>
              <li class="active"><b>Confirm with RTA</b><p>SQS buffers until the registrar acknowledges.</p></li>
            </ol>
            <div class="callout">You keep the same funds and the same market exposure — you simply stop paying the commission. Projected ${+horizon.value}-year saving: <b style="color:var(--guard)">${fmtShort(lost)}</b>.</div>`;
          sp.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      };
      horizon.addEventListener("input", calc);
      $$("#ret-chips .chip-btn", root).forEach((b) => b.addEventListener("click", () => {
        $$("#ret-chips .chip-btn", root).forEach((x) => x.classList.remove("on"));
        b.classList.add("on"); ret = +b.getAttribute("data-v"); calc();
      }));
      calc();
    },
  });

  /* === Pillar G — Emergency LAMF ========================================= */
  reg({
    id: "lamf",
    icon: "🏦",
    tag: "PILLAR G",
    title: "Emergency LAMF",
    blurb: "Pledge your units for an instant overdraft in minutes — instead of breaking compounding to raise cash.",
    aws: ["API Gateway", "Lambda", "Banking-partner APIs", "Step Functions", "Secrets Manager", "SQS · circuit breaker"],
    intro: "When a medical or household crisis demands cash <em>now</em>, redeeming long-term funds can permanently break compounding (and trigger tax). A Loan Against Mutual Fund pledges your units to a banking partner and opens an instant overdraft — credited within minutes at a competitive rate — so your investments stay invested and keep growing. Compare the two paths below.",
    render() {
      return `
      <div class="panel">
        <h3>You need cash, fast</h3>
        <div class="field-row">
          <div>
            <label class="fld">Amount needed · <span class="range-val" id="nlbl">₹5,00,000</span></label>
            <input type="range" id="need" min="100000" max="1500000" value="500000" step="50000" />
          </div>
        </div>
        <label class="fld">Your pledgeable portfolio</label>
        <table class="tbl">
          <tr><th>Sleeve</th><th class="num">Value</th><th class="num">LTV</th><th class="num">Borrowable</th></tr>
          <tr><td>Equity funds</td><td class="num">₹14,00,000</td><td class="num">50%</td><td class="num">₹7,00,000</td></tr>
          <tr><td>Debt / liquid</td><td class="num">₹6,00,000</td><td class="num">80%</td><td class="num">₹4,80,000</td></tr>
          <tr><td><b>Total limit</b></td><td class="num"></td><td class="num"></td><td class="num"><b>₹11,80,000</b></td></tr>
        </table>
      </div>
      <div class="panel split">
        <div>
          <h3 style="color:var(--guard)">Path 1 · LAMF overdraft</h3>
          <div id="lamf-a"></div>
        </div>
        <div>
          <h3 style="color:var(--alert)">Path 2 · redeem the units</h3>
          <div id="lamf-b"></div>
        </div>
      </div>
      <div class="panel" id="lamf-verdict"></div>`;
    },
    mount(root) {
      const need = $("#need", root);
      const LIMIT = 1180000;
      const RATE = 0.105;        // LAMF interest p.a.
      const TENURE = 1;          // assume 1-year carry for illustration
      const GROWTH = 0.12;       // what the still-invested units would earn
      const EXIT_LTCG = 0.125;   // tax if redeemed (illustrative)
      const render = () => {
        const amt = +need.value;
        $("#nlbl", root).textContent = fmtINR(amt);
        const within = amt <= LIMIT;
        // Path A: interest cost for the year, units keep compounding.
        const interest = amt * RATE * TENURE;
        // Path B: redeem amt; lose a year of growth on it + pay tax on the gain portion (assume 30% of redemption is gain)
        const lostGrowth = amt * GROWTH * TENURE;
        const tax = amt * 0.30 * EXIT_LTCG;
        const redeemCost = lostGrowth + tax;
        $("#lamf-a", root).innerHTML = `
          <div class="metric mb"><div class="k">Available now</div><div class="v green">${within ? "✅ in minutes" : "exceeds limit"}</div></div>
          <table class="tbl">
            <tr><td>Overdraft drawn</td><td class="num">${fmtINR(amt)}</td></tr>
            <tr><td>Rate</td><td class="num">${(RATE * 100).toFixed(1)}% p.a.</td></tr>
            <tr><td>Interest (1 yr)</td><td class="num" style="color:var(--warn)">${fmtINR(interest)}</td></tr>
            <tr><td>Units sold</td><td class="num" style="color:var(--guard)">₹0 — stay invested</td></tr>
          </table>`;
        $("#lamf-b", root).innerHTML = `
          <table class="tbl">
            <tr><td>Units redeemed</td><td class="num">${fmtINR(amt)}</td></tr>
            <tr><td>Lost growth (1 yr @12%)</td><td class="num" style="color:var(--alert)">${fmtINR(lostGrowth)}</td></tr>
            <tr><td>Est. LTCG tax</td><td class="num" style="color:var(--alert)">${fmtINR(tax)}</td></tr>
            <tr><td><b>True cost</b></td><td class="num" style="color:var(--alert)"><b>${fmtINR(redeemCost)}</b></td></tr>
          </table>`;
        const saving = redeemCost - interest;
        $("#lamf-verdict", root).innerHTML = `
          <div class="callout ${within ? "" : "warn"}">
            ${within
              ? `<b>Pledging beats redeeming by ${fmtShort(saving)} over the year.</b> The overdraft costs ${fmtShort(interest)} in interest; redeeming would cost ${fmtShort(redeemCost)} in lost growth and tax — and permanently shrink the corpus. Crisis handled; compounding intact.`
              : `<b>${fmtINR(amt)} exceeds the ₹11.8 L pledge limit.</b> FinGuardian would draw the maximum overdraft and flag the small remainder for a planned, tax-aware partial redemption.`}
          </div>`;
      };
      need.addEventListener("input", render);
      render();
    },
  });

  /* === Pillar H — Anti-Panic Shield ====================================== */
  reg({
    id: "antipanic",
    icon: "🧊",
    tag: "PILLAR H",
    title: "Anti-Panic Shield",
    blurb: "A panic-sell during a steep drop triggers a mandatory 24-hour cooling-off period — with the history of every recovery.",
    aws: ["API Gateway", "Lambda", "Step Functions · 24h timer", "DynamoDB", "EventBridge"],
    intro: "The single most expensive thing an investor does is sell into a crash. When the engine detects a redemption attempt during a steep market drop, it interposes a mandatory <b>24-hour cooling-off period</b> and shows the historical recovery from every comparable fall — turning a reflex into a decision. The order isn't blocked forever; it's just slowed down enough to let the panic pass.",
    render() {
      return `
      <div class="panel">
        <h3>Your equity portfolio · today</h3>
        <div class="metrics mb">
          <div class="metric"><div class="k">Invested</div><div class="v">₹18,00,000</div></div>
          <div class="metric"><div class="k">Value today</div><div class="v red">₹12,96,000</div><div class="sub">market −28% from high</div></div>
          <div class="metric"><div class="k">On screen</div><div class="v red">−₹5,04,000</div></div>
        </div>
        <button class="btn warn block" id="panic">😱 SELL EVERYTHING — make it stop</button>
      </div>
      <div class="panel" id="shield" hidden></div>`;
    },
    mount(root) {
      $("#panic", root).addEventListener("click", () => {
        const s = $("#shield", root); s.hidden = false;
        s.innerHTML = `
          <div class="shield-wrap">
            <div class="shield-ic">🛡️</div>
            <h3 class="mt-s">Cooling-off engaged</h3>
            <p class="muted small">A Step Functions timer is holding this redemption for 24 hours. You can still confirm afterwards — this is a pause, not a block.</p>
            <div class="clock calm mt">24 : 00 : 00</div>
          </div>
          <h3 class="mt">Every fall like this one has recovered</h3>
          <table class="tbl mt">
            <tr><th>Crash</th><th class="num">Drawdown</th><th class="num">Recovered in</th><th class="num">3 yrs later</th></tr>
            <tr><td>COVID-19, 2020</td><td class="num" style="color:var(--alert)">−38%</td><td class="num">~9 months</td><td class="num" style="color:var(--guard)">+95%</td></tr>
            <tr><td>Global Financial Crisis, 2008</td><td class="num" style="color:var(--alert)">−60%</td><td class="num">~24 months</td><td class="num" style="color:var(--guard)">+88%</td></tr>
            <tr><td>2022 correction</td><td class="num" style="color:var(--alert)">−18%</td><td class="num">~12 months</td><td class="num" style="color:var(--guard)">+41%</td></tr>
          </table>
          <div class="note small mt">Illustrative, based on broad-index drawdowns; exact figures vary by index and dates. Not a prediction.</div>
          <div class="row mt">
            <button class="btn" id="keep">✅ Keep my units — I'll wait</button>
            <button class="btn ghost" id="still">Confirm sale in 24h anyway</button>
          </div>
          <div id="ap-out" class="mt"></div>`;
        $("#keep", s).addEventListener("click", () => {
          $("#ap-out", s).innerHTML = `<div class="callout"><b>✅ Order cancelled.</b> You stayed invested. History says the recovery does the rest — and the SIP keeps buying these cheap units in the meantime.</div>`;
        });
        $("#still", s).addEventListener("click", () => {
          $("#ap-out", s).innerHTML = `<div class="callout warn"><b>Queued for 24h.</b> FinGuardian never overrides you — it only makes sure the decision is yours, not the market's. You'll get one final confirmation tomorrow, after the panic has had a day to pass.</div>`;
        });
        s.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
  });

  /* ----------------------------------------------------------------------- *
   * 3. Views: home, pillar console, architecture, about
   * ----------------------------------------------------------------------- */
  function viewHome() {
    const cards = PILLARS.map((p) => `
      <a class="card" href="#/pillar/${p.id}">
        <span class="ic">${p.icon}</span>
        <span class="tag">${esc(p.tag)}</span>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.blurb)}</p>
        <span class="go">Open demo →</span>
      </a>`).join("");
    return `
      <section class="view">
        <div class="hero">
          <span class="kicker">Autonomous Wealth Lifecycle Guardian</span>
          <h1>Your money has a <span class="grad">bodyguard</span> now.</h1>
          <p class="lead">FinGuardian AI watches over investments <em>after</em> the buy button — guarding against behavioural mistakes, operational lock-ups, regulatory drift, and the bureaucratic ordeal of inheritance. Built 100% serverless, event-driven, zero-ops.</p>
          <div class="stats">
            <div class="stat"><b>8</b><span>GUARDIAN PILLARS</span></div>
            <div class="stat"><b>100%</b><span>SERVERLESS</span></div>
            <div class="stat"><b>AES-256</b><span>KMS-ISOLATED KEYS</span></div>
            <div class="stat"><b>ap-south-1</b><span>MUMBAI · SEBI/RBI</span></div>
          </div>
        </div>
        <div class="section-head"><h2>The eight pillars</h2><span class="hint">tap any card — each is a working demo</span></div>
        <div class="grid">${cards}</div>
      </section>`;
  }

  function viewPillar(id) {
    const p = PILLARS.find((x) => x.id === id);
    if (!p) return viewHome();
    return `
      <section class="view" data-pillar="${p.id}">
        <div class="console-head"><a class="back" href="#/">← All pillars</a></div>
        <div class="console-title"><span class="ic">${p.icon}</span><h1>${esc(p.title)}</h1></div>
        <p class="console-sub">${p.intro}</p>
        <div class="aws-line">${awsChips(p.aws)}</div>
        <div id="pillar-body">${p.render()}</div>
      </section>`;
  }

  function viewArchitecture() {
    const layers = [
      { ic: "📱", n: "Frontend & CDN", p: "Cross-platform app delivered globally with edge caching for ultra-low-latency loads.", s: ["AWS Amplify", "CloudFront", "Flutter / React Native"] },
      { ic: "🔐", n: "Gateway & Auth", p: "Single secure entry point: OAuth2 tokens, biometric login, MFA automation.", s: ["API Gateway", "Cognito", "WAF"] },
      { ic: "⚙️", n: "Compute Engine", p: "All business logic on serverless functions — runs only on events, zero idle cost, no OS to patch.", s: ["Lambda (Python)"] },
      { ic: "🔁", n: "Workflow Orchestration", p: "Long-running, stateful routines — consent waits, inactivity timers — survive across days.", s: ["Step Functions", "EventBridge"] },
      { ic: "🗄️", n: "Database", p: "Auto-scaling NoSQL with single-digit-ms latency. FamilyID/UserID household model, config state, indices.", s: ["DynamoDB"] },
      { ic: "🧠", n: "AI Processing Brain", p: "Contextual parsing of CAS PDFs and regulatory circulars into structured changes.", s: ["Amazon Bedrock (Claude)"] },
      { ic: "🔑", n: "Security & Privacy", p: "AES-256 everywhere; each family member's records sealed under a unique, isolated key.", s: ["KMS", "Secrets Manager"] },
      { ic: "🧯", n: "Queue & Resiliency", p: "Buffer + circuit-breaker: if a bank or RTA is down, requests wait safely until it recovers.", s: ["SQS"] },
      { ic: "📒", n: "Audit & Registry", p: "Every access and change logged immutably with timestamp, source IP and user ID.", s: ["CloudTrail", "CloudWatch"] },
    ];
    const layerHTML = layers.map((l) => `
      <div class="layer">
        <div class="lhead"><span class="ic">${l.ic}</span><b>${esc(l.n)}</b></div>
        <p>${esc(l.p)}</p>
        <div class="svc">${awsChips(l.s)}</div>
      </div>`).join("");

    const flow =
`EventBridge ─(02:00 IST)─▶ Lambda crawler ─▶ S3 (raw PDF)
                                  │
                                  ▼
                          Amazon Bedrock ─▶ structured rule diff
                                  │
                                  ▼
                    Step Functions (human-in-the-loop)
                                  │  admin Approve ✔
                                  ▼
                       DynamoDB config  ◀── live read by all Lambdas
                                  │
                                  ▼
                           CloudTrail (immutable)`;

    return `
      <section class="view prose">
        <div class="console-head"><a class="back" href="#/">← Home</a></div>
        <h1 style="font-size:clamp(24px,6vw,34px);margin-top:14px">Cloud architecture</h1>
        <p class="muted">100% serverless · event-driven · microservices. Zero-ops: managed services and config-in-DynamoDB mean parameters change without redeploying code. Localised to <span class="mono">ap-south-1</span> (Mumbai) for SEBI / RBI compliance.</p>

        <h2>Infrastructure layers</h2>
        <div class="layers">${layerHTML}</div>

        <h2>Network topology &amp; isolation</h2>
        <p class="muted">Strict public/private separation: the internet only ever touches the perimeter; the data and AI core has no direct path to or from the public internet.</p>
        <div class="topo">
          <div class="zone public">
            <h4>🌐 Public subnet · perimeter</h4>
            <ul>
              <li><span class="b" style="background:var(--warn)"></span> Route 53 — DNS</li>
              <li><span class="b" style="background:var(--warn)"></span> AWS WAF — signature &amp; attack filtering</li>
              <li><span class="b" style="background:var(--warn)"></span> API Gateway — public entry points</li>
            </ul>
          </div>
          <div class="zone private">
            <h4>🔒 Private subnet · the vault</h4>
            <ul>
              <li><span class="b" style="background:var(--guard)"></span> Lambda — application logic</li>
              <li><span class="b" style="background:var(--guard)"></span> Bedrock — AI processors</li>
              <li><span class="b" style="background:var(--guard)"></span> DynamoDB — master data</li>
              <li><span class="b" style="background:var(--guard)"></span> KMS / Secrets Manager — keys</li>
            </ul>
          </div>
        </div>

        <h2>Event flow — the Regulatory Watchdog, end to end</h2>
        <div class="flow">${esc(flow)}</div>

        <h2>The household data model</h2>
        <p class="muted">A single DynamoDB table keys the entire household so one query returns every member:</p>
        <div class="flow">${esc(
`Table: Households
  PK  FamilyID   "FAM#rao-2007"
  SK  UserID     "U#meera" | "U#arun" | "U#latha" | "U#kabir"

  Query(PK = "FAM#rao-2007")  ─▶  whole family, sorted by UserID
  Attributes: role, holdings[], consentGrants[], kycStatus, ...
  Guardrail: a redemption is authorised only when
             requester.UserID == asset.ownerUserID`)}</div>

        <p class="muted small mt">This is a reference design rendered for clarity; the live demo runs entirely in the browser with simulated data.</p>
      </section>`;
  }

  function viewAbout() {
    return `
      <section class="view prose">
        <div class="console-head"><a class="back" href="#/">← Home</a></div>
        <h1 style="font-size:clamp(24px,6vw,34px);margin-top:14px">About this prototype</h1>
        <p class="muted">FinGuardian AI is an autonomous "financial bodyguard." Traditional fintech stops at onboarding and transactions; FinGuardian addresses the <em>post-investment</em> anxieties — behavioural blind spots, operational bottlenecks, family integration, and legacy transmission.</p>

        <h3>What this is</h3>
        <p>A self-contained, in-browser prototype of all eight pillars and the supporting serverless architecture. There is no live AWS backend here — every figure is computed in JavaScript from the on-screen inputs, in small, commented functions, so the numbers are reproducible.</p>

        <h3>What's real vs simulated</h3>
        <ul>
          <li><b>Real &amp; auditable:</b> the finance maths — SIP/lump-sum future value (exact monthly compounding), the commission drag projection, the LAMF cost comparison, the de-risking glide path, the buy-the-dip trigger logic.</li>
          <li><b>Simulated:</b> AWS service calls, KRA polling, Bedrock parsing, banking-partner APIs, and the household data — shown as realistic mock flows.</li>
        </ul>

        <h3>The eight pillars</h3>
        <ul>
          <li><b>A · Family Wealth Cloud</b> — household model + Step Functions consent handshake.</li>
          <li><b>B · Regulatory Watchdog</b> — nightly scan, Bedrock parse, human-in-the-loop config.</li>
          <li><b>C · KYC Health Watchdog</b> — KRA polling and early re-verify nudges.</li>
          <li><b>D · Dead Man's Switch</b> — inactivity protocol and pre-filled transmission paperwork.</li>
          <li><b>E · Buy-the-Dip &amp; De-risking</b> — STP triggers and goal glide paths.</li>
          <li><b>F · Commission Scanner</b> — CAS parse and 20-year Direct-vs-Regular projection.</li>
          <li><b>G · Emergency LAMF</b> — pledge-vs-redeem comparison.</li>
          <li><b>H · Anti-Panic Shield</b> — 24-hour cooling-off with recovery history.</li>
        </ul>

        <h3>Compliance &amp; guardrails</h3>
        <p>The reference design localises all compute and data to <span class="mono">ap-south-1</span> (Mumbai), enforces AES-256 with per-member KMS key isolation, routes every action through an immutable CloudTrail/CloudWatch audit trail, and structurally forbids any member from moving another's assets.</p>

        <p class="muted small mt">All outputs are illustrative ranges of possibility — never predictions or advice. <b>Educational tool — not investment advice.</b></p>
      </section>`;
  }

  /* ----------------------------------------------------------------------- *
   * 4. Router
   * ----------------------------------------------------------------------- */
  const stage = $("#stage");
  function setActiveNav(route) {
    $$("#nav a").forEach((a) => {
      const key = a.getAttribute("data-nav");
      const on = (route === "home" && key === "home") || route === key;
      a.classList.toggle("active", !!on);
    });
  }
  function route() {
    const hash = (location.hash || "#/").replace(/^#/, "");
    let html, navKey = "home", pillar = null;
    if (hash.startsWith("/pillar/")) {
      pillar = PILLARS.find((p) => p.id === hash.slice("/pillar/".length));
      html = viewPillar(hash.slice("/pillar/".length)); navKey = "home";
    } else if (hash.startsWith("/architecture")) {
      html = viewArchitecture(); navKey = "architecture";
    } else if (hash.startsWith("/about")) {
      html = viewAbout(); navKey = "about";
    } else {
      html = viewHome(); navKey = "home";
    }
    stage.innerHTML = html;
    setActiveNav(navKey);
    if (pillar && pillar.mount) pillar.mount($("#pillar-body", stage));
    // focus + scroll for accessibility on navigation
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    stage.focus({ preventScroll: true });
  }
  window.addEventListener("hashchange", route);
  route();
})();
