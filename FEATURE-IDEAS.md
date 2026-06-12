# Feature Ideas — USA Ham Callbook Archive

Generated 2026-06-12 by a multi-agent ideation panel (6 user personas — genealogist,
radio historian, active ham, data scientist, community/product, casual visitor — each
proposed features grounded in the project's actual data assets; a judge agent merged
59 raw ideas into 15 survivors and ranked them by usefulness × originality ×
feasibility-with-existing-data). Competitive-landscape claims come from a same-day
web research pass; summary at the bottom of this document.

**Key takeaway:** almost everything below runs on data the project already has.
Ranks 5, 6, 9, 12, 13 are low-effort (mostly SQL + templating over existing tables).
Rank 1's address-normalization pass is shared infrastructure that unlocks ranks 2
and 12; rank 3's renderer is reused by ranks 6 and 10; rank 4's phonetic index is a
prerequisite for rank 15.

---

## 1. Address Time Machine — "Did a ham live in my house?" + Ham Households
**Effort: medium · Convergence: 5 of 6 personas independently (strongest signal in the set)**

Reverse street-address search with USPS-style normalization (St/Street, directionals,
OCR cleanup) returning every licensee ever recorded at an address across all 92
editions as a permalinked timeline, plus a "this street in 19XX" neighbors view. The
same address index drives a derived **Households** layer: same-address +
same/shared-surname clusters rendered as family-station cards ("father and son
Novices, 1948–1971") with cross-links on callsign pages, and a browsable
multi-generation-family list.

- **Why:** The most viral feature possible — everyone (homeowner, genealogist,
  journalist, ham) can type their own address. Answers perennial real questions
  (mystery attic antennas, "was grandpa's brother licensed too?") and pulls a
  non-ham audience through the front door.
- **Data:** Entirely existing street/city/state/year fields (≈5M populated address
  rows; one panel verified 1,054 multi-callsign addresses in a single partial 1975
  edition). Work: offline address-normalization pass, address-cluster table, FTS on
  normalized addresses. No external data.
- **Originality:** No competitor indexes callbook addresses at all — QRZ hides
  addresses, HamCall snapshots can't show continuity, AE7Q has no pre-FCC
  addresses, scans are unsearchable.

## 2. Paper-Trail Lineage: printed-era operator linkage + Person Pages
**Effort: high · Personas: data scientist (full design) + genealogist (converged on matching evidence)**

Offline probabilistic record-linkage (Fellegi-Sunter / splink-style; name +
normalized address + city/state blocking, edition-adjacency prior) that links
**different callsigns to the same human** across editions — anchored by the
deterministic Novice-prefix rule (KN4ABC at 412 Oak St vanishes in 1962, K4ABC
appears at the identical address in 1963). Ships as one new SQLite table powering
"Likely same operator" evidence cards and a new **Person Page** splicing printed-era
links onto the existing FCC lineage so a chain can run 1958→2026.

- **Why:** The single highest-value capability no one on earth has: AE7Q's lineage
  starts ~1985, HamCall has none. Converts the archive from a lookup tool into an
  identity graph, and retroactively upgrades nearly every other feature (cohort
  survival, migration, GEDCOM, heritage narratives) from callsign-level to
  person-level.
- **Data:** Entirely existing: 7.38M entries with name/address/year, distinct-holder
  clusters, and 271K FCC vanity chains that double as a labeled validation set for
  precision/recall. Blocking on (state, soundex(surname)) keeps the pairwise space
  tractable. Reuses rank 1's address normalization.
- **Originality:** Only this corpus has dense edition-over-edition address
  continuity, which is what makes the linkage statistically sound — HamCall's 17
  snapshots are too sparse for adjacency-based matching. **The deterministic KN→K
  rule alone is a cheap, shippable v1.**

## 3. Heritage Story & Artifacts Engine
**Effort: medium · Convergence: 4 personas independently**

One generated-prose surface plus three renderings of the same composition:

a. **/story/W2ABC** — deterministic plain-English biography of a callsign with
   permalink and OG unfurl ("first appears in the June 1936 Callbook… trail goes
   cold during WWII… reissued 2004, still active")
b. **Certificate PDF** — print-ready, vintage-styled, listing every holder and
   edition; with a toned-down Silent Key memorial variant for families and estate
   executors
c. **Share-card PNG** — server-rendered amber-CRT card used as every callsign
   page's OG image
d. **Embeddable badge** — auto-updating `/badge/{call}.svg` ("K3XYZ • first issued
   1936 • 5 holders • 54 editions") for QRZ bios and club sites

- **Why:** Top-of-funnel growth engine: hams frame certificates and decorate QRZ
  bios (every badge is a permanent high-relevance backlink), grandchildren and
  journalists quote the prose story, families share memorial pages.
- **Data:** Entirely existing — a composition of queries the callsign page already
  runs. Needs one prose-template engine and one image/PDF renderer
  (satori/Pillow/WeasyPrint) reused across all four outputs.
- **Originality:** HamCall/QRZ/AE7Q show rows, never narrative or printable
  artifacts — and none can write a pre-1985 story at all.

## 4. Phonetic People Finder (abbreviation-aware name-first search)
**Effort: medium · Convergence: 2 personas independently**

A dedicated "find a person" search matching names the way old callbooks printed
them: Soundex/Double-Metaphone phonetic keys, expansion of period abbreviations
(Wm.→William, Chas.→Charles, Jno.→John), initial-tolerant matching ("W. H. Smith" =
"William Smith"), state + decade filters, results grouped into likely same-person
identities with confidence badges. Surfaced as a guided "Was my relative a ham?"
flow with era sliders.

- **Why:** Genealogists arrive with a NAME, not a callsign, and exact-match FTS
  misses "Robt. E. Kowalski". Biggest unlock for name-first discovery; prerequisite
  index for the GEDCOM tree scan (rank 15).
- **Data:** Entirely existing 7.38M name fields. Build: offline pass adding
  phonetic-key columns to SQLite, a curated few-hundred-entry nickname/abbreviation
  dictionary (standard genealogy lists exist), one new endpoint + results UI.
- **Originality:** No callbook resource does phonetic or abbreviation-normalized
  matching, and genealogy giants lack the structured ham records entirely.

## 5. Citations, Stable Permalinks & Versioned Snapshots
**Effort: low · Convergence: 4 personas independently**

A "Cite this record" button on every record, person, club, and chart page emitting
Evidence Explained, Chicago/MLA/APA, BibTeX, and plain-text citations naming the
printed edition, page (once provenance mapping lands), the site as repository, a
stable permalink, dataset version, and access date — one-click copy. Dataset
releases get version tags (v2026.06) with as-of-version snapshot rendering so later
OCR corrections never silently invalidate a published citation; citations
auto-include the integrity report's accuracy note for the era.

- **Why:** Genealogists, QST/CQ columnists, Wikipedia editors, and thesis writers
  will not use what they cannot cite — and every pasted citation is a permanent
  advertisement. Highest value-per-line-of-code on the list; converts the integrity
  report from a confession into a selling point.
- **Data:** Entirely existing: edition bibliographic metadata + record IDs. New
  work is templating, a version column/release manifest, and committing to
  permanent URLs.
- **Originality:** HamCall and QRZ are structurally anti-citation (paywalls,
  mutable pages); archive.org scans aren't citable at record level.

## 6. Records & Superlatives Leaderboards ("Century Club")
**Effort: low · Convergence: 3 personas independently**

A precomputed, weekly-refreshed record book with drill-down lists and shareable
detail pages: longest continuously-issued callsigns, longest single-holder tenure
bridging editions into the current ULS grant, oldest first-issue calls still
FCC-active this week, most-reissued calls, longest tenure at one address,
longest-running clubs — filterable by state/district/class, every row linking to
the heritage page, with N-consecutive-edition thresholds to filter OCR false
positives.

- **Why:** The discovery engine the archive lacks: gives visitors without a
  callsign in mind something to explore, gives 60-year old-timers recognition, and
  is free press bait ("the oldest callsign in Ohio"). Feeds the badge/certificate
  engine.
- **Data:** Entirely existing: edition spans + holder clusters + weekly ULS status.
  One batch script materializing tenure-span and leaderboard tables.
- **Originality:** Computing "licensed 1931, still active 2026" requires
  1909–present coverage — mathematically impossible from HamCall's 17 snapshots or
  AE7Q's ~1985+ data.

## 7. Page Provenance Viewer ("See the Source")
**Effort: high · Convergence: 2 personas (+1 dependent proposal)**

Every historic record gets a "View original page" button opening the scanned
printed-callbook page (deep-zoom or simple image v1) with the OCR'd line
highlighted, plus an inline strip-crop of just that printed line with edition title
and page number. An "I can read this better" link pre-fills the corrections flow.

- **Why:** The difference between "a website claims X" and a primary source
  verified with your own eyes — required by the Genealogical Proof Standard,
  demanded by historians, and the emotional screenshot moment ("grandpa's name in
  1936 print"). Instantly defuses OCR skepticism; substrate for ranks 5, 8, and 3's
  evidentiary value.
- **Data:** Source PDFs already exist offline in the pipeline dir; needs rendered
  page images, storage/CDN, and record→(page, bbox) mapping — if OCR emitted
  hOCR/ALTO the coordinates already exist in pipeline artifacts. Ship
  edition-by-edition starting with clean post-1963 scans; strip-crops alone are a
  viable half-effort v1. Check copyright posture per edition.
- **Originality:** Archive.org/DLARC/leehite have scans with no structure; HamCall
  has structure with no scans. Linking a structured record to the exact printed
  line is the FamilySearch/Ancestry model never applied to callbooks.

## 8. Corrections Desk: confidence-ranked, crowd-verified record fixes
**Effort: medium · Convergence: 3 personas, 4 separate proposals**

A "Suggest a correction" button on every record (pre-filled field/value/source
form) feeding a moderation queue that exports into the existing reviewable
overrides CSV, plus a "help restore the record" page that serves the records MOST
LIKELY wrong — ranked from audit tables already in the DB (3-way OCR
disagreements, ULS-anchor mismatches, low-confidence editions,
dictionary-implausible names). Adopt-an-edition progress bars, contributor credits
on the integrity page, Match/Fix/Skip verification against scan crops once rank 7
lands.

- **Why:** 7.38M OCR records can't be hand-verified by one maintainer; this is the
  proven FamilySearch/Zooniverse model aimed at the ideal volunteer demographic
  (retired, detail-oriented, nostalgic hams). Active-learning targeting spends
  scarce human labels exactly where the pipeline is least certain — a community
  moat paywalled competitors structurally cannot copy.
- **Data:** Scoring substrate already in the DB (corrections_3way, uls_anchor,
  sample_confidence, raw_ocr) plus the existing overrides workflow. New: a small
  writable submissions store beside the read-only SQLite and a moderation view.
- **Originality:** No competitor accepts corrections to historic records at all —
  snapshots are frozen, PDFs uneditable — let alone exposes its error model to
  route volunteers.

## 9. Edition Diff Explorer + Wartime Silence cohorts
**Effort: low · Convergence: 2 personas independently**

A changelog for every consecutive edition pair — new calls, dropped calls, address
changes, class upgrades, reissues — filterable by state, CSV-exportable, with a
growth-decomposition chart splitting the existing net-growth curve into gross adds
vs drops. The same diff engine powers flagship themed pages for the two federal
shutdowns: WWII (1941/42 vs 1946/47) and WWI "returned / never returned / first
licensed after the war" rosters, with timeline badges ("Listed 1941 — no postwar
record") on affected callsign pages.

- **Why:** Answers what the growth page can't: what did the 1968
  incentive-licensing exodus or the no-code Tech wave actually look like, flow by
  flow? The wartime rosters quantify the defining ruptures of US ham history for
  the first time — irresistible anniversary press. Implausible-churn editions also
  flag OCR parse problems for free.
- **Data:** Pure SQL over existing callsign × year columns (survival join already
  validated: 145,716 1975 calls, 95,484 present in 1976). One precomputed
  edition_diff table; WWI-side strength depends on which pre-1917 editions are in
  the 92.
- **Originality:** Diffs require consecutive editions in structured form — this is
  the only corpus dense enough; HamCall's sparse snapshots can't do year-over-year.

## 10. ADIF Time Machine + Heritage Awards
**Effort: medium · Personas: active ham (highest-originality operating-tool idea in the set)**

Upload an ADIF log (processed statelessly) and every QSO callsign is resolved to
the holder **as of the QSO date** — flagging reissues (your 1979 QSO with W6AM was
Don Wallace, not today's holder) — returning an annotated ADIF plus stats (oldest
first-licensed op worked, decade histogram). The same point-in-time engine drives
an awards program ("Worked 50 Heritage Stations" — calls first issued 50+ years
before the QSO) with serial-numbered certificates via the rank-3 renderer and a
downloadable heritage-call CSV for N1MM/logger check windows.

- **Why:** DXers with 40-year logs constantly mis-attribute reissued calls;
  point-in-time resolution is the only fix. Awards are the hobby's proven dopamine
  loop (DXCC/WAS), and this one gets people on the air via the site.
- **Data:** Existing: edition-year records + holder clusters + ULS license history
  post-1997. ADIF parsing is stateless; honor-system verification avoids QSL
  infrastructure.
- **Originality:** No lookup service anywhere answers "who held this call on this
  date" — QRZ/HamCall answer only "now" (or 1993) — and no existing operating
  award can score call age at QSO time.

## 11. Cohort Observatory: survival curves + class-ladder flows
**Effort: medium · Convergence: 2 personas independently**

Pick a cohort (first-licensed year, entry class, optional state) and get
(a) Kaplan-Meier-style retention curves — what fraction of the 1962 Novice class
still appears 5/10/25/50 years later, right-censored at the 1997 print horizon and
extended to today via ULS — and (b) decade-by-decade Sankeys of class progression
(Novice→General→Advanced→Extra) with median years-per-rung. Side-by-side cohort
comparison (1958 Novices vs 1991 no-code Techs), citable permalinks, CSV export,
confidence bands annotated from the integrity report.

- **Why:** The "do Novices stick with the hobby?" debate has raged in QST letters
  for 60 years with zero data; this answers it definitively and informs today's
  licensing-policy arguments. Rank 2 later upgrades it from callsign-survival to
  person-survival.
- **Data:** Existing only: license_class on ~5.9M rows + edition years + holder
  clusters; precomputed cohort tables. Must annotate the sparse-1950s gap so curves
  don't silently lie. The statistical care (interval censoring across edition gaps)
  is the real work, not engineering.
- **Originality:** Needs every-edition density plus class data — only this corpus
  has both; AE7Q can only do post-1997 cohorts and the interesting ones are
  1951–1991.

## 12. QSL Card Dating Wizard
**Effort: low · Personas: historian**

A guided tool for collectors: enter a callsign plus any detail printed on an
undated QSL card (street, city, operator name) and get the edition-year window when
that exact combination was in print — "most likely mailed 1953–1958, while W9XYZ
was at 412 Oak St, Peoria" — with the bounding records and address-change timeline
shown as evidence.

- **Why:** QSL collectors, hamfest dealers, and museum registrars constantly need
  to date and authenticate cards; the address is the dating key and only this
  archive holds addresses longitudinally. Passionate niche that will evangelize the
  site, at near-zero build cost.
- **Data:** Entirely existing: per-edition address/city/state + FTS5/BM25 tolerant
  matching. A guided query UI over existing tables.
- **Originality:** Cannot exist anywhere else — the alternative today is paging
  through scanned PDFs by hand. (The active-ham's QSL card *gallery* with UGC
  uploads was cut as the heaviest new-infrastructure item; its address-match
  verification trick belongs here.)

## 13. Open Data Portal: versioned releases, DOIs, self-serve API + DLARC deposit
**Effort: low · Convergence: 2 personas independently**

A /data + /research page: versioned bulk downloads (full SQLite, per-edition CSVs,
lineage and club tables) under ODC-BY/CC-BY with SHA-256 manifests, schema docs,
and a changelog tied to the integrity report; instant rate-limited API keys for the
existing FastAPI endpoints; each release deposited to Internet Archive DLARC
(standard `internetarchive` CLI), Zenodo (DOI), and Kaggle/HuggingFace with proper
datasheets.

- **Why:** Makes this the canonical dataset rather than another silo: academics,
  Wikipedia editors, and ML/OCR researchers (great OCR-correction benchmark) cite
  deposited datasets, earning high-authority backlinks and standing with
  DLARC/ARDC — a plausible grant avenue. The dataset outliving the website is the
  archivist's definition of winning.
- **Data:** All existing; work is export scripts, license text, manifest
  generation, dataset documentation, and a release step bolted onto the existing
  periodic build. Confirm compilation licensing before publishing.
- **Originality:** Every competitor with structured data paywalls it (HamCall) or
  gates it (QRZ); an open, versioned, DOI'd release is itself the differentiator.

## 14. First-Name Voyager + YL Index (demographics of the hobby)
**Effort: medium · Convergence: 2 personas independently**

A baby-name-voyager-style explorer over operator first names — type "Mildred" or
"Elmer" and see counts per edition 1920–1997 with compare mode — plus a
methodologically-careful **YL index** estimating the share of women operators per
state per decade via SSA baby-names gender association, with explicit confidence
bands, unclassifiable-name exclusions, and a gallery of the earliest identifiable
women per state, every figure linking to underlying records.

- **Why:** The history of women in amateur radio is actively researched (YLRL
  centennial) with essentially no quantitative basis — this provides the first one
  ever; a ready-made women-in-STEM story for journalists and classrooms. The
  general name explorer is pure shareable fun ("peak Elmer was 1954").
- **Data:** Existing names/state/year on 7M rows; one NEW free static file
  (public-domain SSA National Baby Names zip, no API). First-name extraction is a
  regex pass; honest labeling fits the integrity-report ethos.
- **Originality:** Requires full-corpus structured names across every edition —
  impossible from scans, snapshots, or paywalled lookups; no historical gender
  analysis of US amateur licensing exists anywhere.

## 15. GEDCOM Bridge: sourced export + tree scan
**Effort: medium · Personas: genealogist (two complementary proposals; single-panel, hence ranked last among survivors despite high originality)**

**Phase 1:** a "Download GEDCOM" button on person/holder pages emitting a .ged with
RESI events per edition-year address, custom events for first license / upgrades /
callsign changes, and per-fact SOUR citations naming the exact edition — imports
cleanly into Gramps/RootsMagic/Ancestry/FamilySearch.
**Phase 2:** upload your family-tree GEDCOM and the site matches all individuals
against the archive (rank-4 phonetic index + state/era plausibility scoring),
returning conservative "candidate, verify yourself" hits: "Your great-uncle Harold
J. Bittner may be W8KQJ, Toledo 1932–1958." Files processed in-memory, never
stored.

- **Why:** Genealogists live in tree software — data that can't enter the tree
  effectively doesn't exist — and the tree scan inverts the search to check 400
  ancestors at once. "I uploaded my tree and found three hams I never knew about"
  is the story that spreads through r/Genealogy and society newsletters.
- **Data:** Entirely existing archive data; GEDCOM 5.5.1 is simple text with mature
  open-source Python parsers. Export is a serializer over queries the person page
  already runs; scan depends on the rank-4 phonetic index plus
  false-positive-tolerant score tuning.
- **Originality:** The intersection is empty in both directions: no ham-history
  site speaks genealogy formats, no genealogy site has callbook data — a
  category-creating bridge.

---

## Suggested build order

1. **Quick wins (low effort, mostly SQL + templating):** #5 citations/permalinks,
   #6 leaderboards, #9 edition diffs + wartime cohorts, #12 QSL dating wizard,
   #13 open data portal.
2. **Shared infrastructure:** #1 address normalization (unlocks #2 linkage, #12
   accuracy, households layer); #3 artifact renderer (reused by #6 and #10);
   #4 phonetic index (prerequisite for #15 phase 2).
3. **Flagships:** #2 paper-trail lineage (KN→K deterministic rule first as v1),
   #7 provenance viewer (strip-crops as half-effort v1), #8 corrections desk.

## Competitive landscape (researched 2026-06-12)

No existing project offers a structured, searchable, cross-edition database of the
printed callbook era (1909–1997). Closest:

- **HamCall.net (Buckmaster):** structured historic archive (~11.4M records) but
  only 17 snapshot years (1921, 1940, 1948, 1954, 1957, 1960, 1965, 1969, 1972,
  1977, 1983, 1990, 1995, 2000, 2005, 2010, 2015); paywalled; flat previous-call
  fields, no lineage chains, no club detection.
- **AE7Q.com:** structured FCC-era holder succession + vanity lineage, but nothing
  before ~1985; closed-source one-person operation.
- **QRZ.com:** current FCC only + a single 1993 snapshot (previous calls back to
  1983, only for then-active licensees). silentkeyhq.com adds 1993/1997/2002
  snapshots.
- **Scan archives (leehite.org, archive.org/DLARC, WorldRadioHistory, HathiTrust,
  earlyradiohistory.us):** PDFs/page images with imperfect per-document OCR search;
  no structured data. archive.org's 157-item callbook collection contains only 3
  Radio Amateur Callbook editions (1949, Winter 1990-91, 1996).
- **Open source:** current-ULS mirrors only (e.g. fccULSloader, MIT-licensed SQLite
  copy of l_amat). No project OCRs printed callbooks into structured data.
- **Documented gap:** a 2013 research guide and a 2019 article both state that for
  roughly 1924–1992 no comprehensive online callsign search exists — researchers
  page through scans manually.
- **Free raw material:** HathiTrust holds public-domain scans of the government's
  *Amateur Radio Stations of the U.S.* 1920–1931 (Dept. of Commerce series) —
  usable to densify 1920s coverage.
