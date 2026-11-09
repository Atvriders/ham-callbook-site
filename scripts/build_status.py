#!/usr/bin/env python3
"""build_status.py — regenerate STATUS.md and docs/completeness.csv from the archive database.

    python3 scripts/build_status.py [--db data/USA_Ham_Callbooks.sqlite] [--wip docs/wip.json] [--release data-vN]

Completeness model (unchanged since the 2026-09-11 completion study, so numbers stay comparable over time):
a full callbook edition set out to list every licensed US amateur, so the EXPECTED size of an edition is the
approximate US licensee population that year (LICENSEES below). Pre-1928 government station lists, Blue Books
and early call books are capped at 20,000. An edition is "complete" at >= 85 % of expected — editions OCR'd end
to end land at 96–104 %, so the baseline is good to roughly ±10 %. Overall completeness = entries / expected.

docs/wip.json carries what the database cannot know: which editions are being read, pages done and remaining,
readers, held pages and next steps. Edit it, re-run this script, commit both."""
import argparse, csv, datetime, json, os, sqlite3, collections

LICENSEES = {1909: 300, 1910: 600, 1911: 900, 1913: 2000, 1914: 2500, 1915: 3500, 1916: 4000, 1920: 6000, 1921: 11000,
             1922: 15000, 1923: 16000, 1924: 16500, 1925: 17000, 1926: 17500, 1927: 17000, 1928: 17000, 1929: 18000,
             1930: 19000, 1931: 22000, 1932: 30000, 1933: 38000, 1934: 42000, 1935: 46000, 1936: 48000, 1937: 52000,
             1938: 55000, 1939: 56000, 1940: 56000, 1941: 60000, 1946: 60000, 1947: 75000, 1948: 85000, 1949: 87000,
             1950: 87000, 1951: 90000, 1952: 96000, 1953: 105000, 1954: 112000, 1955: 135000, 1956: 140000,
             1957: 155000, 1958: 163000, 1959: 170000, 1960: 170000, 1961: 220000, 1962: 205000, 1963: 250000,
             1964: 250000, 1965: 255000, 1966: 260000, 1967: 265000, 1968: 270000, 1969: 275000, 1970: 285000,
             1971: 290000, 1972: 295000, 1973: 300000, 1974: 300000, 1975: 300000, 1976: 310000, 1977: 330000,
             1978: 350000, 1979: 380000, 1980: 400000, 1981: 410000, 1982: 420000, 1983: 430000, 1984: 440000,
             1985: 440000, 1986: 440000, 1987: 440000, 1988: 450000, 1989: 470000, 1990: 500000, 1991: 520000,
             1992: 540000, 1993: 560000, 1994: 600000, 1995: 640000, 1996: 670000, 1997: 680000, 1999: 680000,
             2003: 680000}
SMALL_LISTS = {'GovtStations', 'BlueBook', 'CallBook', 'Consolidated'}
COMPLETE_AT = 0.85
ERAS = [(1932, '1909–1931 · government lists & early books'), (1946, '1932–1945 · pre-war'), (1960, '1946–1959 · post-war'),
        (1970, '1960s'), (1980, '1970s'), (9999, '1980–2003 · modern')]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def era(year):
    return next(name for limit, name in ERAS if year < limit)


def bar(frac, width=20):
    filled = round(min(frac, 1.0) * width)
    return '█' * filled + '░' * (width - filled)


