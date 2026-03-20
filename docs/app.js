const ABS_SA2_COUNT_URL =
  'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/0/query?where=1%3D1&returnCountOnly=true&f=pjson';

const ABS_SA2_QUERY_BASE =
  'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/0/query?where=1%3D1&outFields=objectid,sa2_code_2021,sa2_name_2021,state_code_2021,state_name_2021&outSR=4326&f=geojson';

const state = {
  dataset: null,
  map: null,
  boundaries: null,
  currentFeatures: [],
  selectedIndustry: 'P',
  selectedState: 'ALL',
  sa2Query: '',
  selectedSa2Code: null,
  selectedFeatureId: null,
  hoveredFeatureId: null,
  index: {
    industryNameByCode: new Map(),
    rankBySa2: new Map(),
    scoreByIndustrySa2: new Map(),
  },
};

const el = {
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loadingText'),
  tooltip: document.getElementById('tooltip'),
  selectedTitle: document.getElementById('selectedTitle'),
  selectedMeta: document.getElementById('selectedMeta'),
  selectedMetrics: document.getElementById('selectedMetrics'),
  topIndustryList: document.getElementById('topIndustryList'),
  stateSelect: document.getElementById('stateSelect'),
  industrySelect: document.getElementById('industrySelect'),
  searchInput: document.getElementById('searchInput'),
  metaLine: document.getElementById('metaLine'),
  scoreChart: document.getElementById('scoreChart'),
  evidenceChart: document.getElementById('evidenceChart'),
};

function setLoading(message) {
  if (el.loadingText) {
    el.loadingText.textContent = message;
  }
}

function completeLoading() {
  if (el.loading) {
    el.loading.classList.add('done');
  }
}

function num(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return value.toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return `$${num(value, 0)}`;
}

