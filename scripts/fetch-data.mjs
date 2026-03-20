import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const rawDir = path.join(projectRoot, 'data', 'raw');

const SOURCES = [
  {
    id: 'cabee_sa2_employment',
    publisher: 'Australian Bureau of Statistics (ABS)',
    description:
      'Counts of Australian Businesses, including Entries and Exits, Data cube 8 (Businesses by industry division by SA2 by employment size ranges), June 2025 release.',
    url: 'https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2021-jun2025/8165DC08.xlsx',
    filename: 'cabee_data_cube_8_jun2025.xlsx',
    official_release_date: '2025-12-16',
  },
  {
    id: 'census_2021_g02_sa2',
    publisher: 'Australian Bureau of Statistics (ABS Data API)',
    description:
      'Census 2021, G02 Selected medians and averages, Main Statistical Areas Level 2 and up (SA2+), CSV via ABS SDMX API.',
    url: 'https://data.api.abs.gov.au/rest/data/C21_G02_SA2?format=csvfile',
    filename: 'census_2021_g02_sa2.csv',
    official_release_date: '2022-06-28',
  },
  {
    id: 'census_2021_g29_sa2',
    publisher: 'Australian Bureau of Statistics (ABS Data API)',
    description:
      'Census 2021, G29 Family composition, Main Statistical Areas Level 2 and up (SA2+), CSV via ABS SDMX API.',
    url: 'https://data.api.abs.gov.au/rest/data/C21_G29_SA2?format=csvfile',
    filename: 'census_2021_g29_sa2.csv',
    official_release_date: '2022-06-28',
  },
  {
    id: 'annual_erp_asgs2021',
    publisher: 'Australian Bureau of Statistics (ABS Data API)',
    description:
      'Estimated Resident Population by SA2 and above (ASGS Edition 3), annual series from 2001 onwards, CSV via ABS SDMX API.',
    url: 'https://data.api.abs.gov.au/rest/data/ABS_ANNUAL_ERP_ASGS2021?format=csvfile',
    filename: 'annual_erp_asgs2021.csv',
    official_release_date: '2025-03-20',
  },
];

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function downloadToFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const request = https.get(
      url,
      {
        headers: {
          'user-agent': 'brainstorm-au-data-apps/1.0 (+https://github.com/0xtreme)',
          accept: '*/*',
        },
      },
      (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        downloadToFile(nextUrl, destination, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        reject(new Error(`Failed download ${url}: HTTP ${status}`));
        return;
      }

      const fileStream = fs.createWriteStream(destination);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({
            contentLength: response.headers['content-length']
              ? Number(response.headers['content-length'])
              : null,
            contentType: response.headers['content-type'] ?? null,
          });
        });
      });

      fileStream.on('error', (error) => {
        fileStream.close(() => {
          reject(error);
        });
      });
      },
    );

    request.on('error', reject);
    request.setTimeout(120000, () => {
      request.destroy(new Error(`Timeout downloading ${url}`));
    });
  });
}

async function main() {
  ensureDirectory(rawDir);
  const force = process.argv.includes('--force');
  const fetchedAt = new Date().toISOString();
  const manifest = {
    fetched_at: fetchedAt,
    sources: [],
  };

  for (const source of SOURCES) {
    const destination = path.join(rawDir, source.filename);
    const exists = fs.existsSync(destination);

    if (exists && !force) {
      const stats = await fsp.stat(destination);
      manifest.sources.push({
        ...source,
        path: path.relative(projectRoot, destination),
        fetched_at: fetchedAt,
        bytes: stats.size,
        reused_existing_file: true,
      });
      console.log(`[skip] ${source.id} -> ${source.filename} (${stats.size} bytes)`);
      continue;
    }

    console.log(`[download] ${source.id}`);
    const responseMeta = await downloadToFile(source.url, destination);
    const stats = await fsp.stat(destination);

    manifest.sources.push({
      ...source,
      path: path.relative(projectRoot, destination),
      fetched_at: fetchedAt,
      bytes: stats.size,
      content_type: responseMeta.contentType,
      content_length_header: responseMeta.contentLength,
      reused_existing_file: false,
    });

    console.log(`[ok] ${source.filename} (${stats.size} bytes)`);
  }

  const manifestPath = path.join(rawDir, 'sources-manifest.json');
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${path.relative(projectRoot, manifestPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