def pct(a, b):
    return 100.0 * a / b if b else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(ROOT, 'data', 'USA_Ham_Callbooks.sqlite'))
    ap.add_argument('--wip', default=os.path.join(ROOT, 'docs', 'wip.json'))
    ap.add_argument('--release', default=None, help='data release the numbers correspond to, e.g. data-v11')
    a = ap.parse_args()
    db = sqlite3.connect(f'file:{a.db}?mode=ro', uri=True)
    wip = json.load(open(a.wip)) if os.path.exists(a.wip) else {}
    in_progress = {(e['year'], e['label']): e for e in wip.get('editions', [])}

    counts = {(y, e): n for y, e, n in db.execute('SELECT year, edition, COUNT(*) FROM entries GROUP BY year, edition')}
    editions = db.execute('SELECT year, label FROM editions ORDER BY year, label').fetchall()
    fc = db.execute("SELECT COUNT(*), "
                    "SUM(CASE WHEN name IS NOT NULL AND TRIM(name) <> '' THEN 1 ELSE 0 END), "
                    "SUM(CASE WHEN city IS NOT NULL AND TRIM(city) <> '' THEN 1 ELSE 0 END), "
                    "SUM(CASE WHEN state IS NOT NULL AND LENGTH(TRIM(state)) = 2 THEN 1 ELSE 0 END) FROM entries").fetchone()
    distinct_calls = db.execute('SELECT COUNT(DISTINCT callsign) FROM entries').fetchone()[0]

    rows, eras = [], collections.OrderedDict((name, [0, 0, 0, 0]) for _, name in ERAS)
    status_count = collections.Counter()
    for year, label in editions:
        n = counts.get((year, label), 0)
        exp = LICENSEES.get(year, 0)
        if label in SMALL_LISTS:
            exp = min(exp, 20000)
        status = 'empty' if n == 0 else 'complete' if n >= COMPLETE_AT * exp else 'partial'
        shown = 'reading' if (year, label) in in_progress else status      # pages still unread -> never shown as complete
        status_count[shown] += 1
        e = eras[era(year)]
        e[0] += n; e[1] += exp; e[2] += (shown == 'complete'); e[3] += 1
        rows.append(dict(year=year, edition=label, entries=n, expected=exp, pct=round(pct(n, exp), 1), status=status,
                         in_progress='yes' if (year, label) in in_progress else '', shown=shown))
    total, expected = sum(r['entries'] for r in rows), sum(r['expected'] for r in rows)
    overall = pct(total, expected)
    today = datetime.date.today().isoformat()

    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    with open(os.path.join(ROOT, 'docs', 'completeness.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['year', 'edition', 'entries', 'expected', 'pct', 'status', 'in_progress'], extrasaction='ignore')
        w.writeheader(); w.writerows(rows)

    L = []
    rel = f' (data release `{a.release}`)' if a.release else ''
    L += [f'# Project status — how complete is the archive?', '',
          f'_Generated {today} by `scripts/build_status.py` from the database{rel}. '
          'Regenerate after any banking; edit `docs/wip.json` for in-progress work._', '',
          f'## {total:,} entries — **{overall:.1f} %** of a complete archive', '',
          f'`{bar(total / expected, 40)}` {overall:.1f} % of ~{expected / 1e6:.1f} M expected entries', '',
          f'| editions | count |', '|---|---:|',
          f'| ✅ complete (≥ {int(COMPLETE_AT * 100)} % of expected) | {status_count["complete"]} |',
          f'| 🔄 being read now — pages still unread | {status_count["reading"]} |',
          f'| 🟡 partial | {status_count["partial"]} |',
          f'| ⬜ empty — scans located, not yet transcribed | {status_count["empty"]} |',
          f'| **catalogued editions** | **{len(rows)}** |', '',
          f'Distinct callsigns: **{distinct_calls:,}** · per-field coverage: name **{pct(fc[1], fc[0]):.1f} %**, '
          f'city **{pct(fc[2], fc[0]):.1f} %**, state **{pct(fc[3], fc[0]):.1f} %** (populated and valid).', '']
    if wip:
        L += ['## In progress — where the work stopped', '', wip.get('summary', ''), '',
              '| edition | read so far | remaining (PDF pages) | reader | banked |', '|---|---|---|---|---|']
        for e in wip.get('editions', []):
            L.append(f"| {e['label']} {e['year']} | {e['read']} | {e['remaining']} | {e['reader']} | {e.get('banked', '')} |")
        L += ['']
        if wip.get('next_steps'):
            L += ['**Next steps, in order:**', ''] + [f'{i}. {s}' for i, s in enumerate(wip['next_steps'], 1)] + ['']
        L += ['How to pick the work back up — pipeline, readers, quality gates, banking: **[docs/RESUME.md](docs/RESUME.md)**.', '']
    L += ['## How completeness is measured', '',
          'A full callbook set out to list every licensed US amateur, so an edition\'s **expected** size is the approximate '
          'US licensee population that year. Pre-1928 government station lists, Blue Books and early call books are capped at '
          f'20,000. An edition counts as **complete** at ≥ {int(COMPLETE_AT * 100)} % of expected: editions transcribed end to end '
          'land at 96–104 %, so the baseline is good to roughly ±10 %, and the large gaps are real. The low modern editions are '
          'partly transcribed books, not small books — adjacent years would otherwise sit at the same ratio.', '',
          '## By era', '', '| era | entries | expected | complete | editions complete |', '|---|---:|---:|---:|---:|']
    for name, (n, exp, done, cnt) in eras.items():
        L.append(f'| {name} | {n:,} | {exp:,} | {pct(n, exp):.0f} % | {done} / {cnt} |')
    gaps = sorted((r for r in rows if r['shown'] in ('partial', 'empty')), key=lambda r: r['entries'] - r['expected'])[:12]
    L += ['', '## Largest gaps', '', '| edition | entries | expected | missing |', '|---|---:|---:|---:|']
    for r in gaps:
        L.append(f"| {r['edition']} {r['year']} | {r['entries']:,} | {r['expected']:,} | {r['expected'] - r['entries']:,} |")
    L += ['', '## Every edition', '',
          '✅ complete · 🔄 being read now (see *In progress*) · 🟡 partial · ⬜ empty. Machine-readable: '
          '[`docs/completeness.csv`](docs/completeness.csv).', '',
          '| year | edition | entries | expected | % | progress | |', '|---|---|---:|---:|---:|---|---|']
    icon = {'complete': '✅', 'partial': '🟡', 'empty': '⬜', 'reading': '🔄'}
    for r in rows:
        mark = icon[r['shown']]
        L.append(f"| {r['year']} | {r['edition']} | {r['entries']:,} | {r['expected']:,} | {r['pct']:.0f} % | "
                 f"`{bar(r['entries'] / r['expected'] if r['expected'] else 0)}` | {mark} |")
    L += ['']
    open(os.path.join(ROOT, 'STATUS.md'), 'w').write('\n'.join(L))
    print(f'STATUS.md + docs/completeness.csv: {total:,} entries = {overall:.2f} % of {expected:,}; '
          f'{dict(status_count)}; distinct calls {distinct_calls:,}')


if __name__ == '__main__':
    main()
