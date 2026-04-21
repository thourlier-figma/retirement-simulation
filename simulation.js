const form = document.getElementById('pension-form');
const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('results-summary');
const statCardsEl = document.getElementById('stat-cards');
const tableBody = document.querySelector('#results-table tbody');
let chart = null;

const STORAGE_KEY = 'pension-sim-settings';
const INPUT_IDS = [
  'currentAge', 'retirementAge', 'currentPot', 'salary',
  'employeeContrib', 'employerContrib', 'growthRate', 'salaryGrowth', 'targetPot',
  'annualSpending', 'spendingInflation', 'endAge',
];

function saveSettings() {
  const settings = {};
  for (const id of INPUT_IDS) {
    settings[id] = document.getElementById(id).value;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const settings = JSON.parse(raw);
    for (const id of INPUT_IDS) {
      if (settings[id] !== undefined) {
        document.getElementById(id).value = settings[id];
      }
    }
  } catch { /* ignore corrupted data */ }
}

loadSettings();

for (const id of INPUT_IDS) {
  document.getElementById(id).addEventListener('input', saveSettings);
}
runSimulation();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSimulation();
});

function getInputs() {
  return {
    currentAge: Number(document.getElementById('currentAge').value),
    retirementAge: Number(document.getElementById('retirementAge').value),
    currentPot: Number(document.getElementById('currentPot').value),
    salary: Number(document.getElementById('salary').value),
    employeeContrib: Number(document.getElementById('employeeContrib').value) / 100,
    employerContrib: Number(document.getElementById('employerContrib').value) / 100,
    growthRate: Number(document.getElementById('growthRate').value) / 100,
    salaryGrowth: Number(document.getElementById('salaryGrowth').value) / 100,
    targetPot: Number(document.getElementById('targetPot').value),
    annualSpending: Number(document.getElementById('annualSpending').value),
    spendingInflation: Number(document.getElementById('spendingInflation').value) / 100,
    endAge: Number(document.getElementById('endAge').value),
  };
}

