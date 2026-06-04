/**
 * US person-name fuzzy-match utilities built from FCC ULS EN.dat.
 *
 * Dictionary stats (as of build from 1,685,689 ULS records):
 *   first_names: 4,585 entries (>= 10 occurrences in ULS)
 *   last_names:  19,805 entries (>= 10 occurrences in ULS)
 *   state_last:  per-state surname lists (>= 3 occurrences per state, 60 states/territories)
 *
 * Fuzzy thresholds (per token):
 *   exact match: always
 *   1-edit:      length >= 4, first AND last char of input must match candidate
 *   2-edit:      length >= 6
 *   3-edit:      length >= 8
 *
 * isLikelyName additionally requires every token to start with an uppercase letter,
 * rejecting leading-char-dropped OCR noise (e.g. 'homas' from 'Thomas').
 */

import rawDict from './usNameDict.json';

type NameDict = {
  first_names: [string, number][];
  last_names: [string, number][];
  state_last: Record<string, string[]>;
};

const nameDict = rawDict as unknown as NameDict;

// Pre-extract sorted name arrays (already sorted by count desc in JSON).
const firstNames: string[] = nameDict.first_names.map(([n]) => n);
const lastNames: string[] = nameDict.last_names.map(([n]) => n);
const stateLast: Record<string, string[]> = nameDict.state_last;

// ---------------------------------------------------------------------------
// Edit-distance helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core fuzzy match against an array of candidate names
// ---------------------------------------------------------------------------

function fuzzyMatchAgainst(input: string, candidates: string[]): string | null {
  if (!input) return null;
  const lc = input.trim().toLowerCase();
  if (lc.length < 2) return null;

  // Exact match (case-insensitive)
  for (const name of candidates) {
    if (name.toLowerCase() === lc) return name;
  }

  // 1-edit: length >= 4.
  // Both the first AND last character of the input must match the candidate's
  // first/last character, preventing leading/trailing-drop false positives
  // (e.g. 'homas' must not fuzzy-match 'Thomas' or 'Hymas').
  if (lc.length >= 4) {
    for (const name of candidates) {
      const nlc = name.toLowerCase();
      if (nlc[0] === lc[0] && nlc[nlc.length - 1] === lc[lc.length - 1] && within1(lc, nlc)) {
        return name;
      }
    }
  }

  // 2-edit: length >= 6
  if (lc.length >= 6) {
    for (const name of candidates) {
      if (within2(lc, name.toLowerCase())) return name;
    }
  }

  // 3-edit: length >= 8
  if (lc.length >= 8) {
    for (const name of candidates) {
      if (within3(lc, name.toLowerCase())) return name;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fuzzy-match a first name against the ULS first-name dictionary.
 * Returns the canonical (title-cased) form or null if no match found.
 *
 * @example fuzzyMatchFirstName('Thmas') → 'Thomas'
 */
export function fuzzyMatchFirstName(name: string): string | null {
  return fuzzyMatchAgainst(name, firstNames);
}

/**
 * Fuzzy-match a last name against the ULS surname dictionary.
 * When `state` is provided, the state-scoped list is tried first (faster,
 * fewer false positives); falls back to the global list.
 *
 * @example fuzzyMatchLastName('Lambert') → 'Lambert'
 * @example fuzzyMatchLastName('Lamb8rt') → 'Lambert'
 */
export function fuzzyMatchLastName(name: string, state?: string | null): string | null {
  if (state) {
    const stUp = state.toUpperCase();
    const stCandidates = stateLast[stUp];
    if (stCandidates) {
      const stMatch = fuzzyMatchAgainst(name, stCandidates);
      if (stMatch) return stMatch;
    }
  }
  return fuzzyMatchAgainst(name, lastNames);
}

/**
 * Returns true if every whitespace-delimited token in `name`:
 *   1. Starts with an uppercase letter (rejects leading-char-dropped OCR noise), AND
 *   2. Fuzzy-matches a first or last name in the dictionary.
 *
 * Both conditions must hold for all tokens — a single unrecognized or
 * lowercase-starting token causes the whole string to be rejected.
 *
 * @example isLikelyName('Thomas Lambert') → true
 * @example isLikelyName('homas Lambert')  → false  ('homas' starts lowercase)
 */
export function isLikelyName(name: string): boolean {
  if (!name) return false;
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  for (const token of tokens) {
    // Reject tokens that do not start with an uppercase letter.
    // After cleanOCRName (title-case), a lowercase-starting token indicates
    // a leading-char drop or other OCR truncation, not a real name word.
    if (!token[0] || token[0] !== token[0].toUpperCase() || token[0] === token[0].toLowerCase()) {
      return false;
    }
    if (fuzzyMatchFirstName(token) === null && fuzzyMatchLastName(token) === null) {
      return false;
    }
  }
  return true;
}
