# Architecture

## Overview

This project is a static data app with an offline build pipeline and a client-side visualization layer.

## Components

1. Data ingestion (`scripts/fetch-data.mjs`)
   - Downloads official ABS inputs:
     - CABEE Data Cube 8 workbook
     - Census 2021 G02 (SA2)
     - Census 2021 G29 (SA2)
     - Annual ERP SA2 population
   - Records retrieval metadata in `data/raw/sources-manifest.json`.

2. Data transformation (`scripts/build-dataset.mjs`)
   - Parses and normalizes raw sources.
   - Computes deterministic metrics:
     - Demand index (state-relative percentile blend)
     - Underserved businesses
     - Opportunity score
   - Writes outputs to:
     - `data/processed/opportunity-dataset.json`
     - `data/processed/top-opportunities.csv`
     - `public/data/opportunity-dataset.json`
     - `docs/data/opportunity-dataset.json`

3. Frontend visualization (`public/*` mirrored to `docs/*`)
   - `index.html`: map-first layout and explanatory panels
   - `app.js`: filtering, map interactions, chart rendering
   - `styles.css`: responsive presentation and visual system
   - External libraries:
     - MapLibre GL JS for interactive map rendering
     - Plotly for evidence charts
   - Live SA2 boundaries are queried from ABS ArcGIS GeoJSON endpoints at runtime.

4. Publication (`docs/`)
   - GitHub Pages serves static assets from `/docs`.
   - Markdown documentation is colocated with published app assets.

## Data Flow

1. `npm run fetch:data` downloads raw official files into `data/raw/`.
2. `npm run build:data` computes model outputs and writes JSON/CSV artifacts.
3. `public/data/opportunity-dataset.json` and `docs/data/opportunity-dataset.json` are refreshed together.
4. Browser loads dataset JSON and joins it with ABS SA2 polygons.
5. UI renders choropleth map, SA2 details, and supporting charts.

## Accuracy and Controls

1. No synthetic rows are introduced.
2. All derived values come from explicit formulas documented in `docs/sources.md`.
3. Runtime map display is read-only and does not mutate source data.
4. Build logs surface output file locations for traceability.
