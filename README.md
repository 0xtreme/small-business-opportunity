# small-business-opportunity

Australia-specific small business opportunity finder built from official ABS datasets.

## What This Project Does

- Downloads current official datasets from ABS publication files and ABS Data API
- Builds SA2-level opportunity metrics for focus small-business industries
- Produces reproducible processed outputs with source manifest and formulas
- Serves an interactive map-first web UI for filtering by state, industry, and SA2

## Data Integrity Rules

- No synthetic/sample/fake rows are added
- Derived fields are deterministic formulas only
- All sources and formulas are documented in `docs/sources.md`

## Quick Start

```bash
npm install
npm run build
npm run serve
```

Then open `http://127.0.0.1:4173/public/`

## Project Structure

- `scripts/fetch-data.mjs`: Downloads raw data from official URLs
- `scripts/build-dataset.mjs`: Parses raw sources and computes opportunity outputs
- `scripts/sync-pages-assets.mjs`: Mirrors publish assets between `public/` and `docs/`
- `data/raw/`: Raw source files + source manifest
- `data/processed/`: Processed JSON/CSV outputs
- `public/`: Static visualization app
- `docs/`: GitHub Pages app + documentation (`sources.md`, `design-requirements.md`, `architecture.md`)

## Output Files

- `data/processed/opportunity-dataset.json`
- `data/processed/top-opportunities.csv`
- `public/data/opportunity-dataset.json`
- `docs/data/opportunity-dataset.json`

## Notes

- Current business supply source is ABS Data Cube 8 (SA2 × industry × employment size), June 2025 table.
- Population comes from the ABS annual ERP SA2 series (latest available year in API).
