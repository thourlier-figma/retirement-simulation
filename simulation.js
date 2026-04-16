const form = document.getElementById('pension-form');
const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('results-summary');
const tableBody = document.querySelector('#results-table tbody');
let chart = null;

const STORAGE_KEY = 'pension-sim-settings';
const INPUT_IDS = [
  'currentAge', 'retirementAge', 'currentPot', 'salary',
  'employeeContrib', 'employerContrib', 'growthRate', 'salaryGrowth', 'targetPot',
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

  // Simulate year-by-year WITH contributions
  const withContrib = simulateWithContributions(inputs, yearsToRetirement);

  // Find the earliest age you can stop contributing and still hit the target
  // by letting the pot grow passively from that point.
  const stopAge = findStopAge(inputs, yearsToRetirement);

  // Simulate the "stop at stopAge" path for charting
  const stopPath = stopAge !== null
    ? simulateStopAt(inputs, yearsToRetirement, stopAge)
    : null;

  renderSummary(inputs, withContrib, stopAge);
  renderChart(inputs, withContrib, stopPath, stopAge);
  renderTable(inputs, withContrib, stopPath, stopAge);
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

function renderSummary(inputs, withContrib, stopAge) {
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

  summaryEl.innerHTML = html;
}

function renderChart(inputs, withContrib, stopPath, stopAge) {
  const labels = withContrib.map(r => `Age ${r.age}`);

  const datasets = [
    {
      label: 'With continuous contributions',
      data: withContrib.map(r => Math.round(r.pot)),
      borderColor: '#0071e3',
      backgroundColor: 'rgba(0, 113, 227, 0.08)',
      fill: true,
      tension: 0.3,
    },
  ];

  if (stopPath) {
    datasets.push({
      label: `Stop contributing at age ${stopAge}`,
      data: stopPath.map(r => Math.round(r.pot)),
      borderColor: '#1a8917',
      backgroundColor: 'rgba(26, 137, 23, 0.08)',
      fill: true,
      tension: 0.3,
      borderDash: [6, 3],
    });
  }

  // Target line
  datasets.push({
    label: `Target: ${fmt(inputs.targetPot)}`,
    data: withContrib.map(() => inputs.targetPot),
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
            label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
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

function renderTable(inputs, withContrib, stopPath, stopAge) {
  tableBody.innerHTML = '';
  const stopYear = stopAge ? stopAge - inputs.currentAge : null;

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
    `;
    tableBody.appendChild(tr);
  });
}
