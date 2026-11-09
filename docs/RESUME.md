# Picking the work back up

Where the OCR-recovery work stopped, and everything needed to continue it. Numbers per edition live in
[STATUS.md](../STATUS.md) (regenerated from the database by `scripts/build_status.py`); in-progress state lives in
[`wip.json`](wip.json). Last updated 2026-11-09.

## 1. Where things stand

- **Database `data-v11`: 12,294,860 entries — 61.5 % of a complete archive** (~20.0 M expected). 26 editions complete,
  2 being read, 64 partial, 9 empty, of 101 catalogued.
- **Last campaign: Winter 1995 and Winter 1996**, the two largest modern gaps. Read 24 Sep – 7 Oct 2026, banked 7 Nov 2026:
  +664,418 entries and 273,099 corrected rows. Nothing is waiting to be banked.
- **Still to read — 831 PDF pages:**

  | edition | PDF pages |
  |---|---|
  | Winter 1995 | **1280–1816**, plus 75–76, 103, 204, 329, 363, 367, 438, 453, 496, 559, 561, 580, 678, 765, 924, 1043–1044, 1051, 1061, 1163 (558) |
  | Winter 1996 | **1645–1912**, plus 1286, 1288, 1398, 1420, 1604 (273) |

  Pages 103, 363, 367, 496, 765 (1995) and 1398 (1996) were read but held back as misaligned; the others failed or were never reached.
- The raw per-page reads, the banking records and the benchmark truth are attached to the `data-v11` release as
  `ocr-reads-2026-11.tar.gz`.

## 2. Source scans

