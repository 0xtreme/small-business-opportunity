import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const RAW_DIR = path.join(projectRoot, 'data', 'raw');
const PROCESSED_DIR = path.join(projectRoot, 'data', 'processed');
const PUBLIC_DATA_DIR = path.join(projectRoot, 'public', 'data');
const DOCS_DATA_DIR = path.join(projectRoot, 'docs', 'data');

const RAW_FILES = {
  businessCube8: path.join(RAW_DIR, 'cabee_data_cube_8_jun2025.xlsx'),
  censusG02: path.join(RAW_DIR, 'census_2021_g02_sa2.csv'),
  censusG29: path.join(RAW_DIR, 'census_2021_g29_sa2.csv'),
  erp: path.join(RAW_DIR, 'annual_erp_asgs2021.csv'),
  sourceManifest: path.join(RAW_DIR, 'sources-manifest.json'),
};

const STATE_NAMES = {
  1: 'New South Wales',
  2: 'Victoria',
  3: 'Queensland',
  4: 'South Australia',
  5: 'Western Australia',
  6: 'Tasmania',
  7: 'Northern Territory',
  8: 'Australian Capital Territory',
  9: 'Other Territories',
};

const FOCUS_INDUSTRIES = new Set(['C', 'G', 'H', 'I', 'J', 'L', 'M', 'N', 'P', 'Q', 'R', 'S']);

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function cleanText(value) {
  return (value ?? '').toString().replace(/\u00a0/g, ' ').trim();
}

function parseNumber(value) {
  const text = cleanText(value)
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  if (!text) {
    return null;
  }

  const lowered = text.toLowerCase();
  if (['na', 'n/a', 'np', '..', '-', '--'].includes(lowered)) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function percentileFromSorted(value, sortedArray) {
  if (!Number.isFinite(value) || !sortedArray.length) {
    return 0.5;
  }

  let low = 0;
  let high = sortedArray.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedArray[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  if (sortedArray.length === 1) {
    return 1;
  }

  return (low - 1) / (sortedArray.length - 1);
}

function getStateCodeFromSa2(sa2Code) {
  const firstDigit = Number(String(sa2Code)[0]);
  if (!Number.isFinite(firstDigit) || firstDigit < 1 || firstDigit > 9) {
    return 9;
  }
  return firstDigit;
}

async function forEachCsvRow(filePath, onRow) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = null;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) {
      continue;
    }

    const columns = parseCsvLine(line);
    if (!headers) {
      headers = columns;
      continue;
    }

    const row = {};
    headers.forEach((header, index) => {
      row[header] = columns[index] ?? '';
    });

    // eslint-disable-next-line no-await-in-loop
    await onRow(row);
  }
}

