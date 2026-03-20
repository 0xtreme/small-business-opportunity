# How This Works and How To Use It

## What This App Does

This app highlights Australian SA2 areas where a selected business industry appears underserved, using official ABS data only.

## How It Works

1. Business supply comes from ABS Data Cube 8 (business counts by SA2 and industry).
2. Demand-side signals come from Census and ERP data:
   - family composition
   - family income
   - one-year population growth
3. For each SA2 and industry:
   - expected businesses are estimated from state median business density
   - observed businesses are read from ABS business counts
   - underserved businesses = `max(0, expected - observed)`
   - opportunity score = `underserved businesses * (0.6 + demand index)`
4. SA2 polygons are loaded from the official ABS ASGS 2021 geospatial service and colored by the selected industry score.

## How To Use The App

1. Select an industry in the right filter panel.
2. Optionally filter to a state or territory.
3. Search an SA2 by name if needed.
4. Click any SA2 on the map to inspect details:
   - population and family profile
   - top suggested industries
   - current selected-industry score
5. Use the bottom charts to validate the map insight:
   - left chart: highest SA2 scores for selected industry
   - right chart: underserved businesses vs demand index

## Key Terms

1. SA2: Statistical Area Level 2 (official ABS geography for local-area analysis).
2. Demand index: state-relative 0-1 score from family share, income, and growth.
3. Underserved businesses: local supply gap for a given industry.
4. Opportunity score: combined gap-and-demand indicator for opportunity ranking.
