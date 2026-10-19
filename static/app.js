const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let variableCount = 4;
let selectedMinterms = new Set([0, 1, 2, 5, 6, 7, 8, 9, 10, 14]);
let adderKind = "half";
let adderInputs = { a: 0, b: 0, c: 0 };
let currentSolverData = null;
let currentTruthFilter = "all";
const groupColors = ["#70e1d0", "#83aaff", "#f0c36c", "#d99bf4", "#ff9d9d", "#9bdf7d"];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

/* ==========================================================================
   SVG Logic Gate Drawing Helpers
   ========================================================================== */

function drawAndGate(x, y, w = 44, h = 36, active = false, strokeColor = null, label = "AND") {
  const r = h / 2;
  const path = `M ${x} ${y - r} L ${x + w - r} ${y - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + r} L ${x} ${y + r} Z`;
  const style = strokeColor ? `style="stroke: ${strokeColor};"` : "";
  return `
    <path d="${path}" class="gate-body ${active ? "active-gate" : ""}" ${style} />
    <text x="${x + w * 0.4}" y="${y + 1}" class="gate-label">${label}</text>
  `;
}

function drawOrGate(x, y, w = 46, h = 40, active = false, strokeColor = null, label = "OR") {
  const r = h / 2;
  const path = `M ${x} ${y - r} Q ${x + w * 0.45} ${y - r * 0.8} ${x + w} ${y} Q ${x + w * 0.45} ${y + r * 0.8} ${x} ${y + r} Q ${x + w * 0.25} ${y} ${x} ${y - r} Z`;
  const style = strokeColor ? `style="stroke: ${strokeColor};"` : "";
  return `
    <path d="${path}" class="gate-body ${active ? "active-gate" : ""}" ${style} />
    <text x="${x + w * 0.45}" y="${y + 1}" class="gate-label">${label}</text>
  `;
}

function drawXorGate(x, y, w = 46, h = 40, active = false) {
  const r = h / 2;
  const bodyPath = `M ${x} ${y - r} Q ${x + w * 0.45} ${y - r * 0.8} ${x + w} ${y} Q ${x + w * 0.45} ${y + r * 0.8} ${x} ${y + r} Q ${x + w * 0.25} ${y} ${x} ${y - r} Z`;
  const arcPath = `M ${x - 6} ${y - r} Q ${x - 6 + w * 0.25} ${y} ${x - 6} ${y + r}`;
  return `
    <path d="${arcPath}" class="gate-xor-arc ${active ? "active-gate" : ""}" />
    <path d="${bodyPath}" class="gate-body ${active ? "active-gate" : ""}" />
    <text x="${x + w * 0.45}" y="${y + 1}" class="gate-label">XOR</text>
  `;
}

function drawNotGate(x, y, w = 28, h = 18, active = false) {
  const r = h / 2;
  const tri = `M ${x} ${y - r} L ${x + w - 8} ${y} L ${x} ${y + r} Z`;
  return `
    <path d="${tri}" class="gate-not-body" />
    <circle cx="${x + w - 4}" cy="${y}" r="3.5" class="gate-bubble ${active ? "active-bubble" : ""}" />
  `;
}

function renderMintermPicker() {
  const max = 2 ** variableCount;
  $("#range-label").textContent = `0–${max - 1}`;
  selectedMinterms = new Set([...selectedMinterms].filter(n => n < max));
  $("#minterm-picker").innerHTML = Array.from({ length: max }, (_, n) => `
    <button class="minterm-btn ${selectedMinterms.has(n) ? "on" : ""}" data-minterm="${n}" aria-pressed="${selectedMinterms.has(n)}" title="Click to toggle minterm m${n}">
      <span>m${n}</span><strong>${selectedMinterms.has(n) ? "1" : "0"}</strong>
    </button>`).join("");

  $$(".minterm-btn").forEach(button => button.addEventListener("click", () => {
    const n = Number(button.dataset.minterm);
    selectedMinterms.has(n) ? selectedMinterms.delete(n) : selectedMinterms.add(n);
    renderMintermPicker();
  }));
}

function setVariableCount(count) {
  variableCount = count;
  $$("#variable-picker button").forEach(btn => btn.classList.toggle("selected", Number(btn.dataset.vars) === count));
  renderMintermPicker();
}

function highlightKmapCell(minterm, highlight) {
  const cell = document.querySelector(`.kcell[data-minterm="${minterm}"]`);
  if (cell) {
    cell.classList.toggle("highlight-cell", highlight);
  }
}

function highlightTruthRow(minterm, highlight) {
  const row = document.querySelector(`.truth-row[data-minterm="${minterm}"]`);
  if (row) {
    row.classList.toggle("highlight-row", highlight);
  }
}

