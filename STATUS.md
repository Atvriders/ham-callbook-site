# Project status — how complete is the archive?

_Generated 2026-11-09 by `scripts/build_status.py` from the database (data release `data-v11`). Regenerate after any banking; edit `docs/wip.json` for in-progress work._

## 12,294,860 entries — **61.5 %** of a complete archive

`█████████████████████████░░░░░░░░░░░░░░░` 61.5 % of ~20.0 M expected entries

| editions | count |
|---|---:|
| ✅ complete (≥ 85 % of expected) | 26 |
| 🔄 being read now — pages still unread | 2 |
| 🟡 partial | 64 |
| ⬜ empty — scans located, not yet transcribed | 9 |
| **catalogued editions** | **101** |

Distinct callsigns: **1,671,799** · per-field coverage: name **99.4 %**, city **86.0 %**, state **86.3 %** (populated and valid).

## In progress — where the work stopped

Vision-OCR of the two largest modern gaps, **Winter 1995** and **Winter 1996**, ran 24 Sep – 7 Oct 2026 on subscription quota (Gemini via the Antigravity CLI, GPT-6-Sol via the Codex CLI) and then stopped: the runner processes were killed while paused for a quota reset. Everything read so far was banked on 7 Nov 2026 (**+664,418 entries, 273,068 existing rows corrected**). **831 PDF pages remain** across the two editions — about one week of both subscriptions' quota at the measured rate (~700 + ~380 pages/week).

| edition | read so far | remaining (PDF pages) | reader | banked |
|---|---|---|---|---|
| Winter 1995 | PDF p3–1279 · 1,256 pages banked (5 held as misaligned reads) | **1280–1816** + 75–76, 103, 204, 329, 363, 367, 438, 453, 496, 559, 561, 580, 678, 765, 924, 1043–1044, 1051, 1061, 1163 (558 pages) | Gemini 3.7 Flash Medium | 2026-11-07 · flag `agy_1995` |
| Winter 1996 | PDF p1–752 (Azure Read, reduced resolution) · p753–1644 (GPT-6-Sol low) · 1 page held | **1645–1912** + 1286, 1288, 1398, 1420, 1604 (273 pages) | GPT-6-Sol low; Azure Read | 2026-11-07 · flags `sol_1996`, `azure_1996` |

**Next steps, in order:**

1. Finish Winter 1995 (558 pages) and Winter 1996 (273 pages) with the same readers and bank them through the same gates.
2. Second-read the Winter 1996 GPT-6-Sol pages (PDF p753–1644) with Gemini to catch its ~7 % one-character slips, and re-read PDF p1–752, which Azure read at reduced resolution (no ZIP column, state often blank).
3. Adjudicate the 39,305 shared callsigns where the old row and the new read disagree and the FCC record cannot referee (kept as-is for now).
4. Then the next-largest gaps (see *Largest gaps* below) — their source scans have to be re-downloaded and rendered first.
5. Small known fix: 23 Spring 1935 Hawaii/Guam calls printed K6 are stored as W6.

How to pick the work back up — pipeline, readers, quality gates, banking: **[docs/RESUME.md](docs/RESUME.md)**.

## How completeness is measured

A full callbook set out to list every licensed US amateur, so an edition's **expected** size is the approximate US licensee population that year. Pre-1928 government station lists, Blue Books and early call books are capped at 20,000. An edition counts as **complete** at ≥ 85 % of expected: editions transcribed end to end land at 96–104 %, so the baseline is good to roughly ±10 %, and the large gaps are real. The low modern editions are partly transcribed books, not small books — adjacent years would otherwise sit at the same ratio.

## By era