function pctFromRatio(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return `${(value * 100).toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function buildIndexes() {
  state.index.industryNameByCode = new Map(
    (state.dataset.industries ?? []).map((industry) => [industry.industry_code, industry.industry_label]),
  );

  state.index.rankBySa2 = new Map(
    (state.dataset.sa2_rankings ?? []).map((entry) => [entry.sa2_code, entry]),
  );

  state.index.scoreByIndustrySa2 = new Map();
  for (const row of state.dataset.industry_sa2_scores ?? []) {
    const key = `${row.industry_code}|${row.sa2_code}`;
    state.index.scoreByIndustrySa2.set(key, row);
  }
}

async function loadSa2Boundaries() {
  const countJson = await fetchJson(ABS_SA2_COUNT_URL);
  const total = Number(countJson.count ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Unable to load SA2 boundary count from ABS geo service.');
  }

  const pageSize = 2000;
  const features = [];
  for (let offset = 0; offset < total; offset += pageSize) {
    setLoading(`Loading SA2 boundaries (${Math.min(offset + pageSize, total)} / ${total})...`);
    const url = `${ABS_SA2_QUERY_BASE}&resultRecordCount=${pageSize}&resultOffset=${offset}`;
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchJson(url);
    if (Array.isArray(page.features)) {
      features.push(...page.features);
    }
  }

  return { type: 'FeatureCollection', features };
}

function getScoreRow(sa2Code, industryCode) {
  return state.index.scoreByIndustrySa2.get(`${industryCode}|${sa2Code}`) ?? null;
}

function computeColorStops(maxScore) {
  const safeMax = Math.max(20, maxScore);
  return {
    s1: safeMax * 0.2,
    s2: safeMax * 0.5,
    s3: safeMax * 0.75,
    s4: safeMax,
  };
}

function buildMapFeatures() {
  const query = state.sa2Query.trim().toLowerCase();

  const features = state.boundaries.features.map((feature) => {
    const code = feature.properties.sa2_code_2021;
    const scoreRow = getScoreRow(code, state.selectedIndustry);
    const ranking = state.index.rankBySa2.get(code) ?? null;

    const matchesState =
      state.selectedState === 'ALL' || feature.properties.state_code_2021 === state.selectedState;
    const matchesQuery = !query || feature.properties.sa2_name_2021.toLowerCase().includes(query);
    const visible = matchesState && matchesQuery;

    return {
      type: 'Feature',
      id: feature.properties.objectid,
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        hidden: visible ? 0 : 1,
        has_score: scoreRow ? 1 : 0,
        score: scoreRow ? scoreRow.opportunity_score : 0,
        underserved: scoreRow ? scoreRow.underserved_businesses : 0,
        demand: scoreRow ? scoreRow.demand_index : ranking?.demand_index ?? 0,
        population: ranking?.population_latest ?? null,
      },
    };
  });

  state.currentFeatures = features;
  return { type: 'FeatureCollection', features };
}

function updateMapSourceAndStyle() {
  if (!state.map || !state.map.getSource('sa2') || !state.boundaries?.features?.length) {
    return;
  }

  const geojson = buildMapFeatures();
  state.map.getSource('sa2').setData(geojson);

  const visibleScores = geojson.features
    .filter((feature) => feature.properties.hidden === 0 && feature.properties.has_score === 1)
    .map((feature) => feature.properties.score)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const p95Index = Math.max(0, Math.floor(visibleScores.length * 0.95) - 1);
  const p95 = visibleScores[p95Index] ?? 40;
  const stop = computeColorStops(p95);

  state.map.setPaintProperty('sa2-fill', 'fill-color', [
    'case',
    ['==', ['get', 'hidden'], 1],
    'rgba(0,0,0,0)',
    ['==', ['get', 'has_score'], 0],
    '#1f2838',
    ['interpolate', ['linear'], ['get', 'score'],
      0, '#233252',
      stop.s1, '#2c82b1',
      stop.s2, '#f4bf4f',
      stop.s3, '#f37a3f',
      stop.s4, '#d62839'],
  ]);

  state.map.setPaintProperty('sa2-fill', 'fill-opacity', [
    'case',
    ['==', ['get', 'hidden'], 1],
    0,
    ['==', ['get', 'has_score'], 0],
    0.26,
    0.78,
  ]);
}

function setFeatureState(id, nextState) {
  if (!state.map || id === null || id === undefined) {
    return;
  }
  state.map.setFeatureState({ source: 'sa2', id }, nextState);
}

function clearHover() {
  if (state.hoveredFeatureId !== null) {
    setFeatureState(state.hoveredFeatureId, { hover: false });
    state.hoveredFeatureId = null;
  }
}

function showTooltip(point, feature) {
  if (!el.tooltip) {
    return;
  }

  const code = feature.properties.sa2_code_2021;
  const scoreRow = getScoreRow(code, state.selectedIndustry);
  const industryName = state.index.industryNameByCode.get(state.selectedIndustry) ?? state.selectedIndustry;

  el.tooltip.innerHTML = `
    <div class="title">${feature.properties.sa2_name_2021}</div>
    <div class="line">${feature.properties.state_name_2021}</div>
    <div class="line">Industry: ${industryName}</div>
    <div class="line">Opportunity score: <strong>${num(scoreRow?.opportunity_score, 1)}</strong></div>
    <div class="line">Underserved businesses: <strong>${num(scoreRow?.underserved_businesses, 1)}</strong></div>
    <div class="line">Demand index: <strong>${num(scoreRow?.demand_index, 2)}</strong></div>
  `;

  el.tooltip.style.left = `${point.x}px`;
  el.tooltip.style.top = `${point.y}px`;
  el.tooltip.classList.remove('hidden');
}

function hideTooltip() {
  if (el.tooltip) {
    el.tooltip.classList.add('hidden');
  }
}

function getVisibleFeatureByCode(sa2Code) {
  return state.currentFeatures.find(
    (feature) => feature.properties.sa2_code_2021 === sa2Code && feature.properties.hidden === 0,
  );
}

function geometryBounds(geometry) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function scan(coords) {
    if (!Array.isArray(coords[0])) {
      const [lng, lat] = coords;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    coords.forEach(scan);
  }

  scan(geometry.coordinates);
  return [[minLng, minLat], [maxLng, maxLat]];
}

function selectSa2(sa2Code, featureId = null, zoomToFeature = false) {
  if (!sa2Code) {
    return;
  }

  if (state.selectedFeatureId !== null) {
    setFeatureState(state.selectedFeatureId, { selected: false });
  }

  let nextFeatureId = featureId;
  if (nextFeatureId === null) {
    nextFeatureId = getVisibleFeatureByCode(sa2Code)?.id ?? null;
  }

  state.selectedSa2Code = sa2Code;
  state.selectedFeatureId = nextFeatureId;

  if (nextFeatureId !== null) {
    setFeatureState(nextFeatureId, { selected: true });
  }

  if (zoomToFeature && nextFeatureId !== null) {
    const feature = getVisibleFeatureByCode(sa2Code);
    if (feature) {
      state.map.fitBounds(geometryBounds(feature.geometry), {
        padding: { top: 120, left: 420, right: 320, bottom: 220 },
        duration: 900,
        maxZoom: 10.5,
      });
    }
  }

  renderSelectedPanel();
}

function renderSelectedPanel() {
  const ranking = state.index.rankBySa2.get(state.selectedSa2Code) ?? null;
  if (!ranking) {
    if (el.selectedTitle) {
      el.selectedTitle.textContent = 'Select an SA2';
    }
    if (el.selectedMeta) {
      el.selectedMeta.textContent = 'Click any SA2 polygon on the map to inspect details.';
    }
    if (el.selectedMetrics) {
      el.selectedMetrics.innerHTML = '';
    }
    if (el.topIndustryList) {
      el.topIndustryList.innerHTML = '<div class="muted small">No SA2 selected.</div>';
    }
    return;
  }

  el.selectedTitle.textContent = ranking.sa2_name;
  el.selectedMeta.textContent = `${ranking.state_name} | SA2 Code ${ranking.sa2_code}`;

  const cards = [
    { label: 'Population', value: num(ranking.population_latest) },
    { label: 'Families with children', value: pctFromRatio(ranking.families_with_children_share) },
    { label: 'Median family income/week', value: money(ranking.median_total_family_income_weekly) },
    { label: '1Y population growth', value: `${num(ranking.population_growth_1y_pct, 1)}%` },
  ];

  el.selectedMetrics.innerHTML = cards
    .map(
      (card) => `
        <div class="metric-card">
          <div class="metric-label">${card.label}</div>
          <div class="metric-value">${card.value}</div>
        </div>
      `,
    )
    .join('');

  const scoreRow = getScoreRow(state.selectedSa2Code, state.selectedIndustry);
  const currentIndustryName =
    state.index.industryNameByCode.get(state.selectedIndustry) ?? state.selectedIndustry;

  const topList = [
    {
      name: `${currentIndustryName} (active layer)`,
      score: scoreRow?.opportunity_score ?? 0,
      gap: scoreRow?.underserved_businesses ?? 0,
    },
    ...(ranking.top_industries ?? []).slice(0, 4).map((item) => ({
      name: item.industry_label,
      score: item.opportunity_score,
      gap: item.underserved_businesses,
    })),
  ];

  el.topIndustryList.innerHTML = topList
    .filter((item, index, arr) => arr.findIndex((x) => x.name === item.name) === index)
    .slice(0, 5)
    .map(
      (item) => `
        <div class="industry-item">
          <div class="name">${item.name}</div>
          <div class="meta">Score ${num(item.score, 1)} | Underserved ${num(item.gap, 1)}</div>
        </div>
      `,
    )
    .join('');
}

function getVisibleIndustryRows() {
  const industryRows = [];
  for (const feature of state.currentFeatures) {
    if (feature.properties.hidden === 1 || feature.properties.has_score === 0) {
      continue;
    }
    const ranking = state.index.rankBySa2.get(feature.properties.sa2_code_2021);
    if (!ranking) {
      continue;
    }

    industryRows.push({
      sa2_code: ranking.sa2_code,
      sa2_name: ranking.sa2_name,
      state_name: ranking.state_name,
      score: feature.properties.score,
      underserved: feature.properties.underserved,
      demand: feature.properties.demand,
      population: ranking.population_latest,
    });
  }
  return industryRows;
}

function renderCharts() {
  const rows = getVisibleIndustryRows().sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 15);

  Plotly.newPlot(
    el.scoreChart,
    [
      {
        type: 'bar',
        orientation: 'h',
        y: top.map((row) => `${row.sa2_name}, ${row.state_name}`),
        x: top.map((row) => row.score),
        marker: { color: '#f8b84d' },
        hovertemplate: '%{y}<br>Opportunity score: %{x:.1f}<extra></extra>',
      },
    ],
    {
      margin: { t: 4, l: 190, r: 16, b: 34 },
      xaxis: { title: 'Score', color: '#d9e6ff' },
      yaxis: { autorange: 'reversed', color: '#b8c8e8' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#d9e6ff', size: 11 },
    },
    { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] },
  );

  Plotly.newPlot(
    el.evidenceChart,
    [
      {
        type: 'scattergl',
        mode: 'markers',
        x: rows.map((row) => row.underserved),
        y: rows.map((row) => row.demand),
        text: rows.map(
          (row) => `${row.sa2_name}, ${row.state_name}<br>Population ${num(row.population)}<br>Score ${num(row.score, 1)}`,
        ),
        marker: {
          size: rows.map((row) => Math.max(6, Math.min(24, Math.sqrt(row.population || 0) / 8))),
          color: rows.map((row) => row.score),
          colorscale: 'YlOrRd',
          line: { width: 0.5, color: 'rgba(255,255,255,0.5)' },
          opacity: 0.82,
        },
        hovertemplate: '%{text}<br>Underserved %{x:.1f}<br>Demand %{y:.2f}<extra></extra>',
      },
    ],
    {
      margin: { t: 4, l: 48, r: 14, b: 38 },
      xaxis: { title: 'Underserved businesses', color: '#d9e6ff' },
      yaxis: { title: 'Demand index', range: [0, 1], color: '#d9e6ff' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#d9e6ff', size: 11 },
    },
    { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] },
  );
}

function renderMeta() {
  if (!state.dataset?.metadata || !el.metaLine) {
    return;
  }
  const generated = new Date(state.dataset.metadata.generated_at).toLocaleString('en-AU');
  el.metaLine.textContent = `Generated ${generated} | Business year ${state.dataset.metadata.business_reference_year} | Population year ${state.dataset.metadata.population_reference_year}`;
}

function applyFiltersAndRender() {
  updateMapSourceAndStyle();

  const selectedVisible = state.selectedSa2Code
    ? getVisibleFeatureByCode(state.selectedSa2Code)
    : null;

  if (!selectedVisible) {
    const bestVisible = getVisibleIndustryRows().sort((a, b) => b.score - a.score)[0];
    if (bestVisible) {
      selectSa2(bestVisible.sa2_code);
    } else {
      state.selectedSa2Code = null;
      state.selectedFeatureId = null;
      renderSelectedPanel();
    }
  } else {
    renderSelectedPanel();
  }

  renderCharts();
}

function initControls() {
  const stateMap = new Map();
  for (const ranking of state.dataset.sa2_rankings ?? []) {
    stateMap.set(String(ranking.state_code), ranking.state_name);
  }

  const orderedStates = [...stateMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));

  el.stateSelect.innerHTML = [
    '<option value="ALL">All states and territories</option>',
    ...orderedStates.map(([code, name]) => `<option value="${code}">${name}</option>`),
  ].join('');

  const focusIndustryCodes = state.dataset.metadata.focus_industry_codes ?? [];
  el.industrySelect.innerHTML = focusIndustryCodes
    .map((code) => `<option value="${code}">${state.index.industryNameByCode.get(code) ?? code}</option>`)
    .join('');

  if (focusIndustryCodes.includes('P')) {
    el.industrySelect.value = 'P';
    state.selectedIndustry = 'P';
  } else if (focusIndustryCodes[0]) {
    el.industrySelect.value = focusIndustryCodes[0];
    state.selectedIndustry = focusIndustryCodes[0];
  }

  el.stateSelect.addEventListener('change', (event) => {
    state.selectedState = event.target.value;
    applyFiltersAndRender();
  });

  el.industrySelect.addEventListener('change', (event) => {
    state.selectedIndustry = event.target.value;
    applyFiltersAndRender();
  });

  el.searchInput.addEventListener('input', (event) => {
    state.sa2Query = event.target.value;
    applyFiltersAndRender();

    const query = state.sa2Query.trim().toLowerCase();
    if (query.length >= 3) {
      const firstMatch = getVisibleIndustryRows().find((row) => row.sa2_name.toLowerCase().includes(query));
      if (firstMatch) {
        selectSa2(firstMatch.sa2_code, null, true);
      }
    }
  });
}

function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [134.5, -25.6],
    zoom: 3.4,
    attributionControl: false,
  });

  state.map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

  state.map.on('load', () => {
    state.map.addSource('sa2', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'objectid',
    });

    state.map.addLayer({
      id: 'sa2-fill',
      type: 'fill',
      source: 'sa2',
      paint: {
        'fill-color': '#263042',
        'fill-opacity': 0.45,
      },
    });

    state.map.addLayer({
      id: 'sa2-outline',
      type: 'line',
      source: 'sa2',
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          '#ffe27c',
          ['boolean', ['feature-state', 'hover'], false],
          '#97d6ff',
          '#202a3c',
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          2.1,
          ['boolean', ['feature-state', 'hover'], false],
          1.4,
          0.45,
        ],
      },
    });

    state.map.on('mousemove', 'sa2-fill', (event) => {
      const feature = event.features?.[0];
      if (!feature || feature.properties.hidden === 1) {
        hideTooltip();
        return;
      }

      state.map.getCanvas().style.cursor = 'pointer';

      if (state.hoveredFeatureId !== feature.id) {
        clearHover();
        state.hoveredFeatureId = feature.id;
        setFeatureState(feature.id, { hover: true });
      }

      showTooltip(event.point, feature);
    });

    state.map.on('mouseleave', 'sa2-fill', () => {
      state.map.getCanvas().style.cursor = '';
      clearHover();
      hideTooltip();
    });

    state.map.on('click', 'sa2-fill', (event) => {
      const feature = event.features?.[0];
      if (!feature || feature.properties.hidden === 1) {
        return;
      }
      selectSa2(feature.properties.sa2_code_2021, feature.id, true);
    });

    applyFiltersAndRender();
  });
}

async function load() {
  try {
    setLoading('Loading opportunity dataset...');
    state.dataset = await fetchJson('./data/opportunity-dataset.json');
    buildIndexes();
    renderMeta();
    initControls();

    setLoading('Initializing map engine...');
    initMap();

    setLoading('Loading official ABS SA2 boundaries...');
    state.boundaries = await loadSa2Boundaries();

    setLoading('Joining scores with SA2 geographies...');
    applyFiltersAndRender();

    completeLoading();
  } catch (error) {
    setLoading(`Error: ${error.message}`);
    // eslint-disable-next-line no-console
    console.error(error);
  }
}

load();
