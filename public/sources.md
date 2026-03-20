# Data Sources and Accuracy Notes

This app is built to avoid synthetic/sample records. Every data point shown in charts/tables is directly sourced from official ABS datasets, then transformed with documented formulas.

## Official Sources Used

1. ABS publication: Counts of Australian Businesses, including Entries and Exits (July 2021 - June 2025)
   - Publication URL: https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2021-jun2025
   - Data cube used: Data cube 8 (Businesses by industry division by SA2 by employment size ranges)
   - File URL: https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2021-jun2025/8165DC08.xlsx
   - Release date in publication: 16 December 2025

2. ABS Data API: Census 2021 G02 (Selected medians and averages, SA2+)
   - API URL: https://data.api.abs.gov.au/rest/data/C21_G02_SA2?format=csvfile
   - Metrics used:
     - `MEDAVG=1`: Median age of persons
     - `MEDAVG=3`: Median total family income ($/weekly)
     - `MEDAVG=4`: Median total household income ($/weekly)

3. ABS Data API: Census 2021 G29 (Family composition, SA2+)
   - API URL: https://data.api.abs.gov.au/rest/data/C21_G29_SA2?format=csvfile
   - Metrics used:
     - `FMCF=_T`, `SUM=F`: Total families
     - `FMCF=2`, `SUM=F`: Couple family with children
     - `FMCF=3`, `SUM=F`: One parent family

4. ABS Data API: Annual ERP by ASGS 2021
   - API URL: https://data.api.abs.gov.au/rest/data/ABS_ANNUAL_ERP_ASGS2021?format=csvfile
   - Metric used:
     - `MEASURE=ERP`, `REGION_TYPE=SA2`, annual frequency (`FREQ=A`)

## Derived Metrics (Formula-Based)

No derived metric uses fabricated values; they are deterministic transformations of the above sources:

1. State median business density for each industry:
   - `median( businesses / population * 1000 )` across SA2 in each state

2. Expected businesses in SA2 for each industry:
   - `state_median_density * population / 1000`

3. Underserved businesses:
   - `max(0, expected - observed)`

4. Demand index (state-relative percentile blend):
   - 45% families with children share percentile
   - 35% median family income percentile
   - 20% one-year population growth percentile

5. Opportunity score:
   - `underserved_businesses * (0.6 + demand_index)`

## Reproducibility

- Raw downloads are stored in `data/raw/`
- Download metadata is stored in `data/raw/sources-manifest.json`
- Processed outputs are generated into:
  - `data/processed/opportunity-dataset.json`
  - `data/processed/top-opportunities.csv`
  - `public/data/opportunity-dataset.json`

To rebuild:

```bash
npm run build
```
