/**
 * OCR cleaning utilities for FCC callbook archive text.
 *
 * All functions are pure (except fuzzyMatchCity which reads a static dict)
 * so they can be imported by both server and client components without any
 * bundler special-casing.  Each function is safe to call with null/undefined
 * — it always returns a string (possibly empty).
 */

import { fuzzyMatchCity } from './usCityDict';

// ---------------------------------------------------------------------------
// US state/territory code set used by cleanOCRState and cleanOCRCity.
// ---------------------------------------------------------------------------

// Old-style abbreviation → modern 2-char code map (used in cleanOCRState).
const OLD_STATE_ABBR: Record<string, string> = {
  ALA: "AL", ARIZ: "AZ", ARK: "AR", CALIF: "CA", COLO: "CO",
  CONN: "CT", DEL: "DE", FLA: "FL", ILL: "IL", IND: "IN",
  KANS: "KS", KAN: "KS", MASS: "MA", MICH: "MI", MINN: "MN",
  MISS: "MS", MONT: "MT", NEBR: "NE", NEB: "NE", NEV: "NV",
  OHIO: "OH", OKLA: "OK", ORE: "OR", PENN: "PA", TENN: "TN",
  TEX: "TX", UTAH: "UT", WASH: "WA", WIS: "WI", WYO: "WY",
  WISC: "WI", MINN2: "MN",
};

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU", "AS", "MP",
]);

// ---------------------------------------------------------------------------
// New helpers
// ---------------------------------------------------------------------------

/**
 * Replace bullet characters (U+2022 •, U+00B7 ·) with a period.
 * Then collapse sequences of two or more periods (not preceded/followed by a
 * word char — so "W." is preserved) into a single period.
 */
export function normalizeBullets(s: string): string {
  // Replace • and · with period.
  s = s.replace(/•/g, ".");
  s = s.replace(/·/g, ".");
  return s;
}

/**
 * For each whitespace-delimited word, strip known OCR prefix artifacts:
 *   ~  tilde(s) at the start         ~Ianhattan → Ianhattan
 *   l\ or l/ OCR mis-read of I       l\Foo → Foo, l/Bar → Bar
 *   ^I artifact                      ^IFoo → Foo
 */