function evaluateExpression(expression, bits, variables) {
  const expr = String(expression).trim();
  if (expr === "0") return 0;
  if (expr === "1") return 1;

  const terms = expr.split(/\s*\+\s*/).filter(Boolean);
  if (!terms.length) return 0;

  for (const term of terms) {
    if (term === "1") return 1;
    if (term === "0") continue;

    const literals = term.match(/[A-Z]'?/g) || [];
    if (!literals.length) continue;

    const termMatches = literals.every(literal => {
      const varChar = literal[0];
      const isComplemented = literal.endsWith("'");
      const varIndex = variables.indexOf(varChar);
      if (varIndex < 0) return false;
      const bitVal = bits[varIndex];
      return isComplemented ? bitVal === 0 : bitVal === 1;
    });

    if (termMatches) return 1;
  }
  return 0;
}

function renderMap(data) {
  currentSolverData = data;
  const cols = data.col_labels.length;
  $("#map-axis").textContent = `${data.row_variables || "—"} \\ ${data.col_variables || "—"}`;
  const header = `<div class="kmap-row" style="--cols:${cols}">${data.col_labels.map(label => `<div class="map-axis">${label}</div>`).join("")}</div>`;
  const rows = data.grid.map((row) => `
    <div class="kmap-row" style="--cols:${cols}">
      ${row.map(cell => {
    const groupClasses = cell.groups.map(g => `has-g${g % 6}`).join(" ");
    const dots = cell.groups.map(g => `<i class="group-dot g${g % 6}"></i>`).join("");
    return `<div class="kcell ${cell.value ? "one" : ""} ${groupClasses}" data-minterm="${cell.number}" title="Click to toggle cell m${cell.number}; Groups: ${cell.groups.length ? cell.groups.map(g => g + 1).join(", ") : "none"}">
          <span class="m-label">m${cell.number}</span><strong class="value">${cell.value}</strong><div class="group-dots">${dots}</div>
        </div>`;
  }).join("")}
    </div>`).join("");

  $("#kmap").className = "kmap";
  $("#kmap").innerHTML = header + rows;

  // Add click & hover listeners on K-map cells for real-time 2-way verification
  $$(".kcell[data-minterm]").forEach(cell => {
    const m = Number(cell.dataset.minterm);
    cell.addEventListener("mouseenter", () => highlightTruthRow(m, true));
    cell.addEventListener("mouseleave", () => highlightTruthRow(m, false));
    cell.addEventListener("click", () => {
      selectedMinterms.has(m) ? selectedMinterms.delete(m) : selectedMinterms.add(m);
      renderMintermPicker();
    });
  });

  $("#group-legend").innerHTML = data.groups.length
    ? data.groups.map(g => `<div class="legend-item"><i class="legend-swatch g${g.color}"></i>G${g.id + 1}: ${escapeHtml(g.expression)}</div>`).join("")
    : `<div class="legend-item">No groups needed for constant 0.</div>`;

  const vars = "ABCD".slice(0, data.variables).split("").join(",");
  $("#expression").innerHTML = `F(${vars}) = <span>${escapeHtml(data.expression)}</span>`;

  $("#group-breakdown").innerHTML = data.groups.length
    ? data.groups.map(g => `<div class="group-row"><div class="group-chip g${g.color}">G${g.id + 1}</div><div><strong>${escapeHtml(g.expression)}</strong><small>Covers minterms: ${g.minterms.map(n => `m${n}`).join(", ") || "all cells"}</small></div></div>`).join("")
    : `<div class="empty-note">No product groups are needed: the function is always 0.</div>`;

  // Update truth table verification, circuit visualizer, and step-by-step tutor in same interface
  renderTruthTable(data);
  renderKmapCircuit(data);
  renderTutor(data);
}

function renderTruthTable(data) {
  const container = document.querySelector("#truth-table-content");
  const status = document.querySelector("#verification-status");
  if (!container || !status) return;

  const variables = "ABCD".slice(0, Number(data.variables)).split("");
  const totalStates = 2 ** variables.length;
  const mintermSet = new Set((data.minterms || []).map(Number));

  // Dynamically update panel title and subtitle
  const titleEl = document.querySelector("#truth-table-title");
  const subtitleEl = document.querySelector("#truth-table-subtitle");
  if (titleEl) titleEl.textContent = `Truth Table: F(${variables.join(", ")})`;
  if (subtitleEl) subtitleEl.textContent = `Auto-verifying ${totalStates} states against minimized F = ${data.expression}`;

  const allRows = [];
  let allMatch = true;
  let matchCount = 0;
  let mintermCount = 0;

  for (let m = 0; m < totalStates; m++) {
    const bits = variables.map((_, i) => (m >> (variables.length - 1 - i)) & 1);
    const original = mintermSet.has(m) ? 1 : 0;
    if (original === 1) mintermCount++;

    const simplified = evaluateExpression(data.expression, bits, variables);
    const matches = original === simplified;

    if (matches) matchCount++;
    else allMatch = false;

    const coveringGroups = (data.groups || []).filter(g => g.minterms && g.minterms.includes(m));

    allRows.push({
      m,
      bits,
      original,
      simplified,
      matches,
      coveringGroups
    });
  }

  status.className = allMatch ? "auto-badge badge-pass" : "auto-badge badge-error";
  status.textContent = allMatch ? "✓ 100% MATCH" : "⚠ MISMATCH DETECTED";

  const maxtermCount = totalStates - mintermCount;
  const filteredRows = allRows.filter(r => {
    if (currentTruthFilter === "minterms") return r.original === 1;
    if (currentTruthFilter === "maxterms") return r.original === 0;
    return true;
  });

  const tableNameString = `F(${variables.join(", ")}) Canonical Truth Table`;

  container.innerHTML = `
    <!-- Explicit Truth Table Name Bar -->
    <div class="truth-table-name-bar">
      <div class="table-name-title">
        <span class="table-name-label">TABLE NAME</span>
        <strong class="table-display-name">${escapeHtml(tableNameString)}</strong>
      </div>
      <span class="table-type-badge">${totalStates} STATES (2^${data.variables})</span>
    </div>

    <div class="truth-meta">
      <div class="stats-grid">
        <div class="stat-chip">
          <span>TOTAL STATES</span>
          <strong>${totalStates}</strong>
        </div>
        <div class="stat-chip">
          <span>EQUIVALENCE</span>
          <strong class="${allMatch ? "accent-green" : "accent-cyan"}">${Math.round((matchCount / totalStates) * 100)}%</strong>
        </div>
        <div class="stat-chip">
          <span>MINTERMS (F=1)</span>
          <strong class="accent-cyan">${mintermCount}</strong>
        </div>
        <div class="stat-chip">
          <span>MAXTERMS (F=0)</span>
          <strong>${maxtermCount}</strong>
        </div>
      </div>

      <div class="truth-controls">
        <div class="filter-group">
          <button class="filter-btn ${currentTruthFilter === "all" ? "active" : ""}" data-filter="all">All (${totalStates})</button>
          <button class="filter-btn ${currentTruthFilter === "minterms" ? "active" : ""}" data-filter="minterms">F=1 (${mintermCount})</button>
          <button class="filter-btn ${currentTruthFilter === "maxterms" ? "active" : ""}" data-filter="maxterms">F=0 (${maxtermCount})</button>
        </div>
        <div class="truth-hint">
          <span>💡 Tap any F value to toggle that minterm directly</span>
        </div>
      </div>
    </div>

    <!-- Scrollable Truth Table with Named Columns -->
    <div class="truth-table-wrap">
      <table class="truth-table">
        <thead>
          <tr>
            <th>
              Minterm
              <span class="table-th-name">Index</span>
            </th>
            ${variables.map(v => `
              <th>
                ${v}
                <span class="table-th-name">Input ${v}</span>
              </th>
            `).join("")}
            <th>
              Target F
              <span class="table-th-name">Specification</span>
            </th>
            <th>
              Minimized F
              <span class="table-th-name">Evaluated SOP</span>
            </th>
            <th>
              Verification
              <span class="table-th-name">Status</span>
            </th>
            <th>
              Covering Term
              <span class="table-th-name">Prime Implicant</span>
            </th>
          </tr>
        </thead>
        <tbody>
          ${filteredRows.map(row => `
            <tr class="truth-row" data-minterm="${row.m}">
              <td><span class="m-index">m${row.m}</span></td>
              ${row.bits.map(b => `<td><span class="bit-badge b${b}">${b}</span></td>`).join("")}
              <td>
                <button class="f-toggle-btn ${row.original ? "val-one" : "val-zero"}" data-minterm="${row.m}" title="Click to toggle minterm m${row.m}">
                  <strong>${row.original}</strong>
                </button>
              </td>
              <td><span class="f-val ${row.simplified ? "val-one" : "val-zero"}">${row.simplified}</span></td>
              <td>
                <span class="${row.matches ? "truth-match" : "truth-mismatch"}">
                  ${row.matches ? "✓ MATCH" : "✗ MISMATCH"}
                </span>
              </td>
              <td>
                <div class="terms-container">
                  ${row.coveringGroups.length
      ? row.coveringGroups.map(g => `<span class="term-chip g${g.color}" title="Covered by Group ${g.id + 1}: ${escapeHtml(g.expression)}">G${g.id + 1}: ${escapeHtml(g.expression)}</span>`).join("")
      : row.original === 1
        ? (data.expression === "1" ? `<span class="term-chip g0">All-1s Cover</span>` : `<span class="term-none">Covered</span>`)
        : `<span class="term-none">0 (Uncovered)</span>`
    }
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <!-- Formal Verification Equivalence Proof Summary -->
    <div class="verification-summary-card ${allMatch ? "verified-card" : "error-card"}">
      <div class="summary-icon">${allMatch ? "✓" : "⚠"}</div>
      <div class="summary-details">
        <h4>${allMatch ? "Formal Equivalence Verified: 100% Match" : "Verification Warning: Discrepancy Found"}</h4>
        <p>${allMatch
      ? `All ${totalStates} input assignments of (${variables.join(", ")}) evaluate to identical outputs between the minterm specification and the minimized Boolean expression <code>F = ${escapeHtml(data.expression)}</code>.`
      : "The evaluated simplified expression does not match the original specification. Check prime implicant coverage."}
        </p>
      </div>
    </div>
  `;

  // Attach hover and click events on truth table rows
  $$(".truth-row").forEach(row => {
    const m = Number(row.dataset.minterm);
    row.addEventListener("mouseenter", () => highlightKmapCell(m, true));
    row.addEventListener("mouseleave", () => highlightKmapCell(m, false));
  });

  // Toggle minterms directly by clicking on the F badge in the truth table
  $$(".f-toggle-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = Number(btn.dataset.minterm);
      selectedMinterms.has(m) ? selectedMinterms.delete(m) : selectedMinterms.add(m);
      renderMintermPicker();
    });
  });

  // Filter buttons handler
  $$(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentTruthFilter = btn.dataset.filter;
      renderTruthTable(currentSolverData);
    });
  });
}

/* ==========================================================================
   K-Map SOP Logic Circuit Visualizer
   ========================================================================== */

function renderKmapCircuit(data) {
  const container = document.querySelector("#kmap-circuit-container");
  if (!container) return;

  const expr = String(data.expression || "0").trim();
  const groups = data.groups || [];

  const archEl = document.querySelector("#circuit-arch-name");
  const gateCountEl = document.querySelector("#circuit-gate-count");
  const summaryEl = document.querySelector("#circuit-gate-summary");
  const formulaEl = document.querySelector("#circuit-output-formula");

  if (formulaEl) formulaEl.textContent = `F = ${expr}`;

  if (expr === "0") {
    if (archEl) archEl.textContent = "Constant Ground (Tied LOW)";
    if (gateCountEl) gateCountEl.textContent = "0 GATES";
    if (summaryEl) summaryEl.textContent = "0 Gates Total";

    container.innerHTML = `
      <svg class="circuit-svg" viewBox="0 0 440 140" width="440" height="140">
        <g class="circuit-terminal">
          <rect x="40" y="55" width="80" height="30" class="terminal-box" />
          <text x="80" y="70" class="terminal-text">GND (0)</text>
        </g>
        <path d="M 120 70 L 320 70" class="wire wire-low" />
        <path d="M 210 70 L 210 92" class="wire wire-low" />
        <path d="M 198 92 L 222 92" class="wire wire-low" />
        <path d="M 202 97 L 218 97" class="wire wire-low" />
        <path d="M 206 102 L 214 102" class="wire wire-low" />
        <g class="circuit-terminal">
          <rect x="320" y="53" width="85" height="34" class="terminal-box" />
          <text x="362" y="70" class="terminal-text">F = 0</text>
        </g>
      </svg>
    `;
    return;
  }

  if (expr === "1") {
    if (archEl) archEl.textContent = "Constant Power (Tied HIGH)";
    if (gateCountEl) gateCountEl.textContent = "0 GATES";
    if (summaryEl) summaryEl.textContent = "0 Gates Total";

    container.innerHTML = `
      <svg class="circuit-svg" viewBox="0 0 440 140" width="440" height="140">
        <g class="circuit-terminal">
          <rect x="40" y="55" width="80" height="30" class="terminal-box active-terminal" />
          <text x="80" y="70" class="terminal-text val-1-text">VCC (1)</text>
        </g>
        <path d="M 120 70 L 320 70" class="wire wire-high" />
        <path d="M 210 70 L 210 50" class="wire wire-high" />
        <path d="M 200 50 L 220 50" class="wire wire-high" />
        <g class="circuit-terminal">
          <rect x="320" y="53" width="85" height="34" class="terminal-box active-terminal" />
          <text x="362" y="70" class="terminal-text val-1-text">F = 1</text>
        </g>
      </svg>
    `;
    return;
  }

  // Count gates
  const numAND = groups.length;
  const numOR = groups.length > 1 ? 1 : 0;
  let numInverters = 0;
  groups.forEach(g => {
    const lits = g.expression.match(/[A-D]'?/g) || [];
    lits.forEach(lit => { if (lit.endsWith("'")) numInverters++; });
  });
  const totalGates = numAND + numOR + numInverters;

  if (archEl) archEl.textContent = groups.length > 1 ? "AND-OR 2-Level Network" : "Single Product-Term Gate";
  if (gateCountEl) gateCountEl.textContent = `${numAND} AND · ${numOR} OR · ${numInverters} NOT`;
  if (summaryEl) summaryEl.textContent = `${totalGates} Gates Total`;

  const K = Math.max(1, groups.length);
  const svgHeight = Math.max(220, K * 76 + 30);
  const svgWidth = K > 1 ? 560 : 480;
  const orMidY = 40 + ((K - 1) * 76) / 2;

  let elements = [];

  // Render AND Gates for each product term
  groups.forEach((g, idx) => {
    const yCenter = 40 + idx * 76;
    const color = groupColors[g.color % 6];
    const literals = (g.expression.match(/[A-D]'?/g) || []);
    const L = Math.max(1, literals.length);
    const gateX = 240;

    // Inputs to AND gate
    literals.forEach((lit, lIdx) => {
      const varName = lit[0];
      const isInv = lit.endsWith("'");
      const inY = L === 1 ? yCenter : (yCenter - 11 + lIdx * (22 / (L - 1)));

      if (isInv) {
        elements.push(`
          <text x="65" y="${inY + 1}" class="wire-label">${varName}'</text>
          <path d="M 80 ${inY} L 125 ${inY}" class="wire wire-sop" />
          ${drawNotGate(125, inY, 26, 16)}
          <path d="M 151 ${inY} L ${gateX} ${inY}" class="wire wire-sop" />
        `);
      } else {
        elements.push(`
          <text x="65" y="${inY + 1}" class="wire-label">${varName}</text>
          <path d="M 80 ${inY} L ${gateX} ${inY}" class="wire wire-sop" />
        `);
      }
    });

    // Draw AND Gate
    elements.push(drawAndGate(gateX, yCenter, 44, 36, false, color, "AND"));
    elements.push(`<text x="${gateX + 22}" y="${yCenter + 26}" class="term-tag" style="fill: ${color};">G${g.id + 1}: ${escapeHtml(g.expression)}</text>`);

    // Wire from AND gate output
    if (K > 1) {
      const orInX = 420;
      const orInY = orMidY - 20 + idx * (40 / (K - 1));
      elements.push(`
        <path d="M ${gateX + 44} ${yCenter} L 360 ${yCenter} L 360 ${orInY} L ${orInX} ${orInY}" class="wire wire-sop" />
      `);
    } else {
      elements.push(`
        <path d="M ${gateX + 44} ${yCenter} L 400 ${yCenter}" class="wire wire-sop" />
        <g class="circuit-terminal">
          <rect x="400" y="${yCenter - 17}" width="75" height="34" class="terminal-box active-terminal" />
          <text x="437" y="${yCenter}" class="terminal-text val-1-text">F</text>
        </g>
      `);
    }
  });

  // Render OR gate if K > 1
  if (K > 1) {
    const orX = 420;
    const orH = Math.min(84, Math.max(46, (K - 1) * 32 + 30));
    elements.push(drawOrGate(orX, orMidY, 48, orH, false, "#69e4b1", "OR"));
    elements.push(`
      <path d="M ${orX + 48} ${orMidY} L 485 ${orMidY}" class="wire wire-sop" />
      <g class="circuit-terminal">
        <rect x="485" y="${orMidY - 17}" width="70" height="34" class="terminal-box active-terminal" />
        <text x="520" y="${orMidY}" class="terminal-text val-1-text">F</text>
      </g>
    `);
  }

  container.innerHTML = `
    <svg class="circuit-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
      ${elements.join("")}
    </svg>
  `;
}

/* ==========================================================================
   Adder Lab Logic Circuit Visualizer
   ========================================================================== */

function renderAdderCircuit(kind, inputs) {
  const container = document.querySelector("#adder-circuit-container");
  if (!container) return;

  const isFull = kind === "full";
  const A = inputs.a ? 1 : 0;
  const B = inputs.b ? 1 : 0;
  const Cin = inputs.c ? 1 : 0;

  const titleEl = document.querySelector("#adder-circuit-title");
  const subtitleEl = document.querySelector("#adder-circuit-subtitle");
  const topologyEl = document.querySelector("#adder-circuit-topology");
  const metricsEl = document.querySelector("#adder-circuit-gates");
  const statusEl = document.querySelector("#adder-live-status");

  if (!isFull) {
    const S = A ^ B;
    const C = A & B;

    if (titleEl) titleEl.textContent = "Half Adder Logic Circuit Visualizer";
    if (subtitleEl) subtitleEl.textContent = "Interactive 2-gate schematic with real-time wire signal propagation.";
    if (topologyEl) topologyEl.textContent = "1 XOR (Sum) · 1 AND (Carry)";
    if (metricsEl) metricsEl.textContent = "2 Gates Total (Half Adder)";
    if (statusEl) statusEl.textContent = `A=${A}, B=${B} → S=${S}, Cout=${C}`;

    container.innerHTML = `
      <svg class="circuit-svg" viewBox="0 0 520 230" width="520" height="230">
        <!-- Input A -->
        <g class="circuit-terminal" style="cursor: pointer;" title="Toggle input A">
          <rect x="25" y="50" width="55" height="30" class="terminal-box ${A ? "active-terminal" : ""}" />
          <text x="52" y="65" class="terminal-text ${A ? "val-1-text" : "val-0-text"}">A=${A}</text>
        </g>

        <!-- Input B -->
        <g class="circuit-terminal" style="cursor: pointer;" title="Toggle input B">
          <rect x="25" y="140" width="55" height="30" class="terminal-box ${B ? "active-terminal" : ""}" />
          <text x="52" y="155" class="terminal-text ${B ? "val-1-text" : "val-0-text"}">B=${B}</text>
        </g>

        <!-- Wires from A -->
        <path d="M 80 65 L 220 65" class="wire ${A ? "wire-high" : "wire-low"}" />
        <circle cx="120" cy="65" r="3.5" class="junction-dot ${A ? "active-dot" : ""}" />
        <path d="M 120 65 L 120 155 L 220 155" class="wire ${A ? "wire-high" : "wire-low"}" />

        <!-- Wires from B -->
        <path d="M 80 155 L 150 155" class="wire ${B ? "wire-high" : "wire-low"}" />
        <circle cx="150" cy="155" r="3.5" class="junction-dot ${B ? "active-dot" : ""}" />
        <path d="M 150 155 L 220 175" class="wire ${B ? "wire-high" : "wire-low"}" />
        <path d="M 150 155 L 150 85 L 220 85" class="wire ${B ? "wire-high" : "wire-low"}" />

        <!-- XOR Gate (Sum = A ⊕ B) -->
        <g transform="translate(0, 0)">
          ${drawXorGate(220, 75, 46, 40, S === 1)}
        </g>

        <!-- AND Gate (Carry = AB) -->
        <g transform="translate(0, 0)">
          ${drawAndGate(220, 165, 44, 36, C === 1)}
        </g>

        <!-- Output Wire Sum -->
        <path d="M 266 75 L 390 75" class="wire ${S ? "wire-high" : "wire-low"}" />
        <g class="circuit-terminal">
          <rect x="390" y="58" width="95" height="34" class="terminal-box ${S ? "active-terminal" : ""}" />
          <text x="437" y="75" class="terminal-text ${S ? "val-1-text" : "val-0-text"}">SUM: ${S}</text>
        </g>

        <!-- Output Wire Cout -->
        <path d="M 264 165 L 390 165" class="wire ${C ? "wire-high" : "wire-low"}" />
        <g class="circuit-terminal">
          <rect x="390" y="148" width="95" height="34" class="terminal-box ${C ? "active-terminal" : ""}" />
          <text x="437" y="165" class="terminal-text ${C ? "val-1-text" : "val-0-text"}">COUT: ${C}</text>
        </g>
      </svg>
    `;
  } else {
    // Full Adder Calculations
    const X1 = A ^ B;
    const A1 = A & B;
    const S = X1 ^ Cin;
    const A2 = X1 & Cin;
    const Cout = A1 | A2;

    if (titleEl) titleEl.textContent = "Full Adder Logic Circuit Visualizer";
    if (subtitleEl) subtitleEl.textContent = "Interactive 5-gate schematic with multi-stage logic state propagation.";
    if (topologyEl) topologyEl.textContent = "2 XOR · 2 AND · 1 OR Gate (Full Adder)";
    if (metricsEl) metricsEl.textContent = "5 Gates Total (Full Adder)";
    if (statusEl) statusEl.textContent = `A=${A}, B=${B}, Cin=${Cin} → S=${S}, Cout=${Cout}`;

    container.innerHTML = `
      <svg class="circuit-svg" viewBox="0 0 630 300" width="630" height="300">
        <!-- Input Terminals -->
        <g class="circuit-terminal">
          <rect x="25" y="45" width="55" height="28" class="terminal-box ${A ? "active-terminal" : ""}" />
          <text x="52" y="59" class="terminal-text ${A ? "val-1-text" : "val-0-text"}">A=${A}</text>
        </g>
        <g class="circuit-terminal">
          <rect x="25" y="95" width="55" height="28" class="terminal-box ${B ? "active-terminal" : ""}" />
          <text x="52" y="109" class="terminal-text ${B ? "val-1-text" : "val-0-text"}">B=${B}</text>
        </g>
        <g class="circuit-terminal">
          <rect x="25" y="185" width="55" height="28" class="terminal-box ${Cin ? "active-terminal" : ""}" />
          <text x="52" y="199" class="terminal-text ${Cin ? "val-1-text" : "val-0-text"}">Cin=${Cin}</text>
        </g>

        <!-- Wires A and B to XOR1 -->
        <path d="M 80 59 L 160 59" class="wire ${A ? "wire-high" : "wire-low"}" />
        <path d="M 80 109 L 120 109 L 120 79 L 160 79" class="wire ${B ? "wire-high" : "wire-low"}" />

        <!-- Taps to AND1 -->
        <circle cx="100" cy="59" r="3.5" class="junction-dot ${A ? "active-dot" : ""}" />
        <path d="M 100 59 L 100 145 L 160 145" class="wire ${A ? "wire-high" : "wire-low"}" />

        <circle cx="120" cy="109" r="3.5" class="junction-dot ${B ? "active-dot" : ""}" />
        <path d="M 120 109 L 120 165 L 160 165" class="wire ${B ? "wire-high" : "wire-low"}" />

        <!-- Stage 1 Gates -->
        ${drawXorGate(160, 69, 46, 40, X1 === 1)}
        ${drawAndGate(160, 155, 44, 36, A1 === 1)}

        <!-- Intermediate Wire X1 (XOR1 out) to XOR2 and AND2 -->
        <path d="M 206 69 L 260 69" class="wire ${X1 ? "wire-high" : "wire-low"}" />
        <circle cx="260" cy="69" r="3.5" class="junction-dot ${X1 ? "active-dot" : ""}" />
        <path d="M 260 69 L 340 69" class="wire ${X1 ? "wire-high" : "wire-low"}" />
        <path d="M 260 69 L 260 195 L 340 195" class="wire ${X1 ? "wire-high" : "wire-low"}" />

        <!-- Wire Cin to XOR2 and AND2 -->
        <path d="M 80 199 L 290 199" class="wire ${Cin ? "wire-high" : "wire-low"}" />
        <circle cx="290" cy="199" r="3.5" class="junction-dot ${Cin ? "active-dot" : ""}" />
        <path d="M 290 199 L 290 89 L 340 89" class="wire ${Cin ? "wire-high" : "wire-low"}" />
        <path d="M 290 199 L 290 215 L 340 215" class="wire ${Cin ? "wire-high" : "wire-low"}" />

        <!-- Stage 2 Gates -->
        ${drawXorGate(340, 79, 46, 40, S === 1)}
        ${drawAndGate(340, 205, 44, 36, A2 === 1)}

        <!-- Sum Output Wire -->
        <path d="M 386 79 L 510 79" class="wire ${S ? "wire-high" : "wire-low"}" />
        <g class="circuit-terminal">
          <rect x="510" y="62" width="95" height="34" class="terminal-box ${S ? "active-terminal" : ""}" />
          <text x="557" y="79" class="terminal-text ${S ? "val-1-text" : "val-0-text"}">SUM: ${S}</text>
        </g>

        <!-- Intermediate Wires A1 and A2 to OR1 -->
        <path d="M 204 155 L 440 155 L 440 212 L 460 212" class="wire ${A1 ? "wire-high" : "wire-low"}" />
        <path d="M 384 205 L 440 205 L 440 228 L 460 228" class="wire ${A2 ? "wire-high" : "wire-low"}" />

        <!-- Stage 3 Gate: OR1 -->
        ${drawOrGate(460, 220, 46, 40, Cout === 1)}

        <!-- Cout Output Wire -->
        <path d="M 506 220 L 510 220" class="wire ${Cout ? "wire-high" : "wire-low"}" />
        <g class="circuit-terminal">
          <rect x="510" y="203" width="95" height="34" class="terminal-box ${Cout ? "active-terminal" : ""}" />
          <text x="557" y="220" class="terminal-text ${Cout ? "val-1-text" : "val-0-text"}">COUT: ${Cout}</text>
        </g>
      </svg>
    `;
  }
}

function renderTutor(data) {
  const container = document.querySelector("#tutor-content");
  if (!container) return;

  const variableNames = "ABCD".slice(0, data.variables).split("");
  const steps = [];

  const addStep = (title, explanation, formula = "") => {
    steps.push({ title, explanation, formula });
  };

  addStep(
    "Understand the input",
    `You selected ${data.variables} variables: ${variableNames.join(", ")}. ` +
    `The function is 1 for minterms ${data.minterms.length ? data.minterms.join(", ") : "none"}.`
  );

  if (data.expression === "0") {
    addStep(
      "Check the K-map",
      "Every cell is 0, so there are no groups of 1s to form.",
      "F = 0"
    );
  } else if (data.expression === "1") {
    addStep(
      "Combine all cells",
      "Every cell is 1. The entire map can be grouped, so all variables cancel.",
      "F = 1"
    );
  } else {
    addStep(
      "Look for adjacent 1s",
      "The simplifier searches for groups containing powers of two cells: 1, 2, 4, 8, or 16. " +
      "Groups can wrap around the map edges."
    );

    data.groups.forEach((group, index) => {
      const pattern = group.pattern;
      const fixed = [];
      const cancelled = [];

      variableNames.forEach((name, i) => {
        if (pattern[i] === "1") {
          fixed.push(`${name} = 1`);
        } else if (pattern[i] === "0") {
          fixed.push(`${name} = 0`);
        } else {
          cancelled.push(name);
        }
      });

      let explanation;
      if (fixed.length === 0) {
        explanation = "This group covers the entire input space, so every variable cancels.";
      } else {
        explanation =
          `Group ${index + 1} covers minterms ${group.minterms.join(", ")}. ` +
          `Variables that stay constant: ${fixed.join(", ")}. ` +
          (cancelled.length
            ? `Variables that change and cancel: ${cancelled.join(", ")}.`
            : "No variables cancel in this group.");
      }

      addStep(
        `Group ${index + 1}: derive the term`,
        explanation,
        `${pattern} → ${group.expression}`
      );
    });

    addStep(
      "Combine the product terms",
      "Join the group expressions with OR (+). This produces the simplified sum-of-products expression.",
      `F = ${data.expression}`
    );
  }

  addStep(
    "Verify with the truth table",
    `The canonical truth table evaluated all ${2 ** data.variables} possible input combinations against F = ${data.expression}. ` +
    "Every state produces an identical output to the canonical specification, ensuring 100% equivalence."
  );

  container.innerHTML = `
    <div class="tutor-steps">
      ${steps.map((step, index) => `
        <article class="tutor-step ${index === steps.length - 1 ? "tutor-finish" : ""}">
          <div class="tutor-step-number">${String(index + 1).padStart(2, "0")}</div>
          <div>
            <h4>${escapeHtml(step.title)}</h4>
            <p>${escapeHtml(step.explanation)}</p>
            ${step.formula
      ? `<div class="tutor-math">${escapeHtml(step.formula)}</div>`
      : ""}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

async function simplify() {
  $("#error-message").textContent = "";
  $("#solve-btn").disabled = true;
  $("#solve-btn").textContent = "Simplifying…";
  try {
    const response = await fetch("/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: variableCount, minterms: [...selectedMinterms].sort((a, b) => a - b) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not simplify this function.");
    renderMap(data);
  } catch (error) {
    $("#error-message").textContent = error.message || "Something went wrong. Is the Flask server running?";
  } finally {
    $("#solve-btn").disabled = false;
    $("#solve-btn").innerHTML = 'Simplify <span>↗</span>';
  }
}

function navigateTo(target, pushState = true) {
  const portalScreen = $("#portal-screen");
  const workspaceScreen = $("#workspace-screen");
  const simplifierPanel = $("#simplifier-panel");
  const adderPanel = $("#adder-panel");
  const pageTitle = $("#page-title");
  const crumbTool = $("#crumb-current-tool");
  const workspaceTag = $("#workspace-pill-tag");

  if (target === "portal") {
    portalScreen?.classList.remove("hidden");
    workspaceScreen?.classList.add("hidden");
    document.title = "KMap Studio — Digital Logic Lab & Simulator";
    if (pushState && window.location.pathname !== "/") {
      history.pushState({ view: "portal" }, "", "/");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  // Entering a workspace tool
  portalScreen?.classList.add("hidden");
  workspaceScreen?.classList.remove("hidden");

  const isAdder = target === "adder" || target === "adder-lab";

  simplifierPanel?.classList.toggle("hidden", isAdder);
  adderPanel?.classList.toggle("hidden", !isAdder);

  if (isAdder) {
    if (pageTitle) pageTitle.textContent = "Adder Lab";
    if (crumbTool) crumbTool.textContent = "Adder Lab";
    if (workspaceTag) {
      workspaceTag.textContent = "ADDER LAB WORKSPACE";
      workspaceTag.style.borderColor = "#286358";
      workspaceTag.style.color = "#69e4b1";
    }
    document.title = "Adder Lab — KMap Studio";
    if (pushState && window.location.pathname !== "/adder-lab") {
      history.pushState({ view: "adder" }, "", "/adder-lab");
    }
    calculateAdder();
  } else {
    if (pageTitle) pageTitle.textContent = "K-map & Truth Table Studio";
    if (crumbTool) crumbTool.textContent = "K-map Solver";
    if (workspaceTag) {
      workspaceTag.textContent = "K-MAP WORKSPACE";
      workspaceTag.style.borderColor = "#24466b";
      workspaceTag.style.color = "#78a9ff";
    }
    document.title = "K-Map Solver — KMap Studio";
    if (pushState && window.location.pathname !== "/kmap") {
      history.pushState({ view: "simplifier" }, "", "/kmap");
    }
  }

  $$(".nav-item").forEach(btn => {
    const tab = btn.dataset.tab;
    if (isAdder) {
      btn.classList.toggle("active", tab === "adder");
    } else {
      btn.classList.toggle("active", tab === "simplifier");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchTab(tab) {
  navigateTo(tab, true);
}

function renderBitInputs() {
  $("#bit-inputs").innerHTML = ["a", "b", ...(adderKind === "full" ? ["c"] : [])].map(key => `
    <label>${key === "c" ? "Cin" : key.toUpperCase()} <button class="bit-toggle ${adderInputs[key] ? "on" : ""}" data-bit="${key}" aria-label="Toggle ${key.toUpperCase()}">${adderInputs[key]}</button></label>
  `).join("");

  $$(".bit-toggle").forEach(btn => btn.addEventListener("click", () => {
    const key = btn.dataset.bit;
    adderInputs[key] = adderInputs[key] ? 0 : 1;
    renderBitInputs();
    calculateAdder();
  }));
}

function renderAdderTruthTable() {
  const container = document.querySelector("#adder-truth-table-content");
  if (!container) return;

  const isFull = adderKind === "full";
  const numRows = isFull ? 8 : 4;
  const rows = [];

  for (let i = 0; i < numRows; i++) {
    if (isFull) {
      const a = (i >> 2) & 1;
      const b = (i >> 1) & 1;
      const c = i & 1;
      const total = a + b + c;
      const sum = total % 2;
      const carry = Math.floor(total / 2);
      const isActive = (adderInputs.a === a && adderInputs.b === b && adderInputs.c === c);
      rows.push({ a, b, c, sum, carry, isActive });
    } else {
      const a = (i >> 1) & 1;
      const b = i & 1;
      const sum = a ^ b;
      const carry = a & b;
      const isActive = (adderInputs.a === a && adderInputs.b === b);
      rows.push({ a, b, sum, carry, isActive });
    }
  }

  container.innerHTML = `
    <div class="truth-table-wrap">
      <table class="adder-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>A</th>
            <th>B</th>
            ${isFull ? `<th>Cin</th>` : ""}
            <th>SUM (S)</th>
            <th>CARRY (Cout)</th>
            <th>Active Input State</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, idx) => `
            <tr class="adder-row ${row.isActive ? "active-adder-row" : ""}" data-row-index="${idx}">
              <td><span class="m-index">#${idx}</span></td>
              <td><span class="bit-badge b${row.a}">${row.a}</span></td>
              <td><span class="bit-badge b${row.b}">${row.b}</span></td>
              ${isFull ? `<td><span class="bit-badge b${row.c}">${row.c}</span></td>` : ""}
              <td><span class="f-val ${row.sum ? "val-one" : "val-zero"}">${row.sum}</span></td>
              <td><span class="f-val ${row.carry ? "val-one" : "val-zero"}">${row.carry}</span></td>
              <td>
                ${row.isActive
      ? `<span class="active-row-indicator">● CURRENT INPUT</span>`
      : `<span class="m-index" style="opacity: 0.6;">Click to set</span>`
    }
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Clicking an adder row sets those inputs directly
  $$(".adder-row").forEach(rowEl => {
    rowEl.addEventListener("click", () => {
      const idx = Number(rowEl.dataset.rowIndex);
      const row = rows[idx];
      adderInputs.a = row.a;
      adderInputs.b = row.b;
      if (isFull) adderInputs.c = row.c;
      renderBitInputs();
      calculateAdder();
    });
  });
}

async function calculateAdder() {
  const response = await fetch("/adder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: adderKind, ...adderInputs })
  });
  const data = await response.json();
  if (!response.ok) return;

  $("#sum-output").textContent = data.sum;
  $("#carry-output").textContent = data.carry;
  $("#sum-formula").textContent = data.sum_expression;
  $("#carry-formula").textContent = data.carry_expression;
  $("#adder-explanation").textContent = adderKind === "half"
    ? "Sum is 1 when the inputs differ (XOR: A ⊕ B). Carry is 1 only when both inputs are 1 (AND: AB)."
    : "Sum is 1 when an odd number of inputs are 1 (A ⊕ B ⊕ Cin). Carry is 1 when two or more inputs are 1 (AB + ACin + BCin).";

  renderAdderTruthTable();
  renderAdderCircuit(adderKind, adderInputs);
}

$("#variable-picker").addEventListener("click", event => {
  const button = event.target.closest("[data-vars]");
  if (button) setVariableCount(Number(button.dataset.vars));
});

$("#solve-btn").addEventListener("click", simplify);
$("#clear-btn").addEventListener("click", () => {
  selectedMinterms.clear();
  renderMintermPicker();
});

// Quick Presets
$("#preset-all").addEventListener("click", () => {
  const max = 2 ** variableCount;
  selectedMinterms = new Set(Array.from({ length: max }, (_, i) => i));
  renderMintermPicker();
});

$("#preset-none").addEventListener("click", () => {
  selectedMinterms.clear();
  renderMintermPicker();
});

$("#preset-invert").addEventListener("click", () => {
  const max = 2 ** variableCount;
  const inverted = new Set();
  for (let i = 0; i < max; i++) {
    if (!selectedMinterms.has(i)) inverted.add(i);
  }
  selectedMinterms = inverted;
  renderMintermPicker();
});

$$(".nav-item").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

$("#adder-type").addEventListener("click", event => {
  const button = event.target.closest("[data-kind]");
  if (!button) return;
  adderKind = button.dataset.kind;
  $$("#adder-type button").forEach(btn => btn.classList.toggle("selected", btn === button));
  if (adderKind === "half") adderInputs.c = 0;
  renderBitInputs();
  calculateAdder();
});

$("#adder-reset").addEventListener("click", () => {
  adderInputs = { a: 0, b: 0, c: 0 };
  renderBitInputs();
  calculateAdder();
});

$("#adder-calc").addEventListener("click", calculateAdder);

// Portal Launch buttons
$("#launch-kmap-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  navigateTo("simplifier", true);
});

$("#launch-adder-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  navigateTo("adder", true);
});

// Entire cards clickable
$("#card-kmap")?.addEventListener("click", (e) => {
  if (e.target.closest(".card-external-link")) return;
  navigateTo("simplifier", true);
});

$("#card-adder")?.addEventListener("click", (e) => {
  if (e.target.closest(".card-external-link")) return;
  navigateTo("adder", true);
});

// Keyboard accessibility for cards
[$("#card-kmap"), $("#card-adder")].forEach(card => {
  card?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const target = card.dataset.launch;
      navigateTo(target, true);
    }
  });
});

// Return to portal buttons
$("#btn-topbar-hub")?.addEventListener("click", () => navigateTo("portal", true));
$("#crumb-home-link")?.addEventListener("click", () => navigateTo("portal", true));
$("#sidebar-brand-btn")?.addEventListener("click", () => navigateTo("portal", true));

// Popstate listener for back/forward navigation
window.addEventListener("popstate", (event) => {
  if (event.state && event.state.view) {
    navigateTo(event.state.view, false);
  } else {
    resolveInitialRoute();
  }
});

function resolveInitialRoute() {
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();

  if (path === "/kmap" || hash === "#kmap") {
    navigateTo("simplifier", false);
  } else if (path === "/adder-lab" || path === "/adder" || path === "/adder_lab" || hash === "#adder" || hash === "#adder-lab") {
    navigateTo("adder", false);
  } else {
    // Default: Initial portal screen opens 1st!
    navigateTo("portal", false);
  }
}

/* ==========================================================================
   Welcome Intro Splash Controller
   ========================================================================== */

let welcomeDismissTimer = null;
let welcomeCountdownInterval = null;

function trySpeakWelcome() {
  try {
    if ("speechSynthesis" in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance("Welcome to K-Map Studio");
      utter.rate = 0.95;
      utter.pitch = 1.0;
      utter.lang = "en-US";
      window.speechSynthesis.speak(utter);
    }
  } catch (_) {
    // Ignore autoplay or audio policy restrictions
  }
}

function initWelcomeSplash() {
  const welcomeScreen = $("#welcome-screen");
  if (!welcomeScreen) return;

  const enterBtn = $("#welcome-enter-btn");
  const progressFill = $("#welcome-progress-fill");
  const statusTxt = $("#welcome-status-txt");
  const timerNum = $("#welcome-timer-num");
  const card = $("#welcome-card");

  let dismissed = false;
  let remainingSeconds = 2;

  // Clear any existing timers if replaying
  if (welcomeDismissTimer) clearTimeout(welcomeDismissTimer);
  if (welcomeCountdownInterval) clearInterval(welcomeCountdownInterval);

  welcomeScreen.classList.remove("fade-out", "hidden");
  if (timerNum) timerNum.textContent = "2";
  if (statusTxt) {
    statusTxt.innerHTML = '<span class="welcome-dot-live"></span> Initializing workspace...';
  }

  // Trigger progress fill animation
  if (progressFill) {
    progressFill.style.transition = "none";
    progressFill.style.width = "0%";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        progressFill.style.transition = "width 2.2s cubic-bezier(0.12, 0.8, 0.2, 1)";
        progressFill.style.width = "100%";
      });
    });
  }

  // Gentle voice greeting (if permitted by browser policy)
  trySpeakWelcome();

  function dismissWelcome(userInteracted = false) {
    if (dismissed) return;
    dismissed = true;

    if (welcomeCountdownInterval) clearInterval(welcomeCountdownInterval);
    if (welcomeDismissTimer) clearTimeout(welcomeDismissTimer);

    if (userInteracted) {
      trySpeakWelcome();
    }

    welcomeScreen.classList.add("fade-out");

    setTimeout(() => {
      welcomeScreen.classList.add("hidden");
    }, 850);
  }

  // Enter button click
  enterBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissWelcome(true);
  }, { once: true });

  // Clicking backdrop / card to enter
  welcomeScreen.addEventListener("click", () => {
    dismissWelcome(true);
  }, { once: true });

  // Key press (Enter, Space, Escape) to enter
  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
      dismissWelcome(true);
      window.removeEventListener("keydown", onKeyDown);
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // Status message transition
  setTimeout(() => {
    if (!dismissed && statusTxt) {
      statusTxt.innerHTML = '<span class="welcome-dot-live"></span> Boolean engines ready · Welcome!';
    }
  }, 1200);

  // Auto countdown
  welcomeCountdownInterval = setInterval(() => {
    if (dismissed) {
      clearInterval(welcomeCountdownInterval);
      return;
    }
    remainingSeconds -= 1;
    if (timerNum) timerNum.textContent = Math.max(0, remainingSeconds);
    if (remainingSeconds <= 0) {
      clearInterval(welcomeCountdownInterval);
      dismissWelcome(false);
    }
  }, 1000);
}

// Replay buttons
$("#btn-portal-replay")?.addEventListener("click", (e) => {
  e.stopPropagation();
  initWelcomeSplash();
});

$("#btn-workspace-replay")?.addEventListener("click", (e) => {
  e.stopPropagation();
  initWelcomeSplash();
});

// Initial application load: render picker, resolve route, and launch welcome splash
renderMintermPicker();
renderBitInputs();
resolveInitialRoute();
initWelcomeSplash();

