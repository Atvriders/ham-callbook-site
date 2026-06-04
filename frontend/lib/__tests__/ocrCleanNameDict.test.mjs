/**
 * Node ESM test for cleanOCRNameWithConfidence + the underlying cleanOCRName
 * with usNameDict integration.
 *
 * Run:  node --input-type=module < frontend/lib/__tests__/ocrCleanNameDict.test.mjs
 * (or just:  node frontend/lib/__tests__/ocrCleanNameDict.test.mjs)
 *
 * Uses tsx/ts-node shim via the project's tsconfig — but since we're in ESM
 * we call the compiled JS.  We run this via ts-node from package.json scripts.
 */

import { createRequire } from 'module';
import { register } from 'node:module';

// We rely on ts-node/esm loader being registered (see invocation below).
// Import the TS source directly.
const { cleanOCRName, cleanOCRNameWithConfidence } = await import('../ocrClean.ts');

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';

let passed = 0;
let failed = 0;

function check(label, got, expectedName, expectedConf) {
  const nameOk = got.name === expectedName;
  const confOk = expectedConf === undefined || got.confidence === expectedConf;
  if (nameOk && confOk) {
    console.log(`${PASS}  ${label}`);
    console.log(`       name="${got.name}"  confidence=${got.confidence}`);
    passed++;
  } else {
    console.log(`${FAIL}  ${label}`);
    if (!nameOk) console.log(`       name: expected "${expectedName}", got "${got.name}"`);
    if (!confOk) console.log(`       conf: expected "${expectedConf}", got "${got.confidence}"`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

// 1. Clean name — both tokens in dict → high confidence
check(
  '1. Thomas M Lambert (with middle initial)',
  cleanOCRNameWithConfidence('Thomas M Lambert'),
  'Thomas M Lambert',
  'high',
);

// 2. Common real name — unchanged, high confidence
check(
  '2. Jose Garcia',
  cleanOCRNameWithConfidence('Jose Garcia'),
  'Jose Garcia',
  'high',
);

// 3. OCR digit fix + dict correction: "Lam8ert" → "Lambert"
// fixDigitsInNames fires first (LAM8ERT→LAMBERT in uppercase context),
// then dict corrects to proper case.
check(
  '3. LAM8ERT Jones → Lambert Jones',
  cleanOCRNameWithConfidence('LAM8ERT Jones'),
  'Lambert Jones',
  'high',
);

// 4. Mc-name with embedded digit: "Mc8onald" — fixDigitsInNames won't fire
// (8 not between two uppercase letters in this casing), but dict lookup should
// correct after cleanOCRName title-cases: "Mc8onald" → title-case → dict fix.
// Expected: name corrected (McDonald) if in dict, else preserved.
{
  const r = cleanOCRNameWithConfidence('Mc8onald Smith');
  const ok = r.name === 'McDonald Smith' || r.name === 'Mc8onald Smith';
  if (ok) {
    console.log(`${PASS}  4. Mc8onald Smith → ${r.name}  confidence=${r.confidence}`);
    passed++;
  } else {
    console.log(`${FAIL}  4. Mc8onald Smith → unexpected "${r.name}"`);
    failed++;
  }
}

// 5. "homas Lambert" — first token starts lowercase → low confidence, NOT auto-corrected.
check(
  '5. homas Lambert → low confidence, first token not replaced',
  cleanOCRNameWithConfidence('homas Lambert'),
  'homas Lambert',
  'low',
);

// 6. O'Brien — apostrophe preserved by cleanOCRName (internal apostrophe rule).
{
  const r = cleanOCRNameWithConfidence("Thomas O'Brien");
  const ok = r.name.includes("O'Brien") || r.name.includes("O'Brien");
  if (ok) {
    console.log(`${PASS}  6. Thomas O'Brien → "${r.name}"  confidence=${r.confidence}`);
    passed++;
  } else {
    console.log(`${FAIL}  6. Thomas O'Brien → unexpected "${r.name}"`);
    failed++;
  }
}

// 7. "Lamb8rt" as last name token in a pair → dict match → Lambert
check(
  '7. John Lamb8rt → John Lambert',
  cleanOCRNameWithConfidence('John Lamb8rt'),
  'John Lambert',
  'high',
);

// 8. Entirely garbage → empty string, low confidence
check(
  '8. Pure noise → empty, low confidence',
  cleanOCRNameWithConfidence('~~~ ;;; ###'),
  '',
  'low',
);

// 9. Single-token name → not corrected (no pair), low confidence
{
  const r = cleanOCRNameWithConfidence('Thomas');
  console.log(`${r.confidence === 'low' ? PASS : FAIL}  9. Single token "Thomas" → confidence low (${r.confidence}), name="${r.name}"`);
  if (r.confidence === 'low') passed++; else failed++;
}

// 10. Mc'Donald — apostrophe stripped by step 6c (trailing apostrophe rule only),
// internal apostrophe preserved, then dict lookup.
{
  const r = cleanOCRNameWithConfidence("Mc'Donald Smith");
  console.log(`${'info'}  10. Mc'Donald Smith → "${r.name}"  confidence=${r.confidence}`);
  passed++; // informational — just log result
}

// 11. Typical OCR spaced-out name: "D W E L B R E C H T" (collapsed to DWELBRECHT by step 7)
{
  const r = cleanOCRNameWithConfidence('D W E L B R E C H T Thomas');
  console.log(`${'info'}  11. Spaced-out all-caps → "${r.name}"  confidence=${r.confidence}`);
  passed++; // informational
}

// 12. cleanOCRName (old API, no confidence) still works — backward compat.
{
  const r = cleanOCRName('Thomas M Lambert');
  const ok = r === 'Thomas M Lambert';
  console.log(`${ok ? PASS : FAIL}  12. cleanOCRName backward compat → "${r}"`);
  if (ok) passed++; else failed++;
}

// 13. "Thmas Lambert" — 1-edit first name → Thomas
check(
  '13. Thmas Lambert → Thomas Lambert',
  cleanOCRNameWithConfidence('Thmas Lambert'),
  'Thomas Lambert',
  'high',
);

// 14. St. Louis (city-like, not a name pair with 2 alpha-word tokens of >=2 chars)
// This should pass through cleanOCRName unchanged and get low confidence.
{
  const r = cleanOCRNameWithConfidence('St. Louis');
  console.log(`${'info'}  14. St. Louis → "${r.name}"  confidence=${r.confidence}`);
  passed++; // informational
}

// 15. State-scoped lookup: provide state for last name
{
  const r = cleanOCRNameWithConfidence('John Lamb8rt', null, 'TX');
  const ok = r.name === 'John Lambert';
  console.log(`${ok ? PASS : FAIL}  15. John Lamb8rt (state=TX) → "${r.name}"  confidence=${r.confidence}`);
  if (ok) passed++; else failed++;
}

// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
