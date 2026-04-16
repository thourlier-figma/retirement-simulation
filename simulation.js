const form = document.getElementById('pension-form');
const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('results-summary');
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

  // Simulate drawdown phase (retirement to end age)
  const drawdownFromContrib = simulateDrawdown(inputs, withContrib[withContrib.length - 1].pot);
  const drawdownFromStop = stopPath
    ? simulateDrawdown(inputs, stopPath[stopPath.length - 1].pot)
    : null;

  renderSummary(inputs, withContrib, stopAge, drawdownFromContrib);
  renderChart(inputs, withContrib, stopPath, stopAge, drawdownFromContrib, drawdownFromStop);
  renderTable(inputs, withContrib, stopPath, stopAge, drawdownFromContrib, drawdownFromStop);
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

// Simulate drawdown phase from retirement to endAge
function simulateDrawdown(inputs, potAtRetirement) {
  const years = inputs.endAge - inputs.retirementAge;
  const rows = [];
  let pot = potAtRetirement;
  let spending = inputs.annualSpending;
  const currentYear = new Date().getFullYear();
  const yearsToRetirement = inputs.retirementAge - inputs.currentAge;

  for (let y = 0; y <= years; y++) {
    const age = inputs.retirementAge + y;

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

function renderSummary(inputs, withContrib, stopAge, drawdown) {
  const finalPot = withContrib[withContrib.length - 1].pot;
  const totalContributed = withContrib.reduce((s, r) => s + r.contribution, 0);

  let html = '';

  if (stopAge !== null) {
    const yearsContributing = stopAge - inputs.currentAge;
    html += `
      <p class="headline success">
        You can stop contributing at age <span class="stop-age-highlight">${stopAge}</span>
      </p>
      <p class="detail">
        That's ${yearsContributing} more year${yearsContributing !== 1 ? 's' : ''} of contributions.
        After that, passive growth at ${(inputs.growthRate * 100).toFixed(1)}% will carry
        your pot to ${fmt(inputs.targetPot)} by age ${inputs.retirementAge}.
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

  html += `
    <p class="detail">
      Pot at retirement (with contributions throughout): <strong>${fmt(finalPot)}</strong>
      &nbsp;|&nbsp; Total contributed: <strong>${fmt(totalContributed)}</strong>
    </p>
  `;

  // Drawdown summary
  const depletedRow = drawdown.find(r => r.depleted);
  if (depletedRow) {
    html += `
      <p class="detail" style="margin-top: 0.75rem; color: #c45500; font-weight: 600;">
        Pot runs out at age ${depletedRow.age}
        (spending ${fmt(inputs.annualSpending)}/year, inflating at ${(inputs.spendingInflation * 100).toFixed(1)}%).
      </p>
    `;
  } else {
    const lastDrawdown = drawdown[drawdown.length - 1];
    html += `
      <p class="detail" style="margin-top: 0.75rem; color: #1a8917; font-weight: 600;">
        Pot lasts beyond age ${inputs.endAge} &mdash; ${fmt(lastDrawdown.pot)} remaining
        (spending ${fmt(inputs.annualSpending)}/year, inflating at ${(inputs.spendingInflation * 100).toFixed(1)}%).
      </p>
    `;
  }

  summaryEl.innerHTML = html;
}

function renderChart(inputs, withContrib, stopPath, stopAge, drawdownContrib, drawdownStop) {
  // Build full timeline labels from currentAge to endAge
  const totalYears = inputs.endAge - inputs.currentAge;
  const labels = [];
  for (let y = 0; y <= totalYears; y++) {
    labels.push(`Age ${inputs.currentAge + y}`);
  }

  // Helper: merge accumulation and drawdown into full-length array
  // Accumulation covers indices 0..yearsToRetirement, drawdown covers retirement onward
  // drawdown[0] is the retirement age (overlaps with last accumulation entry)
  function fullSeries(accum, drawdown) {
    const data = new Array(labels.length).fill(null);
    for (let i = 0; i < accum.length; i++) {
      data[i] = Math.round(accum[i].pot);
    }
    // drawdown starts at retirement; drawdown[0] overlaps with accum's last entry
    const retirementIndex = inputs.retirementAge - inputs.currentAge;
    for (let i = 1; i < drawdown.length; i++) {
      data[retirementIndex + i] = Math.round(drawdown[i].pot);
    }
    return data;
  }

  const datasets = [
    {
      label: 'With continuous contributions',
      data: fullSeries(withContrib, drawdownContrib),
      borderColor: '#0071e3',
      backgroundColor: 'rgba(0, 113, 227, 0.08)',
      fill: true,
      tension: 0.3,
      spanGaps: true,
    },
  ];

  if (stopPath && drawdownStop) {
    datasets.push({
      label: `Stop contributing at age ${stopAge}`,
      data: fullSeries(stopPath, drawdownStop),
      borderColor: '#1a8917',
      backgroundColor: 'rgba(26, 137, 23, 0.08)',
      fill: true,
      tension: 0.3,
      borderDash: [6, 3],
      spanGaps: true,
    });
  }

  // Target line
  datasets.push({
    label: `Target: ${fmt(inputs.targetPot)}`,
    data: labels.map(() => inputs.targetPot),
    borderColor: '#c45500',
    borderDash: [4, 4],
    borderWidth: 1.5,
    pointRadius: 0,
    fill: false,
  });

  if (chart) {
    chart.destroy();
  }

  const ctx = document.getElementById('chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y !== null ? `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` : null,
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => fmt(v),
          },
        },
      },
    },
  });
}

function renderTable(inputs, withContrib, stopPath, stopAge, drawdownContrib, drawdownStop) {
  tableBody.innerHTML = '';

  // Accumulation phase
  withContrib.forEach((row, i) => {
    const stopPot = stopPath ? stopPath[i].pot : null;
    const tr = document.createElement('tr');

    if (stopAge && row.age === stopAge) {
      tr.classList.add('stop-row');
    }
    if (row.age === inputs.retirementAge) {
      tr.classList.add('retirement-row');
    }

    tr.innerHTML = `
      <td>${row.age}</td>
      <td>${row.year}</td>
      <td>${fmt(row.pot)}</td>
      <td>${stopPot !== null ? fmt(stopPot) : '-'}</td>
      <td>${fmt(row.contribution)}</td>
      <td>-</td>
    `;
    tableBody.appendChild(tr);
  });

  // Drawdown phase (skip index 0 which is the retirement age, already shown above)
  for (let i = 1; i < drawdownContrib.length; i++) {
    const row = drawdownContrib[i];
    const stopRow = drawdownStop ? drawdownStop[i] : null;
    const tr = document.createElement('tr');

    if (row.depleted) {
      tr.classList.add('depleted-row');
    }

    tr.innerHTML = `
      <td>${row.age}</td>
      <td>${row.year}</td>
      <td>${fmt(row.pot)}</td>
      <td>${stopRow ? fmt(stopRow.pot) : '-'}</td>
      <td>-</td>
      <td>${fmt(row.spending)}</td>
    `;
    tableBody.appendChild(tr);
  }
}