function extractBusinessRows() {
  if (!fs.existsSync(RAW_FILES.businessCube8)) {
    throw new Error(`Missing raw file: ${path.relative(projectRoot, RAW_FILES.businessCube8)}. Run npm run fetch:data first.`);
  }

  const workbook = XLSX.readFile(RAW_FILES.businessCube8, { cellDates: false });
  const tableSheetName = workbook.SheetNames.find((name) => /^Table\s*1/i.test(name));

  if (!tableSheetName) {
    throw new Error('Could not find Table 1 sheet in CABEE workbook.');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[tableSheetName], {
    header: 1,
    raw: false,
    defval: '',
  });

  const headerIndex = rows.findIndex(
    (row) => cleanText(row[0]) === 'Industry' && cleanText(row[2]) === 'SA2' && cleanText(row[9]) === 'Total',
  );

  if (headerIndex < 0) {
    throw new Error('Could not identify header row in CABEE table.');
  }

  const titleRowText = cleanText(rows[Math.max(headerIndex - 1, 0)]?.[0]);
  const yearMatch = titleRowText.match(/June\s+(\d{4})/i);
  const referenceYear = yearMatch ? Number(yearMatch[1]) : null;

  const businessRows = [];
  const sa2NameByCode = new Map();

  for (let i = headerIndex + 2; i < rows.length; i += 1) {
    const row = rows[i];
    const industryCode = cleanText(row[0]);
    const industryLabel = cleanText(row[1]);
    const sa2Code = cleanText(row[2]);
    const sa2Name = cleanText(row[3]);

    if (industryCode.startsWith('(')) {
      break;
    }

    if (!industryCode || !industryLabel || !sa2Code) {
      continue;
    }

    if (!/^[A-Z]$/.test(industryCode)) {
      continue;
    }

    if (!/^\d{9}$/.test(sa2Code)) {
      continue;
    }

    const totalBusinesses = parseNumber(row[9]);
    if (!Number.isFinite(totalBusinesses)) {
      continue;
    }

    const rowObject = {
      reference_year: referenceYear,
      industry_code: industryCode,
      industry_label: industryLabel,
      sa2_code: sa2Code,
      sa2_name: sa2Name,
      non_employing: parseNumber(row[4]),
      employees_1_4: parseNumber(row[5]),
      employees_5_19: parseNumber(row[6]),
      employees_20_199: parseNumber(row[7]),
      employees_200_plus: parseNumber(row[8]),
      total_businesses: totalBusinesses,
    };

    businessRows.push(rowObject);
    sa2NameByCode.set(sa2Code, sa2Name);
  }

  return {
    businessRows,
    sa2NameByCode,
    referenceYear,
  };
}

async function extractCensusG02() {
  if (!fs.existsSync(RAW_FILES.censusG02)) {
    throw new Error(`Missing raw file: ${path.relative(projectRoot, RAW_FILES.censusG02)}. Run npm run fetch:data first.`);
  }

  const g02BySa2 = new Map();

  await forEachCsvRow(RAW_FILES.censusG02, async (row) => {
    if (row.REGION_TYPE !== 'SA2') {
      return;
    }

    const sa2Code = cleanText(row.REGION);
    const metricCode = cleanText(row.MEDAVG);
    const value = parseNumber(row.OBS_VALUE);

    if (!g02BySa2.has(sa2Code)) {
      g02BySa2.set(sa2Code, {
        median_age: null,
        median_total_personal_income_weekly: null,
        median_total_family_income_weekly: null,
        median_total_household_income_weekly: null,
      });
    }

    const metrics = g02BySa2.get(sa2Code);

    if (metricCode === '1') {
      metrics.median_age = value;
    } else if (metricCode === '2') {
      metrics.median_total_personal_income_weekly = value;
    } else if (metricCode === '3') {
      metrics.median_total_family_income_weekly = value;
    } else if (metricCode === '4') {
      metrics.median_total_household_income_weekly = value;
    }
  });

  return g02BySa2;
}

async function extractCensusG29() {
  if (!fs.existsSync(RAW_FILES.censusG29)) {
    throw new Error(`Missing raw file: ${path.relative(projectRoot, RAW_FILES.censusG29)}. Run npm run fetch:data first.`);
  }

  const g29BySa2 = new Map();

  await forEachCsvRow(RAW_FILES.censusG29, async (row) => {
    if (row.REGION_TYPE !== 'SA2') {
      return;
    }

    if (row.SUM !== 'F') {
      return;
    }

    const sa2Code = cleanText(row.REGION);
    const familyCode = cleanText(row.FMCF);
    const value = parseNumber(row.OBS_VALUE) ?? 0;

    if (!g29BySa2.has(sa2Code)) {
      g29BySa2.set(sa2Code, {
        total_families: null,
        families_with_children: 0,
      });
    }

    const metrics = g29BySa2.get(sa2Code);

    if (familyCode === '_T') {
      metrics.total_families = value;
      return;
    }

    if (familyCode === '2' || familyCode === '3') {
      metrics.families_with_children += value;
    }
  });

  return g29BySa2;
}