function fmt(n) {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function runSimulation() {
  const inputs = getInputs();
  const yearsToRetirement = inputs.retirementAge - inputs.currentAge;

  if (yearsToRetirement <= 0) {
    summaryEl.innerHTML = '<p class="headline warning">Retirement age must be greater than current age.</p>';
    resultsEl.classList.remove('hidden');
    return;
  }

  if (inputs.endAge <= inputs.retirementAge) {
    summaryEl.innerHTML = '<p class="headline warning">End age must be greater than retirement age.</p>';
    resultsEl.classList.remove('hidden');
    return;
  }

  // Simulate year-by-year WITH contributions
  const withContrib = simulateWithContributions(inputs, yearsToRetirement);

  // Find the earliest age you can stop contributing and still hit the target
  // by letting the pot grow passively from that point.
  const stopAge = findStopAge(inputs, yearsToRetirement);

  // Simulate the "stop at stopAge" path for charting
  const stopPath = stopAge !== null
    ? simulateStopAt(inputs, yearsToRetirement, stopAge)
    : null;

  // Find ideal retirement age: earliest age where pot hits £0 at endAge
  const idealRetirementAge = findIdealRetirementAge(inputs);

  // Simulate drawdown from the target retirement age (user's input)
  const drawdownFromTarget = simulateDrawdown(inputs, inputs.retirementAge, withContrib[withContrib.length - 1].pot);

  // Simulate drawdown from the ideal retirement age
  const idealPotAtRetirement = idealRetirementAge !== null
    ? getPotAtYear(inputs, idealRetirementAge - inputs.currentAge)
    : null;
  const drawdownFromIdeal = idealRetirementAge !== null
    ? simulateDrawdown(inputs, idealRetirementAge, idealPotAtRetirement)
    : null;

  // Accumulation path for ideal scenario (contribute until ideal retirement)
  const idealAccum = idealRetirementAge !== null
    ? simulateWithContributions(inputs, idealRetirementAge - inputs.currentAge)
    : null;

  renderSummary(inputs, withContrib, stopAge, idealRetirementAge, idealPotAtRetirement, drawdownFromTarget, drawdownFromIdeal);
  renderChart(inputs, withContrib, stopPath, stopAge, idealAccum, drawdownFromTarget, drawdownFromIdeal, idealRetirementAge);
  renderTable(inputs, withContrib, stopPath, stopAge, idealAccum, drawdownFromTarget, drawdownFromIdeal, idealRetirementAge);
  resultsEl.classList.remove('hidden');
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Returns array of { age, year, pot, contribution, salary } for each year
function simulateWithContributions(inputs, years) {
  const rows = [];
  let pot = inputs.currentPot;
  let salary = inputs.salary;
  const currentYear = new Date().getFullYear();

  for (let y = 0; y <= years; y++) {
    const age = inputs.currentAge + y;
    const annualContrib = y === 0 ? 0 : salary * (inputs.employeeContrib + inputs.employerContrib);

    if (y > 0) {
      pot = pot * (1 + inputs.growthRate) + annualContrib;
      salary = salary * (1 + inputs.salaryGrowth);
    }

    rows.push({
      age,
      year: currentYear + y,
      pot,
      contribution: annualContrib,
      salary,
    });
  }
  return rows;
}

// Find earliest age where stopping contributions still reaches target
function findStopAge(inputs, yearsToRetirement) {
  // Try stopping at each age from current age to retirement
  for (let stopYear = 0; stopYear <= yearsToRetirement; stopYear++) {
    const potAtStop = getPotAtYear(inputs, stopYear);
    const remainingYears = yearsToRetirement - stopYear;
    const projectedPot = potAtStop * Math.pow(1 + inputs.growthRate, remainingYears);

    if (projectedPot >= inputs.targetPot) {
      return inputs.currentAge + stopYear;
    }
  }
  return null; // Can't reach target even with contributions the whole way
}

// Find earliest retirement age where the pot just runs out at endAge (£0 at death)
function findIdealRetirementAge(inputs) {
  // Try each possible retirement age from earliest to latest
  // Find the earliest age where the pot reaches 0 at or after endAge
  for (let retAge = inputs.currentAge + 1; retAge < inputs.endAge; retAge++) {
    const yearsContributing = retAge - inputs.currentAge;
    const potAtRetirement = getPotAtYear(inputs, yearsContributing);

    // Simulate drawdown from this retirement age to endAge
    let pot = potAtRetirement;
    let spending = inputs.annualSpending;
    let runsOutBeforeEnd = false;

    for (let y = 1; y <= inputs.endAge - retAge; y++) {
      pot = pot * (1 + inputs.growthRate) - spending;
      spending = spending * (1 + inputs.spendingInflation);
      if (pot <= 0) {
        runsOutBeforeEnd = true;
        break;
      }
    }

    // Pot lasted exactly to endAge (or just past it) — this is the ideal age
    if (!runsOutBeforeEnd) return retAge;
  }
  return null;
}

// Get pot value at a given year offset (with contributions up to that point)
function getPotAtYear(inputs, targetYear) {
  let pot = inputs.currentPot;
  let salary = inputs.salary;

  for (let y = 1; y <= targetYear; y++) {
    const annualContrib = salary * (inputs.employeeContrib + inputs.employerContrib);
    pot = pot * (1 + inputs.growthRate) + annualContrib;
    salary = salary * (1 + inputs.salaryGrowth);
  }
  return pot;
}

// Simulate path where contributions stop at a given age
function simulateStopAt(inputs, years, stopAge) {
  const rows = [];
  let pot = inputs.currentPot;
  let salary = inputs.salary;
  const currentYear = new Date().getFullYear();
  const stopYear = stopAge - inputs.currentAge;

  for (let y = 0; y <= years; y++) {
    const age = inputs.currentAge + y;
    const contributing = y <= stopYear && y > 0;
    const annualContrib = contributing ? salary * (inputs.employeeContrib + inputs.employerContrib) : 0;

    if (y > 0) {
      pot = pot * (1 + inputs.growthRate) + annualContrib;
      if (contributing) {
        salary = salary * (1 + inputs.salaryGrowth);
      }
    }

    rows.push({
      age,
      year: currentYear + y,
      pot,
      contribution: annualContrib,
    });
  }
  return rows;
}

// Simulate drawdown phase from a given retirement age to endAge
function simulateDrawdown(inputs, retirementAge, potAtRetirement) {
  const years = inputs.endAge - retirementAge;
  const rows = [];
  let pot = potAtRetirement;
  let spending = inputs.annualSpending;
  const currentYear = new Date().getFullYear();
  const yearsToRetirement = retirementAge - inputs.currentAge;

  for (let y = 0; y <= years; y++) {
    const age = retirementAge + y;

    if (y > 0) {
      pot = pot * (1 + inputs.growthRate) - spending;
      spending = spending * (1 + inputs.spendingInflation);
    }

    rows.push({
      age,
      year: currentYear + yearsToRetirement + y,
      pot: Math.max(pot, 0),
      spending: y === 0 ? 0 : spending / (1 + inputs.spendingInflation), // spending for this year
      depleted: pot <= 0,
    });

    if (pot <= 0) break; // Stop once depleted
  }
  return rows;
}

function renderSummary(inputs, withContrib, stopAge, idealRetirementAge, idealPotAtRetirement, drawdownFromTarget, drawdownFromIdeal) {
  const finalPot = withContrib[withContrib.length - 1].pot;
  const totalContributed = withContrib.reduce((s, r) => s + r.contribution, 0);

  let html = '<div class="summary-ages">';

  if (stopAge !== null) {
    html += `
        <div class="summary-age-item">
          <span class="summary-age-label">Stop contributing</span>
          <span class="stop-age-highlight">${stopAge}</span>
        </div>
    `;
  }

  if (idealRetirementAge !== null) {
    html += `
        <div class="summary-age-item">
          <span class="summary-age-label">Ideal retirement</span>
          <span class="stop-age-highlight retirement">${idealRetirementAge}</span>
        </div>
    `;
  }

  html += '</div>';

  if (stopAge !== null) {
    const yearsContributing = stopAge - inputs.currentAge;
    html += `
      <p class="detail">
        Stop contributing after ${yearsContributing} year${yearsContributing !== 1 ? 's' : ''} &mdash;
        passive growth at ${(inputs.growthRate * 100).toFixed(1)}% carries your pot to ${fmt(inputs.targetPot)} by age ${inputs.retirementAge}.
      </p>
    `;
  } else {
    html += `
      <p class="headline warning">
        You won't reach ${fmt(inputs.targetPot)} by age ${inputs.retirementAge} even with continuous contributions.
      </p>
      <p class="detail">
        With current inputs, your pot would reach ${fmt(finalPot)} at retirement.
        Consider increasing contributions, adjusting your target, or pushing retirement age back.
      </p>
    `;
  }

  if (idealRetirementAge !== null) {
    html += `
      <p class="detail">
        Retire at ${idealRetirementAge}, spend ${fmt(inputs.annualSpending)}/year
        (${(inputs.spendingInflation * 100).toFixed(1)}% inflation), and your pot hits £0 at age ${inputs.endAge}.
      </p>
    `;
  } else {
    html += `
      <p class="detail" style="color: #fca5a5;">
        Even contributing until age ${inputs.endAge - 1}, your pot can't sustain ${fmt(inputs.annualSpending)}/year through age ${inputs.endAge}.
      </p>
    `;
  }

  summaryEl.innerHTML = html;

  // Stat cards
  let cards = '';

  if (stopAge !== null) {
    cards += `
      <div class="stat-card" data-color="emerald">
        <div class="stat-label">Stop Contributing</div>
        <div class="stat-value">Age ${stopAge}</div>
        <div class="stat-sub">${stopAge - inputs.currentAge} years from now</div>
      </div>
    `;
  }

  if (idealRetirementAge !== null) {
    cards += `
      <div class="stat-card" data-color="blue">
        <div class="stat-label">Ideal Retirement</div>
        <div class="stat-value">Age ${idealRetirementAge}</div>
        <div class="stat-sub">${idealRetirementAge - inputs.currentAge} years from now</div>
      </div>
      <div class="stat-card" data-color="violet">
        <div class="stat-label">Pot at Ideal Retirement</div>
        <div class="stat-value">${fmt(idealPotAtRetirement)}</div>
        <div class="stat-sub">Lasts exactly to age ${inputs.endAge}</div>
      </div>
    `;
  }

  cards += `
    <div class="stat-card" data-color="amber">
      <div class="stat-label">Pot at ${inputs.retirementAge} (target)</div>
      <div class="stat-value">${fmt(finalPot)}</div>
      <div class="stat-sub">With continuous contributions</div>
    </div>
  `;

  statCardsEl.innerHTML = cards;
}


function renderChart(inputs, withContrib, stopPath, stopAge, idealAccum, drawdownFromTarget, drawdownFromIdeal, idealRetirementAge) {
  // Build full timeline labels from currentAge to endAge
  const totalYears = inputs.endAge - inputs.currentAge;
  const labels = [];
  for (let y = 0; y <= totalYears; y++) {
    labels.push(`Age ${inputs.currentAge + y}`);
  }

  // Helper: merge accumulation and drawdown into full-length array
  function fullSeries(accum, drawdown, retAge) {
    const data = new Array(labels.length).fill(null);
    for (let i = 0; i < accum.length; i++) {
      data[i] = Math.round(accum[i].pot);
    }
    const retirementIndex = retAge - inputs.currentAge;
    for (let i = 1; i < drawdown.length; i++) {
      data[retirementIndex + i] = Math.round(drawdown[i].pot);
    }
    return data;
  }

  const datasets = [];

  // Ideal retirement scenario (primary)
  if (idealAccum && drawdownFromIdeal) {
    datasets.push({
      label: `Ideal: retire at ${idealRetirementAge}, £0 at ${inputs.endAge}`,
      data: fullSeries(idealAccum, drawdownFromIdeal, idealRetirementAge),
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
      fill: true,
      tension: 0.35,
      spanGaps: true,
      pointRadius: 0,
      pointHoverRadius: 5,
      borderWidth: 2.5,
    });
  }

  // Target retirement scenario
  datasets.push({
    label: `Retire at ${inputs.retirementAge} (target)`,
    data: fullSeries(withContrib, drawdownFromTarget, inputs.retirementAge),
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
    fill: true,
    tension: 0.35,
    borderDash: [6, 3],
    spanGaps: true,
    pointRadius: 0,
    pointHoverRadius: 5,
    borderWidth: 2.5,
  });

  // Target pot line
  datasets.push({
    label: `Target pot: ${fmt(inputs.targetPot)}`,
    data: labels.map(() => inputs.targetPot),
    borderColor: '#f59e0b',
    borderDash: [6, 4],
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
  });

  if (chart) {
    chart.destroy();
  }

  const ctx = document.getElementById('chart').getContext('2d');

  // Gradient fills
  if (idealAccum && drawdownFromIdeal) {
    const blueGrad = ctx.createLinearGradient(0, 0, 0, 400);
    blueGrad.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
    blueGrad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    datasets[0].backgroundColor = blueGrad;
  }

  const greenIdx = idealAccum && drawdownFromIdeal ? 1 : 0;
  const greenGrad = ctx.createLinearGradient(0, 0, 0, 400);
  greenGrad.addColorStop(0, 'rgba(16, 185, 129, 0.12)');
  greenGrad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
  datasets[greenIdx].backgroundColor = greenGrad;

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
            pointStyle: 'line',
            padding: 20,
            font: { size: 12 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleFont: { size: 13, weight: '600' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ctx.parsed.y !== null ? `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` : null,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
            font: { size: 11 },
            color: '#9ca3af',
          },
          grid: { display: false },
        },
        y: {
          ticks: {
            callback: (v) => fmt(v),
            font: { size: 11 },
            color: '#9ca3af',
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.04)',
          },
          border: { display: false },
        },
      },
    },
  });
}

