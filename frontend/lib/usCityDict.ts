import dict from './usCityDict.json';
export type CityDict = Record<string, [string, number][]>;
const cityDict = dict as unknown as CityDict;

// Build a per-state Set of lowercase city names for O(1) membership tests.
const lowerCities: Record<string, Set<string>> = {};
for (const st of Object.keys(cityDict)) {
  const entries = cityDict[st] ?? [];
  lowerCities[st] = new Set(entries.map(([c]) => c.toLowerCase()));
}
export function isKnownCity(city: string, state?: string | null): boolean {
  if (!city) return false;
  const lc = city.trim().toLowerCase();
  if (state) {
    const set = lowerCities[state.toUpperCase()];
    if (set) return set.has(lc);
  }
  // search any state
  for (const st of Object.keys(lowerCities)) {
    const set = lowerCities[st];
    if (set && set.has(lc)) return true;
  }
  return false;
}

// 1-edit-distance fuzzy fallback (Damerau-Levenshtein <=1, optimized).
function within1(a: string, b: string): boolean {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; }
    else if (la > lb) i++;
    else j++;
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

// 2-edit-distance fuzzy fallback via full DP, used for longer names (>=6 chars).
function levenshtein(a: string, b: string): number {
  const la = a.length, lb = b.length;
  const dp: number[] = Array(lb + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j] ?? 0;
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j] ?? 0, dp[j - 1] ?? 0);
      prev = tmp;
    }
  }
  return dp[lb] ?? 0;
}

function within2(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  return levenshtein(a, b) <= 2;
}

function within3(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 3) return false;
  return levenshtein(a, b) <= 3;
}

export function fuzzyMatchCity(city: string, state?: string | null): string | null {
  if (!city) return null;
  const lc = city.trim().toLowerCase();
  if (lc.length < 3) return null;
  const stUp = state ? state.toUpperCase() : null;
  const candidates = stUp && cityDict[stUp] ? cityDict[stUp] : Object.values(cityDict).flat();

  // exact (case-insensitive) first
  for (const [name] of candidates) {
    if (name.toLowerCase() === lc) return name;
  }

  // 1-edit fuzzy: require length >= 5
  if (lc.length >= 5) {
    for (const [name] of candidates) {
      if (within1(lc, name.toLowerCase())) return name;
    }
  }

  // 2-edit fuzzy: require length >= 6
  if (lc.length >= 6) {
    for (const [name] of candidates) {
      if (within2(lc, name.toLowerCase())) return name;
    }
  }

  // 3-edit fuzzy: require length >= 8 (heavy OCR noise like 'Hntchirison' → 'Hutchinson')
  if (lc.length >= 8) {
    for (const [name] of candidates) {
      if (within3(lc, name.toLowerCase())) return name;
    }
  }

  return null;
}