async function extractErpSeries() {
  if (!fs.existsSync(RAW_FILES.erp)) {
    throw new Error(`Missing raw file: ${path.relative(projectRoot, RAW_FILES.erp)}. Run npm run fetch:data first.`);
  }

  const erpBySa2 = new Map();
  let latestYear = null;

  await forEachCsvRow(RAW_FILES.erp, async (row) => {
    if (row.REGION_TYPE !== 'SA2' || row.MEASURE !== 'ERP' || row.FREQ !== 'A') {
      return;
    }

    const sa2Code = cleanText(row.ASGS_2021);
    const year = parseNumber(row.TIME_PERIOD);
    const value = parseNumber(row.OBS_VALUE);

    if (!Number.isFinite(year) || !Number.isFinite(value)) {
      return;
    }

    if (!erpBySa2.has(sa2Code)) {
      erpBySa2.set(sa2Code, new Map());
    }

    erpBySa2.get(sa2Code).set(year, value);
    latestYear = latestYear === null ? year : Math.max(latestYear, year);
  });

  if (!Number.isFinite(latestYear)) {
    throw new Error('Could not identify latest ERP year from ERP dataset.');
  }

  return { erpBySa2, latestYear };
}

function summarizeIndustryRows(rows) {
  const summaryByCode = new Map();

  rows.forEach((row) => {
    if (!summaryByCode.has(row.industry_code)) {
      summaryByCode.set(row.industry_code, {
        industry_code: row.industry_code,
        industry_label: row.industry_label,
        focus_industry: FOCUS_INDUSTRIES.has(row.industry_code),
        rows: 0,
      });
    }

    summaryByCode.get(row.industry_code).rows += 1;
  });

  return [...summaryByCode.values()].sort((a, b) => a.industry_code.localeCompare(b.industry_code));
}