| era | entries | expected | complete | editions complete |
|---|---:|---:|---:|---:|
| 1909–1931 · government lists & early books | 69,125 | 320,300 | 22 % | 2 / 27 |
| 1932–1945 · pre-war | 457,052 | 654,000 | 70 % | 6 / 13 |
| 1946–1959 · post-war | 1,534,438 | 1,732,000 | 89 % | 13 / 16 |
| 1960s | 1,812,466 | 3,455,000 | 52 % | 2 / 14 |
| 1970s | 1,886,662 | 3,430,000 | 55 % | 0 / 11 |
| 1980–2003 · modern | 6,535,117 | 10,410,000 | 63 % | 3 / 20 |

## Largest gaps

| edition | entries | expected | missing |
|---|---:|---:|---:|
| Edition 1997 | 303,493 | 680,000 | 376,507 |
| Winter 1992 | 165,103 | 540,000 | 374,897 |
| Winter 1991 | 186,297 | 520,000 | 333,703 |
| Winter 1993 | 242,702 | 560,000 | 317,298 |
| Winter 1990 | 190,781 | 500,000 | 309,219 |
| Winter 1989 | 164,510 | 470,000 | 305,490 |
| Winter 1979 | 105,326 | 380,000 | 274,674 |
| Winter 1988 | 176,698 | 450,000 | 273,302 |
| Winter 1968 | 16,892 | 270,000 | 253,108 |
| Winter 1986 | 188,891 | 440,000 | 251,109 |
| Summer 1968 | 23,635 | 270,000 | 246,365 |
| Winter 1987 | 201,433 | 440,000 | 238,567 |

## Every edition

✅ complete · 🔄 being read now (see *In progress*) · 🟡 partial · ⬜ empty. Machine-readable: [`docs/completeness.csv`](docs/completeness.csv).