function renderTable(inputs, withContrib, stopPath, stopAge, idealAccum, drawdownFromTarget, drawdownFromIdeal, idealRetirementAge) {
  tableBody.innerHTML = '';

  // Build a unified timeline from currentAge to endAge
  const currentYear = new Date().getFullYear();

  for (let age = inputs.currentAge; age <= inputs.endAge; age++) {
    const yr = age - inputs.currentAge;
    const year = currentYear + yr;
    const tr = document.createElement('tr');

    // Highlight rows
    if (stopAge && age === stopAge) tr.classList.add('stop-row');
    if (age === inputs.retirementAge) tr.classList.add('retirement-row');
    if (idealRetirementAge && age === idealRetirementAge) tr.classList.add('retirement-row');

    // Target scenario: accumulation then drawdown
    let targetPot = '-';
    let contribution = '-';
    let spending = '-';

    if (yr < withContrib.length) {
      targetPot = fmt(withContrib[yr].pot);
      contribution = fmt(withContrib[yr].contribution);
    }
    const drawdownTargetIdx = age - inputs.retirementAge;
    if (drawdownTargetIdx > 0 && drawdownTargetIdx < drawdownFromTarget.length) {
      targetPot = fmt(drawdownFromTarget[drawdownTargetIdx].pot);
      spending = fmt(drawdownFromTarget[drawdownTargetIdx].spending);
      contribution = '-';
      if (drawdownFromTarget[drawdownTargetIdx].depleted) tr.classList.add('depleted-row');
    }

    // Ideal scenario
    let idealPot = '-';
    if (idealAccum && idealRetirementAge) {
      const idealYr = age - inputs.currentAge;
      if (idealYr < idealAccum.length) {
        idealPot = fmt(idealAccum[idealYr].pot);
      }
      const drawdownIdealIdx = age - idealRetirementAge;
      if (drawdownFromIdeal && drawdownIdealIdx > 0 && drawdownIdealIdx < drawdownFromIdeal.length) {
        idealPot = fmt(drawdownFromIdeal[drawdownIdealIdx].pot);
      }
    }

    tr.innerHTML = `
      <td>${age}</td>
      <td>${year}</td>
      <td>${targetPot}</td>
      <td>${idealPot}</td>
      <td>${contribution}</td>
      <td>${spending}</td>
    `;
    tableBody.appendChild(tr);
  }
}
