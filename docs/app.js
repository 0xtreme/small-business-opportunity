const state = {
  dataset: null,
  selectedState: 'ALL',
  selectedIndustry: 'P',
  sa2Query: '',
};

function num(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return value.toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function getIndustryLabelByCode() {
  const map = new Map();
  (state.dataset?.industries ?? []).forEach((item) => {
    map.set(item.industry_code, item.industry_label);
  });
  return map;
}

function filteredRankings() {
  const rankings = state.dataset?.sa2_rankings ?? [];
  const query = state.sa2Query.trim().toLowerCase();

  return rankings.filter((row) => {
    if (state.selectedState !== 'ALL' && String(row.state_code) !== state.selectedState) {
      return false;
    }
    if (query && !row.sa2_name.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

function filteredIndustryRows() {
  const rows = state.dataset?.top_opportunities ?? [];
  return rows.filter((row) => {
    if (row.industry_code !== state.selectedIndustry) {
      return false;
    }
    if (state.selectedState !== 'ALL' && String(row.state_code) !== state.selectedState) {
      return false;
    }
    if (state.sa2Query && !row.sa2_name.toLowerCase().includes(state.sa2Query.toLowerCase())) {
      return false;
    }
    return true;
  });
}

function renderSummaryCards(rankings) {
  const cards = document.getElementById('summaryCards');
  if (!cards) {
    return;
  }

  const topScore = rankings[0]?.total_opportunity_score ?? null;
  const meanScore =
    rankings.length > 0
      ? rankings.reduce((sum, row) => sum + row.total_opportunity_score, 0) / rankings.length
      : null;

  const bestSa2 = rankings[0]?.sa2_name ?? 'N/A';
  const bestState = rankings[0]?.state_name ?? '';

  cards.innerHTML = [
    {
      label: 'SA2 rows shown',
      value: num(rankings.length),
    },
    {
      label: 'Top opportunity score',
      value: num(topScore, 1),
    },
    {
      label: 'Average score (shown)',
      value: num(meanScore, 1),
    },
    {
      label: 'Highest SA2',
      value: bestSa2 === 'N/A' ? 'N/A' : `${bestSa2} (${bestState})`,
    },
  ]
    .map(
      (card) =>
        `<article class="card"><h3>${card.label}</h3><p>${card.value}</p></article>`,
    )
    .join('');
}

function renderRankingChart(rankings) {
  const chartEl = document.getElementById('rankingChart');
  if (!chartEl) {
    return;
  }

  const top = rankings.slice(0, 20);

  const y = top.map((row) => `${row.sa2_name}, ${row.state_name}`);
  const x = top.map((row) => row.total_opportunity_score);

  const trace = {
    type: 'bar',
    orientation: 'h',
    x,
    y,
    marker: {
      color: '#0b7f62',
    },
    hovertemplate: '%{y}<br>Opportunity score: %{x:.1f}<extra></extra>',
  };

  Plotly.newPlot(chartEl, [trace], {
    margin: { t: 8, l: 220, r: 20, b: 60 },
    xaxis: { title: 'Opportunity Score' },
    yaxis: { autorange: 'reversed' },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
  }, { responsive: true, displaylogo: false });
}

function renderScatter(rankings) {
  const chartEl = document.getElementById('industryScatter');
  if (!chartEl) {
    return;
  }

  const profileBySa2 = new Map(rankings.map((row) => [row.sa2_code, row]));
  const rows = filteredIndustryRows().slice(0, 1200);

  const trace = {
    type: 'scattergl',
    mode: 'markers',
    x: rows.map((row) => row.underserved_businesses),
    y: rows.map((row) => row.demand_index),
    text: rows.map((row) => {
      const r = profileBySa2.get(row.sa2_code);
      return `${row.sa2_name}, ${row.state_name}<br>${row.industry_label}<br>Population: ${num(
        r?.population_latest,
      )}<br>Observed: ${num(row.observed_businesses)}<br>Expected: ${num(
        row.expected_businesses_state_median_density,
        1,
      )}`;
    }),
    marker: {
      size: rows.map((row) => {
        const r = profileBySa2.get(row.sa2_code);
        const pop = Number(r?.population_latest ?? 0);
        return Math.max(6, Math.min(28, Math.sqrt(pop) / 7));
      }),
      color: rows.map((row) => row.opportunity_score),
      colorscale: 'YlGnBu',
      opacity: 0.82,
      showscale: true,
      colorbar: {
        title: 'Score',
      },
      line: {
        width: 0.4,
        color: '#2f3a4d',
      },
    },
    hovertemplate: '%{text}<br>Underserved businesses: %{x:.1f}<br>Demand index: %{y:.2f}<extra></extra>',
  };

  Plotly.newPlot(chartEl, [trace], {
    margin: { t: 8, l: 60, r: 20, b: 60 },
    xaxis: { title: 'Underserved Businesses (vs state median density)' },
    yaxis: { title: 'Demand Index (0-1)', range: [0, 1] },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
  }, { responsive: true, displaylogo: false });
}

function renderTable(rankings) {
  const body = document.getElementById('rankingTableBody');
  if (!body) {
    return;
  }

  const top = rankings.slice(0, 60);

  body.innerHTML = top
    .map((row, index) => {
      const picks = (row.top_industries ?? [])
        .slice(0, 3)
        .map((item) => `${item.industry_label} (${num(item.opportunity_score, 1)})`)
        .join('<br>');

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${row.sa2_name}</td>
          <td>${row.state_name}</td>
          <td>${num(row.population_latest)}</td>
          <td>${picks || 'N/A'}</td>
          <td>${num(row.total_opportunity_score, 1)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderMeta() {
  const metaLine = document.getElementById('metaLine');
  if (!metaLine) {
    return;
  }

  const meta = state.dataset?.metadata;
  if (!meta) {
    return;
  }

  const generatedAt = new Date(meta.generated_at).toLocaleString('en-AU');
  metaLine.textContent = `Generated: ${generatedAt} | Business year: June ${meta.business_reference_year} | Population year: ${meta.population_reference_year}`;
}

function renderAll() {
  const rankings = filteredRankings();
  renderSummaryCards(rankings);
  renderRankingChart(rankings);
  renderScatter(rankings);
  renderTable(rankings);
}

function initControls() {
  const stateSelect = document.getElementById('stateSelect');
  const industrySelect = document.getElementById('industrySelect');
  const searchInput = document.getElementById('searchInput');

  if (!stateSelect || !industrySelect || !searchInput) {
    return;
  }

  const stateMap = new Map();
  (state.dataset.sa2_rankings ?? []).forEach((row) => {
    stateMap.set(String(row.state_code), row.state_name);
  });

  const orderedStateEntries = [...stateMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));

  stateSelect.innerHTML = [
    '<option value="ALL">All states and territories</option>',
    ...orderedStateEntries.map(([code, name]) => `<option value="${code}">${name}</option>`),
  ].join('');

  const industryLabelByCode = getIndustryLabelByCode();
  const focusCodes = state.dataset.metadata.focus_industry_codes;

  industrySelect.innerHTML = focusCodes
    .map((code) => `<option value="${code}">${industryLabelByCode.get(code) ?? code}</option>`)
    .join('');

  industrySelect.value = focusCodes.includes(state.selectedIndustry)
    ? state.selectedIndustry
    : focusCodes[0];
  state.selectedIndustry = industrySelect.value;

  stateSelect.addEventListener('change', (event) => {
    state.selectedState = event.target.value;
    renderAll();
  });

  industrySelect.addEventListener('change', (event) => {
    state.selectedIndustry = event.target.value;
    renderAll();
  });

  searchInput.addEventListener('input', (event) => {
    state.sa2Query = event.target.value;
    renderAll();
  });
}

async function load() {
  const response = await fetch('./data/opportunity-dataset.json');
  if (!response.ok) {
    throw new Error(`Failed to load data: HTTP ${response.status}`);
  }

  state.dataset = await response.json();
  renderMeta();
  initControls();
  renderAll();
}

load().catch((error) => {
  const target = document.getElementById('metaLine');
  if (target) {
    target.textContent = error.message;
  }
  // eslint-disable-next-line no-console
  console.error(error);
});