| year | edition | entries | expected | % | progress | |
|---|---|---:|---:|---:|---|---|
| 1909 | BlueBook | 57 | 300 | 19 % | `████░░░░░░░░░░░░░░░░` | 🟡 |
| 1910 | BlueBook | 260 | 600 | 43 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1911 | BlueBook | 516 | 900 | 57 % | `███████████░░░░░░░░░` | 🟡 |
| 1913 | GovtStations | 1,523 | 2,000 | 76 % | `███████████████░░░░░` | 🟡 |
| 1914 | BlueBook | 268 | 2,500 | 11 % | `██░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1914 | GovtStations | 2,044 | 2,500 | 82 % | `████████████████░░░░` | 🟡 |
| 1915 | GovtStations | 4,566 | 3,500 | 130 % | `████████████████████` | ✅ |
| 1916 | GovtStations | 3,928 | 4,000 | 98 % | `████████████████████` | ✅ |
| 1920 | GovtStations | 2,762 | 6,000 | 46 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1921 | GovtStations | 5,910 | 11,000 | 54 % | `███████████░░░░░░░░░` | 🟡 |
| 1922 | CallBook | 66 | 15,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1922 | Consolidated | 833 | 15,000 | 6 % | `█░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1922 | GovtStations | 8,060 | 15,000 | 54 % | `███████████░░░░░░░░░` | 🟡 |
| 1923 | CallBook | 0 | 16,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1923 | GovtStations | 0 | 16,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1924 | CallBook | 11,976 | 16,500 | 73 % | `███████████████░░░░░` | 🟡 |
| 1924 | GovtStations | 0 | 16,500 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1925 | GovtStations | 2,086 | 17,000 | 12 % | `██░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1926 | CallBook | 0 | 17,500 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1926 | GovtStations | 0 | 17,500 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1927 | GovtStations | 0 | 17,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1927 | Summer | 10,926 | 17,000 | 64 % | `█████████████░░░░░░░` | 🟡 |
| 1928 | GovtStations | 0 | 17,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1928 | September | 13,283 | 17,000 | 78 % | `████████████████░░░░` | 🟡 |
| 1929 | GovtStations | 0 | 18,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1930 | GovtStations | 0 | 19,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | ⬜ |
| 1931 | GovtStations | 61 | 20,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1932 | Fall | 25,229 | 30,000 | 84 % | `█████████████████░░░` | 🟡 |
| 1933 | Spring | 38,461 | 38,000 | 101 % | `████████████████████` | ✅ |
| 1934 | Fall | 36,695 | 42,000 | 87 % | `█████████████████░░░` | ✅ |
| 1935 | Spring | 57,503 | 46,000 | 125 % | `████████████████████` | ✅ |
| 1936 | Spring | 40,016 | 48,000 | 83 % | `█████████████████░░░` | 🟡 |
| 1937 | Fall | 22,104 | 52,000 | 42 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1938 | Spring | 51,093 | 55,000 | 93 % | `███████████████████░` | ✅ |
| 1938 | Winter | 25,928 | 55,000 | 47 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1939 | Spring | 29,240 | 56,000 | 52 % | `██████████░░░░░░░░░░` | 🟡 |
| 1940 | Fall | 26,260 | 56,000 | 47 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1940 | Spring | 48,131 | 56,000 | 86 % | `█████████████████░░░` | ✅ |
| 1941 | Spring | 56,248 | 60,000 | 94 % | `███████████████████░` | ✅ |
| 1941 | Winter | 144 | 60,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1946 | Fall | 55,029 | 60,000 | 92 % | `██████████████████░░` | ✅ |
| 1946 | Summer | 57,467 | 60,000 | 96 % | `███████████████████░` | ✅ |
| 1947 | Fall | 65,617 | 75,000 | 88 % | `█████████████████░░░` | ✅ |
| 1948 | Fall | 72,368 | 85,000 | 85 % | `█████████████████░░░` | ✅ |
| 1949 | Summer | 73,580 | 87,000 | 85 % | `█████████████████░░░` | 🟡 |
| 1950 | Summer | 81,726 | 87,000 | 94 % | `███████████████████░` | ✅ |
| 1951 | Spring | 90,070 | 90,000 | 100 % | `████████████████████` | ✅ |
| 1952 | Fall | 99,692 | 96,000 | 104 % | `████████████████████` | ✅ |
| 1953 | Fall | 106,608 | 105,000 | 102 % | `████████████████████` | ✅ |
| 1954 | Fall | 77 | 112,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1954 | Spring | 74,736 | 112,000 | 67 % | `█████████████░░░░░░░` | 🟡 |
| 1955 | Fall | 136,818 | 135,000 | 101 % | `████████████████████` | ✅ |
| 1956 | Spring | 138,557 | 140,000 | 99 % | `████████████████████` | ✅ |
| 1957 | Fall | 156,841 | 155,000 | 101 % | `████████████████████` | ✅ |
| 1958 | Summer | 165,756 | 163,000 | 102 % | `████████████████████` | ✅ |
| 1959 | Spring | 159,496 | 170,000 | 94 % | `███████████████████░` | ✅ |
| 1960 | Winter | 163,750 | 170,000 | 96 % | `███████████████████░` | ✅ |
| 1961 | Fall | 133,015 | 220,000 | 60 % | `████████████░░░░░░░░` | 🟡 |
| 1961 | Spring | 176 | 220,000 | 0 % | `░░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1962 | Fall | 203,726 | 205,000 | 99 % | `████████████████████` | ✅ |
| 1963 | Summer | 197,534 | 250,000 | 79 % | `████████████████░░░░` | 🟡 |
| 1964 | Fall | 156,911 | 250,000 | 63 % | `█████████████░░░░░░░` | 🟡 |
| 1965 | Summer | 179,012 | 255,000 | 70 % | `██████████████░░░░░░` | 🟡 |
| 1966 | Spring | 156,296 | 260,000 | 60 % | `████████████░░░░░░░░` | 🟡 |
| 1967 | Fall | 105,687 | 265,000 | 40 % | `████████░░░░░░░░░░░░` | 🟡 |
| 1968 | Spring | 94,252 | 270,000 | 35 % | `███████░░░░░░░░░░░░░` | 🟡 |
| 1968 | Summer | 23,635 | 270,000 | 9 % | `██░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1968 | Winter | 16,892 | 270,000 | 6 % | `█░░░░░░░░░░░░░░░░░░░` | 🟡 |
| 1969 | Fall | 156,840 | 275,000 | 57 % | `███████████░░░░░░░░░` | 🟡 |
| 1969 | Summer | 224,740 | 275,000 | 82 % | `████████████████░░░░` | 🟡 |
| 1970 | Spring | 143,534 | 285,000 | 50 % | `██████████░░░░░░░░░░` | 🟡 |
| 1971 | Fall | 211,191 | 290,000 | 73 % | `███████████████░░░░░` | 🟡 |
| 1971 | Winter | 173,517 | 290,000 | 60 % | `████████████░░░░░░░░` | 🟡 |
| 1972 | Winter | 179,929 | 295,000 | 61 % | `████████████░░░░░░░░` | 🟡 |
| 1973 | Winter | 251,725 | 300,000 | 84 % | `█████████████████░░░` | 🟡 |
| 1974 | Winter | 123,629 | 300,000 | 41 % | `████████░░░░░░░░░░░░` | 🟡 |
| 1975 | Winter | 149,414 | 300,000 | 50 % | `██████████░░░░░░░░░░` | 🟡 |
| 1976 | Winter | 213,978 | 310,000 | 69 % | `██████████████░░░░░░` | 🟡 |
| 1977 | Winter | 153,400 | 330,000 | 46 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1978 | Winter | 181,019 | 350,000 | 52 % | `██████████░░░░░░░░░░` | 🟡 |
| 1979 | Winter | 105,326 | 380,000 | 28 % | `██████░░░░░░░░░░░░░░` | 🟡 |
| 1980 | Winter | 270,413 | 400,000 | 68 % | `██████████████░░░░░░` | 🟡 |
| 1981 | Winter | 207,453 | 410,000 | 51 % | `██████████░░░░░░░░░░` | 🟡 |
| 1982 | Winter | 250,230 | 420,000 | 60 % | `████████████░░░░░░░░` | 🟡 |
| 1983 | Winter | 379,909 | 430,000 | 88 % | `██████████████████░░` | ✅ |
| 1984 | Winter | 317,905 | 440,000 | 72 % | `██████████████░░░░░░` | 🟡 |
| 1985 | Winter | 207,245 | 440,000 | 47 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1986 | Winter | 188,891 | 440,000 | 43 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1987 | Winter | 201,433 | 440,000 | 46 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1988 | Winter | 176,698 | 450,000 | 39 % | `████████░░░░░░░░░░░░` | 🟡 |
| 1989 | Winter | 164,510 | 470,000 | 35 % | `███████░░░░░░░░░░░░░` | 🟡 |
| 1990 | Winter | 190,781 | 500,000 | 38 % | `████████░░░░░░░░░░░░` | 🟡 |
| 1991 | Winter | 186,297 | 520,000 | 36 % | `███████░░░░░░░░░░░░░` | 🟡 |
| 1992 | Winter | 165,103 | 540,000 | 31 % | `██████░░░░░░░░░░░░░░` | 🟡 |
| 1993 | Winter | 242,702 | 560,000 | 43 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1994 | Winter | 456,094 | 600,000 | 76 % | `███████████████░░░░░` | 🟡 |
| 1995 | Winter | 554,884 | 640,000 | 87 % | `█████████████████░░░` | 🔄 |
| 1996 | Winter | 612,442 | 670,000 | 91 % | `██████████████████░░` | 🔄 |
| 1997 | Edition | 303,493 | 680,000 | 45 % | `█████████░░░░░░░░░░░` | 🟡 |
| 1999 | CD-ROM | 727,553 | 680,000 | 107 % | `████████████████████` | ✅ |
| 2003 | CD-ROM | 731,081 | 680,000 | 108 % | `████████████████████` | ✅ |