- From [leehite.org/callbooks](https://leehite.org/callbooks/) and archive.org. The 1980s–1990s PDFs embed **one 600-dpi bilevel
  image per page** — extract it directly (`pdfimages -png -f N -l N book.pdf out`); there is no need to re-render.
- **PDF page index ≠ printed page number.** Winter 1995: p1 front matter, p2 duplicates p1816, p3 onward = call district 0
  (printed pages from 1660), then districts 1–9; US listings end at p1816 (p1817 starts Cuba). Winter 1996: US listings p1–1912.
- Disk: a full modern edition's page images are tens of GB. Work edition by edition — extract, read, bank, delete.

## 3. Page preparation

- Split each page into its **three columns**. The gutters are the *widest* blank vertical strips near ⅓ and ⅔ of the text block —
  the narrower gap in front of the right-aligned state/ZIP column is not a gutter.
- Crop each column at full height and scale to about 0.67 × of 600 dpi (≈ 1,100 × 4,400 px). Whole columns read better than
  smaller tiles and cost fewer requests.
- 1990s entry layout: `CALLSIGN  CLASS  Name, street address, City …… ST ZIP`. Long entries wrap onto an indented line; state and
  ZIP sit on the entry's last line; some entries are just a name and a remark (`NOW AE4AT`, `QTH Wanted by CALLBOOK`).

## 4. Readers

Benchmarked on two blind-adjudicated test sets (where readers disagreed, the scan was re-read independently twice, and a third
reader broke ties): Spring 1935 (5 pages, 481 entries) and Winter 1996 PDF p800 (361 entries of dense 1990s print).

| reader | Spring 1935 recall / surname / city / state | 1996 p800 field accuracy | s / page | notes |
|---|---|---|---|---|
| **Gemini 3.7 Flash Medium** | 100 / 99.6 / 100 / 98.8 | 99.6 % | 70 | best pages per unit of quota — the default |
| Gemini 3.1 Pro Low | 99.8 / 99.8 / 100 / 99.0 | 99.9 % | 94 | for hard pages / tie-breaks |
| GPT-6-Sol low | 100 / 99.2 / 99.6 / 100 | 98.6 % | ~110 | ~25 one-character slips per dense page |
| Azure AI Vision Read | 98 / 97 / 78 / 99 (original gold) | — | ~10 | needs the native-resolution scan and a geometry parser |
| Tesseract 5 (local) | 77 / 98 / 83 / 65 (original gold) | — | ~60 CPU-s | free, but misses dense entries |

Higher reasoning effort did not improve accuracy on any model — it only costs quota. Every "state miss" for Gemini on the 1935
set was an `Okla. City.` entry, where no state is printed.

How the two subscription readers were driven (both read the three column images and return CSV
`callsign,class,name,address,city,state,zip,note,page`):

- **Gemini** — Google's official Antigravity CLI: `agy -p "<prompt>" --model gemini-3.7-flash-medium --mode plan --output-format json`
  (`plan` mode gives the model no tools, so it can only look at the images); `agy -p /usage` reports the 5-hour and weekly
  allowance with reset times. The CLI needs a CPU with PCLMULQDQ/AVX — a VM using a generic QEMU CPU model cannot run it.
  Throughput: ≈ 120 pages per 5-hour window at 8 pages in parallel, ≈ 700 pages per weekly allowance.
- **GPT-6-Sol** — the Codex CLI: `codex exec --json -m gpt-6-sol -c model_reasoning_effort=low "<prompt>"` with stdin from
  `/dev/null`. Audit each session log and accept a page only if the model viewed the three images and ran nothing else — left
  unconstrained it installs a local OCR program or copies earlier outputs. ≈ 65 pages per window, ≈ 380 per week.

Runner design that worked: one runner per reader; each page is claimed atomically in a shared claims directory so two readers
never read the same page; a done-list makes runs resumable; on a usage limit the runner sleeps until the reset time and carries
on; a page is accepted only if the CSV parses and the session's model is the one requested. **Run it under a watchdog** — both
runners were killed while sleeping through a quota pause in October 2026 and nothing restarted them.

## 5. Quality gates and banking

How Winter 1995/1996 were banked (the private working directory keeps the scripts):

1. **Normalise**: callsign `Ø`/`O`→`0` and a valid US format; class E/A/G/T/P/N/B; 2-letter state; 5-digit ZIP; `NOW …` remarks moved
   out of the ZIP and address fields.
2. **Alignment, page by page, against the FCC ULS current holder of each callsign.** Correct reads agree ≈ 87 % (some calls
   were reissued since); a page under 40 % of the edition median is a misaligned read — hold it and re-read.
3. **Internal consistency**: the ZIP must agree with its own state (99.95 % for Gemini/GPT-6-Sol). Never infer a state from other
   records — keep a reader's state only when it is printed and consistent, otherwise leave it blank.
4. **Insert** callsigns the edition lacks. On callsigns it already has, replace the old row only with evidence: its name is junk,
   the FCC holder backs the new read and not the old, or both reads name the same person. Leave real disagreements alone and log them.
5. **Make it reversible**: a flag per source (`agy_1995`, `sol_1996`, `azure_1996`, with `_fix`/`_fill` for corrected rows), a backup
   of every prior value, new rows appended to the edition's source CSV and corrections appended to `entries_overrides.csv` so a
   rebuild keeps them.
6. **Reconcile**: rebuild `dataset_meta`, `editions` and `stats_per_year` (the FTS index follows by trigger), check all counts agree,
   run `PRAGMA integrity_check`.
7. **Log** every issue found, per edition, in the working directory's audit queue.

Before the gates were adopted, the old OCR rows for these two editions matched the FCC holder only 61–67 % of the time — far
worse than they looked.

## 6. Publishing a data release

1. Counts reconcile and `PRAGMA integrity_check` = ok; checkpoint the WAL.
2. `gzip -c` the database; carry `callbook-artifacts.tar.gz` forward from the previous release unless the artifacts were rebuilt.
3. `gh release create data-vN … USA_Ham_Callbooks.sqlite.gz callbook-artifacts.tar.gz`; verify every asset shows `uploaded` at the
   right size.
4. Bump the `DATA_TAG` default in `docker-compose.yml` **and** `backend/Dockerfile.full`, regenerate STATUS.md
   (`python3 scripts/build_status.py --release data-vN`), commit, and push only after the assets are verified, so the default
   never points at a release without its files.

## 7. Next steps, in order

1. Finish Winter 1995 (558 pages) and Winter 1996 (273 pages) with the same readers and gates.
2. Second-read the Winter 1996 GPT-6-Sol pages (PDF p753–1644) with Gemini to catch its one-character slips; re-read PDF p1–752,
   which Azure read at reduced resolution (no ZIP, many blank states). Rows carry flags, so the better read can replace them cleanly.
3. Adjudicate the 39,305 kept disagreements (`banking/kept_disagreements.csv` in the release asset).
4. Then the next-largest gaps in STATUS.md — Edition 1997, Winter 1992, 1991, 1993, 1990, 1989 — after re-downloading their scans.
5. Fix the 23 Spring 1935 Hawaii/Guam calls printed `K6` but stored as `W6`.

## 8. Lessons that cost time

- Benchmark against an adjudicated truth, not one reference transcription — the original Spring 1935 test set was itself wrong in
  37 of 481 rows, which capped every good reader at the same score.
- Don't trust an agent's report of which model it ran; read the session log.
- Agentic OCR runs reuse earlier outputs if they can see them — keep runs vision-only and audited.
- Keep working files out of `/tmp`; it gets wiped.
- Old OCR can be much worse than it looks: compare against an independent source (the FCC record) before deciding which side to keep.