async function main() {
  ensureDirectory(PROCESSED_DIR);
  ensureDirectory(PUBLIC_DATA_DIR);
  ensureDirectory(DOCS_DATA_DIR);

  console.log('Parsing business supply data (ABS Data cube 8)...');
  const { businessRows, sa2NameByCode, referenceYear } = extractBusinessRows();

  console.log('Parsing Census 2021 G02 medians...');
  const g02BySa2 = await extractCensusG02();

  console.log('Parsing Census 2021 G29 family composition...');
  const g29BySa2 = await extractCensusG29();

  console.log('Parsing ERP population series...');
  const { erpBySa2, latestYear: latestErpYear } = await extractErpSeries();

  const sa2Profiles = new Map();

  for (const [sa2Code, sa2Name] of sa2NameByCode.entries()) {
    const stateCode = getStateCodeFromSa2(sa2Code);
    const stateName = STATE_NAMES[stateCode] ?? STATE_NAMES[9];

    const g02 = g02BySa2.get(sa2Code) ?? {};
    const g29 = g29BySa2.get(sa2Code) ?? {};
    const erpSeries = erpBySa2.get(sa2Code) ?? new Map();

    const populationLatest = erpSeries.get(latestErpYear) ?? null;
    const populationPrevious = erpSeries.get(latestErpYear - 1) ?? null;
    const populationGrowthPct =
      Number.isFinite(populationLatest) && Number.isFinite(populationPrevious) && populationPrevious > 0
        ? ((populationLatest - populationPrevious) / populationPrevious) * 100
        : null;

    const totalFamilies = Number.isFinite(g29.total_families) ? g29.total_families : null;
    const familiesWithChildren = Number.isFinite(g29.families_with_children) ? g29.families_with_children : null;

    const familiesWithChildrenShare =
      Number.isFinite(totalFamilies) && totalFamilies > 0 && Number.isFinite(familiesWithChildren)
        ? familiesWithChildren / totalFamilies
        : null;

    sa2Profiles.set(sa2Code, {
      sa2_code: sa2Code,
      sa2_name: sa2Name,
      state_code: stateCode,
      state_name: stateName,
      population_latest: populationLatest,
      population_growth_1y_pct: populationGrowthPct,
      total_families: totalFamilies,
      families_with_children: familiesWithChildren,
      families_with_children_share: familiesWithChildrenShare,
      median_age: g02.median_age ?? null,
      median_total_personal_income_weekly: g02.median_total_personal_income_weekly ?? null,
      median_total_family_income_weekly: g02.median_total_family_income_weekly ?? null,
      median_total_household_income_weekly: g02.median_total_household_income_weekly ?? null,
      demand_index: null,
      demand_index_components: null,
    });
  }

  const stateMetricArrays = new Map();

  for (const profile of sa2Profiles.values()) {
    if (!stateMetricArrays.has(profile.state_code)) {
      stateMetricArrays.set(profile.state_code, {
        childrenShare: [],
        medianFamilyIncome: [],
        populationGrowth: [],
      });
    }

    const bucket = stateMetricArrays.get(profile.state_code);

    if (Number.isFinite(profile.families_with_children_share)) {
      bucket.childrenShare.push(profile.families_with_children_share);
    }
    if (Number.isFinite(profile.median_total_family_income_weekly)) {
      bucket.medianFamilyIncome.push(profile.median_total_family_income_weekly);
    }
    if (Number.isFinite(profile.population_growth_1y_pct)) {
      bucket.populationGrowth.push(profile.population_growth_1y_pct);
    }
  }

  for (const bucket of stateMetricArrays.values()) {
    bucket.childrenShare.sort((a, b) => a - b);
    bucket.medianFamilyIncome.sort((a, b) => a - b);
    bucket.populationGrowth.sort((a, b) => a - b);
  }

  for (const profile of sa2Profiles.values()) {
    const bucket = stateMetricArrays.get(profile.state_code);

    const pChildren = percentileFromSorted(profile.families_with_children_share, bucket?.childrenShare ?? []);
    const pIncome = percentileFromSorted(profile.median_total_family_income_weekly, bucket?.medianFamilyIncome ?? []);
    const pGrowth = percentileFromSorted(profile.population_growth_1y_pct, bucket?.populationGrowth ?? []);

    const demandIndex = 0.45 * pChildren + 0.35 * pIncome + 0.2 * pGrowth;

    profile.demand_index = demandIndex;
    profile.demand_index_components = {
      families_with_children_share_pctile: pChildren,
      median_family_income_pctile: pIncome,
      population_growth_pctile: pGrowth,
    };
  }

  const densityByStateIndustry = new Map();
  const densityByIndustryNational = new Map();

  for (const row of businessRows) {
    const profile = sa2Profiles.get(row.sa2_code);
    if (!profile || !Number.isFinite(profile.population_latest) || profile.population_latest <= 0) {
      continue;
    }

    const density = (row.total_businesses / profile.population_latest) * 1000;
    const stateIndustryKey = `${profile.state_code}|${row.industry_code}`;

    if (!densityByStateIndustry.has(stateIndustryKey)) {
      densityByStateIndustry.set(stateIndustryKey, []);
    }
    densityByStateIndustry.get(stateIndustryKey).push(density);

    if (!densityByIndustryNational.has(row.industry_code)) {
      densityByIndustryNational.set(row.industry_code, []);
    }
    densityByIndustryNational.get(row.industry_code).push(density);
  }

  const baselineDensityByStateIndustry = new Map();
  const baselineDensityByIndustryNational = new Map();

  for (const [key, values] of densityByStateIndustry.entries()) {
    baselineDensityByStateIndustry.set(key, median(values));
  }

  for (const [industryCode, values] of densityByIndustryNational.entries()) {
    baselineDensityByIndustryNational.set(industryCode, median(values));
  }

  const focusOpportunities = [];

  for (const row of businessRows) {
    if (!FOCUS_INDUSTRIES.has(row.industry_code)) {
      continue;
    }

    const profile = sa2Profiles.get(row.sa2_code);
    if (!profile || !Number.isFinite(profile.population_latest) || profile.population_latest <= 0) {
      continue;
    }

    const stateIndustryKey = `${profile.state_code}|${row.industry_code}`;
    const baselineDensity =
      baselineDensityByStateIndustry.get(stateIndustryKey) ??
      baselineDensityByIndustryNational.get(row.industry_code) ??
      0;

    const expectedBusinesses = (baselineDensity * profile.population_latest) / 1000;
    const observedBusinesses = row.total_businesses;
    const businessGap = expectedBusinesses - observedBusinesses;
    const underservedBusinesses = Math.max(0, businessGap);
    const densityPer1000 = (observedBusinesses / profile.population_latest) * 1000;

    const demandIndex = Number.isFinite(profile.demand_index) ? profile.demand_index : 0.5;
    const opportunityScore = underservedBusinesses * (0.6 + demandIndex);

    focusOpportunities.push({
      reference_year: row.reference_year,
      sa2_code: row.sa2_code,
      sa2_name: row.sa2_name,
      state_code: profile.state_code,
      state_name: profile.state_name,
      industry_code: row.industry_code,
      industry_label: row.industry_label,
      observed_businesses: observedBusinesses,
      expected_businesses_state_median_density: Number(expectedBusinesses.toFixed(2)),
      business_gap_vs_state_median: Number(businessGap.toFixed(2)),
      underserved_businesses: Number(underservedBusinesses.toFixed(2)),
      observed_business_density_per_1000: Number(densityPer1000.toFixed(4)),
      baseline_business_density_per_1000: Number(baselineDensity.toFixed(4)),
      demand_index: Number(demandIndex.toFixed(4)),
      opportunity_score: Number(opportunityScore.toFixed(4)),
    });
  }

  const rankingBySa2 = new Map();

  for (const opportunity of focusOpportunities) {
    if (!rankingBySa2.has(opportunity.sa2_code)) {
      const profile = sa2Profiles.get(opportunity.sa2_code);
      rankingBySa2.set(opportunity.sa2_code, {
        sa2_code: opportunity.sa2_code,
        sa2_name: opportunity.sa2_name,
        state_code: opportunity.state_code,
        state_name: opportunity.state_name,
        population_latest: profile?.population_latest ?? null,
        population_growth_1y_pct: profile?.population_growth_1y_pct ?? null,
        total_families: profile?.total_families ?? null,
        families_with_children: profile?.families_with_children ?? null,
        families_with_children_share: profile?.families_with_children_share ?? null,
        median_age: profile?.median_age ?? null,
        median_total_family_income_weekly: profile?.median_total_family_income_weekly ?? null,
        median_total_household_income_weekly: profile?.median_total_household_income_weekly ?? null,
        demand_index: profile?.demand_index ?? null,
        total_opportunity_score: 0,
        top_industries: [],
      });
    }

    rankingBySa2.get(opportunity.sa2_code).top_industries.push({
      industry_code: opportunity.industry_code,
      industry_label: opportunity.industry_label,
      opportunity_score: opportunity.opportunity_score,
      underserved_businesses: opportunity.underserved_businesses,
      observed_businesses: opportunity.observed_businesses,
      expected_businesses_state_median_density: opportunity.expected_businesses_state_median_density,
    });
  }

  const sa2Rankings = [...rankingBySa2.values()]
    .map((entry) => {
      const sortedIndustries = entry.top_industries
        .filter((item) => item.opportunity_score > 0)
        .sort((a, b) => b.opportunity_score - a.opportunity_score)
        .slice(0, 6);

      const totalOpportunityScore = sortedIndustries
        .slice(0, 3)
        .reduce((sum, item) => sum + item.opportunity_score, 0);

      return {
        ...entry,
        total_opportunity_score: Number(totalOpportunityScore.toFixed(4)),
        top_industries: sortedIndustries,
      };
    })
    .sort((a, b) => b.total_opportunity_score - a.total_opportunity_score);

  const topOpportunities = [...focusOpportunities]
    .filter((row) => row.opportunity_score > 0)
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 5000);

  const industrySa2Scores = focusOpportunities.map((row) => ({
    sa2_code: row.sa2_code,
    industry_code: row.industry_code,
    opportunity_score: row.opportunity_score,
    underserved_businesses: row.underserved_businesses,
    observed_businesses: row.observed_businesses,
    expected_businesses_state_median_density: row.expected_businesses_state_median_density,
    demand_index: row.demand_index,
  }));

  const sourceManifest = fs.existsSync(RAW_FILES.sourceManifest)
    ? JSON.parse(fs.readFileSync(RAW_FILES.sourceManifest, 'utf8'))
    : null;

  const output = {
    metadata: {
      app_name: 'Australia Small Business Opportunity Finder',
      generated_at: new Date().toISOString(),
      currency: 'AUD',
      geography: 'SA2 (ASGS Edition 3)',
      business_reference_year: referenceYear,
      population_reference_year: latestErpYear,
      focus_industry_codes: [...FOCUS_INDUSTRIES],
      methodology: {
        baseline_definition:
          'Expected business count for each SA2/industry is derived from state-level median business density (businesses per 1,000 residents).',
        demand_index_definition:
          'Demand index is a weighted percentile blend within each state: 45% families with children share, 35% median family income, 20% one-year population growth.',
        opportunity_score_definition:
          'Opportunity score = max(0, expected businesses - observed businesses) * (0.6 + demand index).',
      },
      dataset_coverage: {
        sa2_count_in_business_cube: sa2NameByCode.size,
        focus_opportunity_row_count: focusOpportunities.length,
        sa2_ranked_count: sa2Rankings.length,
      },
      source_manifest: sourceManifest,
    },
    industries: summarizeIndustryRows(businessRows),
    sa2_rankings: sa2Rankings,
    industry_sa2_scores: industrySa2Scores,
    top_opportunities: topOpportunities,
  };

  const json = JSON.stringify(output, null, 2);

  const outJsonProcessed = path.join(PROCESSED_DIR, 'opportunity-dataset.json');
  const outJsonPublic = path.join(PUBLIC_DATA_DIR, 'opportunity-dataset.json');
  const outJsonDocs = path.join(DOCS_DATA_DIR, 'opportunity-dataset.json');

  await fsp.writeFile(outJsonProcessed, json);
  await fsp.writeFile(outJsonPublic, json);
  await fsp.writeFile(outJsonDocs, json);

  const csvHeader = [
    'sa2_code',
    'sa2_name',
    'state_name',
    'industry_code',
    'industry_label',
    'opportunity_score',
    'underserved_businesses',
    'observed_businesses',
    'expected_businesses_state_median_density',
    'demand_index',
  ];

  const csvRows = [csvHeader.join(',')];
  for (const row of topOpportunities) {
    csvRows.push(
      [
        row.sa2_code,
        `"${row.sa2_name.replace(/"/g, '""')}"`,
        `"${row.state_name.replace(/"/g, '""')}"`,
        row.industry_code,
        `"${row.industry_label.replace(/"/g, '""')}"`,
        row.opportunity_score,
        row.underserved_businesses,
        row.observed_businesses,
        row.expected_businesses_state_median_density,
        row.demand_index,
      ].join(','),
    );
  }

  const outCsv = path.join(PROCESSED_DIR, 'top-opportunities.csv');
  await fsp.writeFile(outCsv, csvRows.join('\n'));

  console.log(`Wrote ${path.relative(projectRoot, outJsonProcessed)}`);
  console.log(`Wrote ${path.relative(projectRoot, outJsonPublic)}`);
  console.log(`Wrote ${path.relative(projectRoot, outJsonDocs)}`);
  console.log(`Wrote ${path.relative(projectRoot, outCsv)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
