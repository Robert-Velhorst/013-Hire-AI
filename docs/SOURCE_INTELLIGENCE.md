# Source Intelligence

Updated: 2026-10-09.

## Purpose And Product Boundary

Hire.AI aims to handle the work before a job interview: finding suitable vacancies, preparing and submitting authorized applications, following up, scheduling, and preparing the candidate. The candidate conducts the interview. Current employer-portal submission remains a controlled handoff, not an implemented universal unattended service.

The source register is an incremental foundation for global coverage, not an exhaustive inventory of every platform. It contains 90 entries, including 28 newly added public-API and regional entries. Nine sources are enabled by current collection policy. A listed platform is not automatically a working integration.

## User Workflow

Open **Sources / Bronnen** from the application navigation:

1. Filter the register by name, region, country, language, collection mode, or recorded status.
2. Inspect the source reference, review date, collection-policy explanation, last recorded scan attempt, stored listing count, and linked duplicate count.
3. Export the current filtered page as JSON when a portable record is needed. The export contains the page scope, filters, timestamp, and database/sample indicator; it is not a full-catalog export.
4. Open **Duplicates & differences** to compare linked vacancy records. Load additional pairs as needed; the differences-only option filters the loaded pairs, not the entire corpus.

The overview distinguishes disabled sources, missing integrations, uninitialized sources, sources never scanned, failed or partial scans, and successful recorded scans. A successful scan is historical evidence, not a guarantee of present availability. Refresh reloads the overview; it does not trigger scraping. Existing administrator controls remain responsible for scans.

## Evidence And Geography

`server/scrapers/regionalPlatforms.ts` records region, country/language tags, source URLs, and verification status. Directory review dates describe direct site/documentation checks on 2026-09-04. They do not certify completeness, provider permission for scraping, uptime, or legal suitability.

- `directory_reviewed`: the public directory or documentation was directly reviewed.
- `candidate`: the platform is recorded for evaluation; the reference was not successfully verified in this review.
- `legacy`: existing entry without a new dated directory review.

The new entries span Europe, Africa, Asia, the Middle East, North America, Latin America, and Oceania. Examples include Nationale Vacaturebank, VDAB, EURES, Reed, HelloWork, Pracuj.pl, jobs.ch, USAJOBS, Get on Board, Computrabajo, SEEK, Jobstreet, TokyoDev, Cake, Bayt, GulfTalent, BrighterMonday Kenya, Jobberman Nigeria, and Pnet. Werk.nl, InfoJobs Spain, Job Bank Canada, Catho, and Naukri remain candidate references pending successful verification. Country lists are discovery metadata, not exhaustive market coverage or evidence that a candidate can work from those countries. Existing sources without reviewed geography stay unclassified.

## New Collection Adapters

### Himalayas

