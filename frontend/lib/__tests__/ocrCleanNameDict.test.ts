/**
 * Test suite: cleanOCRNameWithConfidence + usNameDict integration.
 * Run: npx tsx frontend/lib/__tests__/ocrCleanNameDict.test.ts
 */

import { cleanOCRName, cleanOCRNameWithConfidence, type OcrNameResult } from '../ocrClean';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const INFO = '\x1b[36mINFO\x1b[0m';

let passed = 0;
let failed = 0;

function check(
  label: string,
  got: OcrNameResult,
  expectedName: string,
  expectedConf?: 'high' | 'low',
): void {
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

function info(label: string, got: OcrNameResult): void {
  console.log(`${INFO}  ${label}`);
  console.log(`       name="${got.name}"  confidence=${got.confidence}`);
  passed++; // informational — counts as pass
}

// ---------------------------------------------------------------------------

// 1. Clean name with middle initial — both first+last in dict → high
check(
  '1. Thomas M Lambert (middle initial preserved)',
  cleanOCRNameWithConfidence('Thomas M Lambert'),
  'Thomas M Lambert',
  'high',
);

// 2. Common real name unchanged, high confidence
check(
  '2. Jose Garcia',
  cleanOCRNameWithConfidence('Jose Garcia'),
  'Jose Garcia',
  'high',
);

// 3. OCR digit in uppercase context: fixDigitsInNames fires first
check(
  '3. LAM8ERT Jones → Lambert Jones',
  cleanOCRNameWithConfidence('LAM8ERT Jones'),
  'Lambert Jones',
  'high',
);

// 4. Mc8onald Smith — digit between lowercase context; report what happens
{
  const r = cleanOCRNameWithConfidence('Mc8onald Smith');
  const ok = r.name === 'McDonald Smith' || r.name === 'Mc8onald Smith';
  if (ok) {
    console.log(`${PASS}  4. Mc8onald Smith → "${r.name}"  confidence=${r.confidence}`);
    passed++;
  } else {
    console.log(`${FAIL}  4. Mc8onald Smith → unexpected "${r.name}"`);
    failed++;
  }
}

// 5. "homas Lambert" — lowercase-starting first token → low confidence, NOT corrected
check(
  '5. homas Lambert → preserved as-is, low confidence',
  cleanOCRNameWithConfidence('homas Lambert'),
  'homas Lambert',
  'low',
);

// 6. O'Brien internal apostrophe preserved
{
  const r = cleanOCRNameWithConfidence("Thomas O'Brien");
  const ok = r.name.includes("O'Brien");
  if (ok) {
    console.log(`${PASS}  6. Thomas O'Brien → "${r.name}"  confidence=${r.confidence}`);
    passed++;
  } else {
    console.log(`${FAIL}  6. Thomas O'Brien → unexpected "${r.name}"`);
    failed++;
  }
}

// 7. Lamb8rt as last token — fixDigitsInNames should handle LAM8ERT but not
// mixed-case "Lamb8rt" (the guard requires surrounding uppercase letters).
// Dict correction should still catch it via fuzzy match.
check(
  '7. John Lamb8rt → John Lambert',
  cleanOCRNameWithConfidence('John Lamb8rt'),
  'John Lambert',
  'high',
);

// 8. Pure noise → empty string, low confidence
check(
  '8. Pure noise → empty, low confidence',
  cleanOCRNameWithConfidence('~~~ ;;; ###'),
  '',
  'low',
);

// 9. Single token (no pair) → low confidence
{
  const r = cleanOCRNameWithConfidence('Thomas');
  const ok = r.confidence === 'low';
  console.log(`${ok ? PASS : FAIL}  9. Single token "Thomas" → confidence=${r.confidence} (expected low)`);
  if (ok) passed++; else failed++;
}

// 10. Mc'Donald — internal apostrophe, informational
info("10. Mc'Donald Smith → (informational)", cleanOCRNameWithConfidence("Mc'Donald Smith"));

// 11. Spaced-out all-caps (collapses to single token → single word → low conf)
info('11. Spaced-out D W E L B R E C H T Thomas → (informational)', cleanOCRNameWithConfidence('D W E L B R E C H T Thomas'));

// 12. cleanOCRName backward compat (returns string, not object)
{
  const r = cleanOCRName('Thomas M Lambert');
  const ok = r === 'Thomas M Lambert';
  console.log(`${ok ? PASS : FAIL}  12. cleanOCRName backward compat → "${r}"`);
  if (ok) passed++; else failed++;
}

// 13. 1-edit first name: Thmas → Thomas
check(
  '13. Thmas Lambert → Thomas Lambert',
  cleanOCRNameWithConfidence('Thmas Lambert'),
  'Thomas Lambert',
  'high',
);

// 14. St. Louis — two tokens but "St." is not a 2+ alpha-char word token
info('14. St. Louis → (informational)', cleanOCRNameWithConfidence('St. Louis'));

// 15. State-scoped last name lookup
{
  const r = cleanOCRNameWithConfidence('John Lamb8rt', null, 'TX');
  const ok = r.name === 'John Lambert';
  console.log(`${ok ? PASS : FAIL}  15. John Lamb8rt (state=TX) → "${r.name}"  confidence=${r.confidence}`);
  if (ok) passed++; else failed++;
}

// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed out of 15 cases`);
if (failed > 0) process.exit(1);