export function stripCorruptedPrefix(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      w = w.replace(/^~+/, "");
      w = w.replace(/^l[\\\/]/, "");
      w = w.replace(/^\^I/, "");
      return w;
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Collapse runs of 2+ special characters that are NOT flanked by word
 * characters (so abbreviation dots like "W." and initials "M." are preserved)
 * into a single space.  Handles: . ~ : ; ' " ! + $ # ^ \ / -
 *
 * After collapsing, multiple spaces are compressed to one.
 */
export function collapseRunsOfSpecials(s: string): string {
  // Collapse 2+ consecutive specials not flanked by word chars on both sides.
  // Use a pattern that matches two-or-more-in-a-row of the special set when
  // NOT preceded by a word char AND NOT followed by a word char (to preserve
  // things like "W." or "St.").
  // We do a simple greedy approach: collapse when there is no word char
  // immediately before AND immediately after the run.
  s = s.replace(/(?<![A-Za-z0-9])[.~:;'"!+$#^\\\/-]{2,}(?![A-Za-z0-9])/g, " ");
  // Also collapse runs even when mixed: e.g. "~~" at start/end
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

// ---------------------------------------------------------------------------
// Name-specific sub-helpers
// ---------------------------------------------------------------------------

/**
 * Fix cases like "ThomasM Lambert" → "Thomas M Lambert" or
 * "ThomasMLambert" → "Thomas M Lambert":
 * a single uppercase letter immediately follows a multi-letter word (ending in
 * a lowercase letter) with no space, or a single uppercase letter is glued to
 * the start of the following capitalised word (e.g. "MLambert" → "M Lambert").
 */
export function fixSpacedLetterMerge(s: string): string {
  // Case A: "ThomasM Lambert" / "ThomasMLambert" — uppercase letter glued to end of a
  // lowercase-terminated word. Fire when the UC is followed by: space, end, or another
  // UC+lowercase (start of a CamelCase word like "Lambert").
  s = s.replace(/([a-z])([A-Z])(?=[A-Z][a-z]|\s|$)/g, "$1 $2");

  // Case B: "MLambert" — single uppercase letter immediately before a word starting
  // uppercase then 2+ lowercase (= a CamelCase surname/word).
  // Pattern: (space or start)(single uppercase)(uppercase + 2+ lc letters)
  s = s.replace(/(^|\s)([A-Z])([A-Z][a-z]{2,})/g, "$1$2 $3");

  return s;
}

/**
 * In a name context, apply OCR digit-for-letter substitutions ONLY when a
 * digit is surrounded by uppercase letters (LAM8ERT → LAMBERT, etc.).
 * Pairs: 8→B, 7→T, 0→O, 1→I, 5→S, 6→G, 3→E.
 * Guarded: only fires when both the preceding and following characters in the
 * token are uppercase alpha, so it does not corrupt address numbers.
 */
export function fixDigitsInNames(s: string): string {
  // Work token-by-token so we don't mangle address numbers.
  return s
    .split(/\s+/)
    .map((tok) => {
      // Only apply if the token looks like a name word (contains at least one
      // uppercase letter and no digit-only runs of 2+).
      if (!/[A-Z]/.test(tok)) return tok;
      if (/\d{2,}/.test(tok)) return tok; // probably a real number, leave alone
      return tok
        .replace(/(?<=[A-Z])[8](?=[A-Z])/g, "B")
        .replace(/(?<=[A-Z])[7](?=[A-Z])/g, "T")
        .replace(/(?<=[A-Z])[0](?=[A-Z])/g, "O")
        .replace(/(?<=[A-Z])[1](?=[A-Z])/g, "I")
        .replace(/(?<=[A-Z])[5](?=[A-Z])/g, "S")
        .replace(/(?<=[A-Z])[6](?=[A-Z])/g, "G")
        .replace(/(?<=[A-Z])[3](?=[A-Z])/g, "E");
    })
    .join(" ");
}

/**
 * Remove infix tildes (and other lone corruption chars) between alpha chars.
 * "Cr~pen" → "Crpen",  "Mor~land" → "Morland".
 * Called in both cleanOCRName and cleanOCRCity.
 */
export function removeInfixTildes(s: string): string {
  return s.replace(/([A-Za-z])[~]+([A-Za-z])/g, "$1$2");
}

// ---------------------------------------------------------------------------
// 1. cleanOCRName
// ---------------------------------------------------------------------------

/**
 * Clean an operator or club name string, collapsing OCR noise and spaced-out letters.
 */
export function cleanOCRName(
  name: string | null | undefined,
  _year?: number | null,
): string {
  if (!name) return "";

  // 1. Normalize bullet chars to periods (before any other transform).
  let s = normalizeBullets(name);

  // 2. Collapse multiple whitespace to single space.
  s = s.replace(/\s+/g, " ");

  // 3. Strip leading noise characters (expanded set: — $ #).
  s = s.replace(/^['"\.\~&;:,\s$#—\-]+/, "");

  // 4. Strip trailing noise characters (expanded set: : — # $).
  s = s.replace(/['"\.\~&;:,\s$#:—]+$/, "");

  // 5. Collapse runs of 2+ specials that are not abbreviation dots.
  s = collapseRunsOfSpecials(s);

  // 6. Strip per-word OCR prefix artifacts (~, l\, l/, ^I).
  s = stripCorruptedPrefix(s);

  // 6a-new. Remove infix tildes between alpha characters (Cr~pen → Crpen).
  s = removeInfixTildes(s);

  // 6b. Replace OCR-substituted ! with R when ! is at a word-start position
  //     followed by a lowercase letter (e.g. "!ladio" → "Radio", "!lub" → "Rlub"
  //     — false-positive risk is low because real text rarely starts a word
  //     with "!" + lowercase).
  s = s.replace(/(^|\s)!([a-z])/g, "$1R$2");

  // 6c. Strip word-trailing apostrophe when not followed by a letter
  //     (e.g. "Kansa' State" → "Kansa State"). This catches OCR-dropped
  //     final 's' rendered as a stray apostrophe. Does NOT touch internal
  //     apostrophes like "O'Brien" because the regex requires the apostrophe
  //     to be at a word boundary followed by whitespace or end-of-string.
  s = s.replace(/([A-Za-z])'(\s|$)/g, "$1$2");

  // 6d. Drop standalone-punctuation tokens (1-3 special chars surrounded by
  //     whitespace) — e.g. "Kansas - ' - - Willard" → "Kansas Willard".
  //     Each isolated punctuation token is OCR noise; real names don't
  //     contain solo "-" or "'" between words.
  s = s
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^[-'"\.~&;:!,]{1,3}$/.test(t))
    .join(" ");

  // 7. Collapse spaced-out single letters when 2+ appear in a row.
  //    E.g. "D W E L B R E C H T" → "DWELBRECHT"
  //    (lowered threshold from 3 to 2 as per spec)
  s = s.replace(/\b(?:[A-Za-z]\s){2,}[A-Za-z]\b/g, (match) =>
    match.replace(/\s/g, ""),
  );

  // 7a-new. Fix merged lc→UC collisions: "ThomasM Lambert" → "Thomas M Lambert",
  //         "MLambert" → "M Lambert".
  s = fixSpacedLetterMerge(s);

  // 7b-new. Fix OCR digit-for-letter inside uppercase name tokens (LAM8ERT → LAMBERT).
  s = fixDigitsInNames(s);

  // 8. Strip standalone noise tokens mid-string (space-noise-space → space).
  s = s.replace(/\s[\.~&;:]+\s/g, " ");

  // 9. Digit-letter substitution in predominantly-alpha words:
  //    '8' followed by lowercase alpha at word boundary → 'S'  (8t → St)
  s = s.replace(/\b8([a-z])/gi, "S$1");
  //    Trailing '1' after alpha word char → 'l'  (Banbur1 → Banburl)
  s = s.replace(/([A-Za-z])1\b/g, "$1l");

  // 10. Exclamation as 'h' when preceded by 'l' (OCR 'h' → 'l!'), then as 'l' elsewhere.
  //     "Jol!n" → original was "John" where 'h' was mis-read as 'l!'.
  //     So 'l!' between word chars → 'h'.
  s = s.replace(/([A-Za-z])l!([A-Za-z])/g, "$1h$2");
  // Remaining bare ! between word chars → 'l'.
  s = s.replace(/([A-Za-z])!([A-Za-z])/g, "$1l$2");

  // 11. Re-join mid-word space break: single-letter followed by rest-of-word
  //     when next token is >=3 lowercase chars (e.g. "G ranville" → "Granville").
  s = s.replace(/\b([A-Za-z]) ([a-z]{3,})\b/g, "$1$2");
  // Also re-join trailing single letter onto preceding word fragment
  //   e.g. "WYea t" → "WYeat"  (single trailing char that is lowercase).
  s = s.replace(/\b([A-Za-z]{2,}) ([a-z])\b/g, "$1$2");

  // 12. Collapse whitespace and trim.
  s = s.replace(/\s+/g, " ").trim();

  // 12b. Blank if no token qualifies as a real word.
  //      A real word token must have >=3 consecutive alpha chars AND must NOT
  //      have embedded noise characters (tilde, digit, semicolon, etc.) between
  //      alpha chars.  This catches strings like "Sir~rnar~r; 2o~9" where every
  //      token is OCR garbage even though substrings match alpha runs.
  {
    const hasRealWord = s.split(/\s+/).some((tok) => {
      // Reject tokens with noise chars embedded between two alpha chars.
      if (/[A-Za-z][~;:!+#$@^%&*0-9][A-Za-z]/.test(tok)) return false;
      return /[A-Za-z]{3,}/.test(tok);
    });
    if (!hasRealWord) return "";
  }

  return s;
}

// ---------------------------------------------------------------------------
// 2. cleanOCRCity
// ---------------------------------------------------------------------------

/**
 * Clean a city field that may contain bleed of address, ZIP, or state tokens.
 */
export function cleanOCRCity(
  city: string | null | undefined,
  state?: string | null,
): string {
  if (!city) return "";

  let s = normalizeBullets(city).trim();
  if (!s) return "";

  // Strip leading callsign bleed: token of 3–6 uppercase alphanum chars ending
  // in an uppercase letter followed by a space  (e.g. "W1TDOA Alfred…").
  s = s.replace(/^[A-Z0-9]{3,6}[A-Z]\s+/g, "");

  // Period-bleed: if the field has 3+ period-separated segments (typical of
  // address bleed like "Manhattan. Kans. WOOOR-C. A. Hnffman. 212 W. A"),
  // try the first segment as the city — if it fuzzy-matches a known US city,
  // return that match. This catches the worst multi-line address bleeds where
  // the parser packed an entire mailing address into the city column.
  if (s.split(".").length >= 3) {
    const first = s.split(".")[0].trim();
    if (first.length >= 3 && /[A-Za-z]/.test(first)) {
      const match = fuzzyMatchCity(first, state);
      if (match) return match;
    }
  }

  // Address-bleed without a comma: if the string starts with digits (house number)
  // or contains a street-type keyword, extract the last space-separated token as
  // the likely city (e.g. "513 N. Painter St. Whittier" → "Whittier").
  // Only apply when there are 3+ tokens and the last token is >=4 chars of alpha.
  if (!s.includes(",")) {
    const tokens = s.trim().split(/\s+/);
    const lastToken = tokens[tokens.length - 1] ?? "";
    if (
      tokens.length >= 3 &&
      /^[A-Za-z]{4,}$/.test(lastToken) &&
      (/^\d/.test(tokens[0] ?? "") ||
        /\b(St|Ave|Blvd|Dr|Rd|Ln|Ct|Pl|Way|Ter|Cir|Hwy|Rte|Rte|Blk|POB|PO|Box)\b\.?/i.test(s))
    ) {
      s = lastToken;
    }
  }

  // If there's a comma, isolate the most likely city token.
  if (s.includes(",")) {
    const lastCommaIdx = s.lastIndexOf(",");
    const afterLast = s.slice(lastCommaIdx + 1).trim();
    const beforeLast = s.slice(0, lastCommaIdx).trim();

    // Only fall back to beforeLast when afterLast has no alphabetic chars at all
    // (i.e. it's a bare ZIP or code). When it contains a city name plus trailing
    // ZIP/state noise (e.g. "Sparta 54656 WI"), keep afterLast and let the
    // strip loop below clean up the trailing tokens.
    if (!/[A-Za-z]/.test(afterLast)) {
      s = beforeLast;
    } else {
      s = afterLast;
    }
  }

  // Iteratively strip trailing noise tokens. Three passes handle interleaved
  // ZIP + state in either order.
  for (let i = 0; i < 3; i++) {
    // Trailing compass direction token.
    s = s.replace(/\s+(N|S|E|W|NE|NW|SE|SW)$/g, "");
    // Trailing 5-6 char OCR ZIP-like pattern (digits + common OCR substitution chars).
    s = s.replace(/(^|\s+)[0-9bBlBoO&sS]{5,6}\s*$/g, "");
    // Trailing 2-char state abbreviation.
    s = s.replace(/\s+[A-Z]{2}\s*$/g, "");
    // Trailing 3-4 char old-style state abbreviations (e.g. ARIZ, CALIF, CONN, MASS, MICH).
    s = s.replace(/\s+(ARIZ|CALIF|COLO|CONN|DEL|FLA|ILL|IND|KANS|MASS|MICH|MINN|MISS|MONT|NEBR|NEV|NEB|OHIO|OKLA|ORE|PENN|TENN|TEX|UTAH|WASH|WIS|WYO|ARK|ALA)\s*$/gi, "");
  }

  // Blank if result is a bare 2-char US state code.
  const trimUp = s.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(trimUp) && US_STATE_CODES.has(trimUp)) {
    return "";
  }

  // Collapse specials, strip corrupted prefixes, remove infix tildes.
  s = collapseRunsOfSpecials(s);
  s = stripCorruptedPrefix(s);
  s = removeInfixTildes(s);

  // Replace OCR-substituted ! with R at word-start (e.g. "!adio" → "Radio").
  s = s.replace(/(^|\s)!([a-z])/g, "$1R$2");

  // Collapse whitespace and trim.
  s = s.replace(/\s+/g, " ").trim();

  // If the result has no alphabetic characters it's pure noise/numbers — return ''.
  if (!s || !/[A-Za-z]/.test(s)) return "";

  // Fuzzy-match against city dictionary. Prefer state-scoped match (faster + more precise);
  // fall back to global match (all states) so cleanup still works at call sites that
  // don't have a state context (e.g. the per-row history table when row.state is null).
  const match = fuzzyMatchCity(s, state);
  if (match) return match;

  return s;
}

// ---------------------------------------------------------------------------
// 3. cleanOCRState
// ---------------------------------------------------------------------------

/**
 * Recover a 2-char US state code from the explicit state field or by parsing the city field.
 */
export function cleanOCRState(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  // Prefer an explicit state field if it's already a valid 2-char code.
  if (state) {
    const norm = state.trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (norm.length === 2 && US_STATE_CODES.has(norm)) return norm;
    // Map old-style 3-4 char abbreviations (WISC, CALIF, MASS, MICH, etc.)
    if (norm.length >= 3 && norm.length <= 5 && OLD_STATE_ABBR[norm]) {
      return OLD_STATE_ABBR[norm];
    }
  }

  if (!city) return "";

  // Walk every space-separated token from right to left looking for a state code.
  const tokens = city.trim().split(/\s+/);

  // Prefer the trailing token.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (!token) continue;
    const tok = token.toUpperCase().replace(/[^A-Z]/g, "");
    if (tok.length === 2 && US_STATE_CODES.has(tok)) return tok;
    // Also match old-style 3-5 char abbreviations in city/state text.
    if (tok.length >= 3 && tok.length <= 5 && OLD_STATE_ABBR[tok]) {
      return OLD_STATE_ABBR[tok];
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// 4. classLabelForCode
// ---------------------------------------------------------------------------

/**
 * Return a human-readable license class label from a single-letter FCC code, era-aware.
 */
export function classLabelForCode(
  code: string | null | undefined,
  year?: number | null,
  isClub: boolean = false,
): string {
  if (isClub) return "Club";
  if (!code) return "—";
  const c = code.trim().toUpperCase();
  if (c === "E") return "Extra";
  if (c === "A") return "Advanced";
  if (c === "G") return "General";
  if (c === "T") return "Technician";
  if (c === "N") return "Novice";
  if (c === "P") return "—";
  if (c === "B") {
    if (year && year >= 1952) return "Club";
    return "General";
  }
  if (c === "C") {
    if (year && year > 1967) return "—";
    return "Conditional";
  }
  return "—";
}