The [official public API documentation](https://himalayas.app/api) describes an unauthenticated jobs feed, cursor pagination, location and timezone restrictions, and attribution requirements. Hire.AI uses `https://himalayas.app/jobs/api`, retaining the Himalayas listing as both source and application link. Attribution must remain visible; the documentation's restrictions on re-syndication to third-party job sites still apply.

Each call processes at most five pages and 100 accepted records, further bounded by the scheduler's per-source allocation and cycle-wide ceiling. Collection policy sets a daily minimum interval. Pagination is bounded within a call; there is no durable backfill cursor, so this does not ingest the full historical catalog. Keyword and location filtering operate within that bounded feed window, not a provider-wide search.

Missing location restrictions remain unspecified, not globally eligible. Numeric timezone restrictions are preserved in requirements. Nonannual salaries are not stored as annual amounts; unknown currencies remain unknown. Malformed envelopes, unusable source links, repeated cursors, cancellation, and zero quotas are covered by focused tests.

### Arbeitnow UK

The [official Arbeitnow API announcement](https://www.arbeitnow.com/blog/job-board-api) documents the UK endpoint at `https://www.arbeitnow.co.uk/api/job-board-api`. Hire.AI reuses its Arbeitnow adapter with an explicit UK market selection. Only records with `remote: true` qualify. It retains the provider listing link and does not infer candidate country eligibility when location is absent. One feed page is read per call with the existing hourly policy and bounded output; deeper pagination/backfill is not implemented.

### Remote OK feed handling

Remote OK's [official FAQ](https://remoteok.com/faq) documents its unauthenticated JSON feed and requires aggregators to name Remote OK as the source and link to each original listing. The adapter preserves that listing URL as both the source and application destination. Its ISO-8601 `date` is parsed directly, with the numeric `epoch` as fallback. Search keyword matching includes tags, and source location filters are applied before the result limit.

Remote OK's [live feed](https://remoteok.com/api) includes listings described as “mostly remote” with recurring office collaboration. These may remain in the source inventory for comparison, but the shared remote-only search and autonomous-planning rules now exclude explicit hybrid/mostly-remote and recurring in-person attendance signals. Unknown eligibility still requires review. This is a conservative text rule, not a substitute for source-specific structured remote-work verification; the wording can evolve, so acceptance fixtures and feed review remain necessary.

## Comparisons And Counts

Counts come from persisted job rows grouped by platform and existing `job_duplicates` links. Stored listings include duplicate records; they are not counts of unique vacancies or of all jobs available from that provider. A duplicate count belongs to the platform of the linked duplicate record, not both sides of the pair.

The comparison checks title, employer, location, contract type, currency, and salary bounds. String comparison ignores case and whitespace. Missing fields are reported separately. Amounts are compared only when both records have the same known currency. No currency conversion or proof of factual accuracy is implied.

Comparisons use the latest stored records and the existing duplicate-link decisions. Those links can be wrong; the feature does not resolve them or rewrite source data. Canonical records can incorporate later linked-source updates, so the view is not an immutable history of original publications. Description, timezone, application-form questions, benefits, and every provider-specific filter are not compared in this increment.

## Developer Contract

- `platforms.directory`: read-only public query with bounded pagination (1-100 items), validated filters, directory metadata, policy and scan states, counts, facets, `coverageComplete: false`, and `dataMode`.
- `platforms.comparisons`: read-only public query with a positive exclusive duplicate-ID cursor and 1-50 pairs per page. Missing referenced records are counted; the cursor still advances.
- `server/sourceIntelligence.ts`: pure comparison and directory construction.
- `server/sourceIntelligenceRepository.ts`: grouped database counts and bounded pair retrieval, with explicitly labelled sample fallback in database-free development.
- `server/scrapers/platformCatalog.ts`: canonical collection policy and seed catalog. Public reads do not seed or mutate the database.
- `client/src/pages/Sources.tsx`: lazy-loaded English/Dutch page integrated with application navigation.

No schema migration or new dependency is needed for this increment. Production still requires the existing configured MySQL database and deployment gates. Unit tests cover adapter parsing and bounds, policy/catalog totals, filter states, sample counts, and exclusive-cursor pagination. These tests are not production database or provider acceptance evidence.

## Remaining Work Toward Global Coverage

### Verification Of This Increment

Local verification on 2026-09-04: 271 test files passed with 1,346 passing tests; one existing integration test was skipped. Type checking and the production build passed. The environment doctor exited successfully but warned about missing production configuration, including the database. Production persistence and deployment acceptance were not exercised.

The actual Himalayas adapter returned two normalized listings without errors during a bounded read-only live check. The Arbeitnow UK adapter returned zero remote listings without errors; a separate direct check confirmed its first page contained 100 records and none with an explicit true remote marker. This is evidence of a working feed response and conservative filtering, not evidence of UK remote-job coverage.

Browser checks covered searching, African-region and Netherlands-country filters, pagination, empty results, JSON export contents, duplicate comparisons, and desktop/mobile layouts. A Dutch tab-label overflow at 320px was reproduced and fixed. No browser console errors or warnings were recorded before the final layout adjustment. The local overview uses sample vacancy data, clearly labelled on screen.

### Next Coverage Work

- Discover and verify further local platforms, countries, languages, and provider-specific filters; no finite register is treated as proof of universal coverage.
- Obtain and record provider access arrangements, implement source-specific adapters, and validate them before enabling unattended collection. Do not bypass login, CAPTCHA, access restrictions, or rate limits.
- Add durable historical backfill, freshness measurements, immutable source observations, and reviewable duplicate corrections.
- Exercise new grouped queries and pagination against the deployment database and verify actual scheduled persistence and provider-health evidence.
- Complete authorized submission, follow-up, scheduling, and interview-preparation workflows without implying the candidate interview itself is automated.
