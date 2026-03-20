# Design Requirements

## Product Goal

Provide an Australia-only, evidence-driven map experience that helps small-business owners identify underserved SA2 markets by industry, without synthetic data.

## User Experience Requirements

1. Map-first interface with SA2 polygons as the primary visual layer.
2. Industry-specific choropleth coloring so users can switch opportunities by industry code.
3. Click interactions on SA2 areas to show local profile and top opportunity industries.
4. Supporting charts that justify recommendations with transparent evidence:
   - Top SA2 scores for selected industry
   - Demand index vs underserved business gap scatter
5. Clear end-user explanations for ABS geography and metrics:
   - What SA2 means
   - What demand index means
   - What underserved businesses means
   - How opportunity score is calculated
6. Filter workflow for:
   - State/territory
   - Industry layer
   - SA2 text search
7. Responsive behavior for desktop and mobile.

## Visual and Readability Requirements

1. High-contrast map overlays with accessible legend from low to high score.
2. Persistent explanatory panels with short, plain-language definitions.
3. Distinct typographic hierarchy for title, metric labels, values, and chart headings.
4. Minimal clutter: focused controls and concise narrative copy.

## Data Integrity Requirements

1. No fake, sample, or imputed records in outputs.
2. All metrics must be derived from official ABS sources and deterministic formulas.
3. Build output must include metadata and source manifest references.
4. Published GitHub Pages assets must reflect the latest generated dataset.

## Operational Requirements

1. App must run as static assets (no backend service required for rendering).
2. GitHub Pages deployment must be sourced from `/docs`.
3. Dataset generation and page assets should be reproducible from scripts.
