/**
 * Verdict threshold unit tests.
 * The final slide must not overstate: at n=6 the default is "Inconclusive".
 * Run: node test/verdict.js
 */

'use strict';

const { verdict } = require('../lib/metrics');

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got "${got}", want "${want}"`}`);
  if (!ok) failed++;
}

console.log('\nVerdict thresholds\n');

const CONSISTENT = 'Directionally consistent';
const INCONSISTENT = 'Directionally inconsistent';
const INCONCLUSIVE = 'Inconclusive (n too small)';

// Mean moves with the benchmark AND >= 2/3 of players agree
check(
  'mean up + 6/6 players up',
  verdict(20, 12, [1, 1, 1, 1, 1, 1]),
  CONSISTENT
);
check(
  'mean up + 4/6 players up (exactly 2/3)',
  verdict(15, 12, [1, 1, 1, 1, -1, -1]),
  CONSISTENT
);

// Just under the two-thirds bar → must not claim a result
check(
  'mean up + 3/6 players up (below 2/3)',
  verdict(15, 12, [1, 1, 1, -1, -1, -1]),
  INCONCLUSIVE
);
check(
  'mean up but most players flat',
  verdict(10, 12, [1, 0, 0, 0, 0, 0]),
  INCONCLUSIVE
);

// Mean against the benchmark
check(
  'mean down against positive benchmark',
  verdict(-8, 12, [-1, -1, -1, -1, -1, -1]),
  INCONSISTENT
);
check(
  'mean down even with some players up',
  verdict(-3, 12, [1, 1, 1, -1, -1, -1]),
  INCONSISTENT
);

// Degenerate cases
check('flat mean is inconclusive', verdict(0, 12, [0, 0, 0, 0, 0, 0]), INCONCLUSIVE);
check('no players is inconclusive', verdict(10, 12, []), INCONCLUSIVE);

// Small-n bias: 2 of 3 is exactly 2/3, 1 of 3 is not
check('2/3 players agree', verdict(10, 12, [1, 1, -1]), CONSISTENT);
check('1/3 players agree', verdict(10, 12, [1, -1, 0]), INCONCLUSIVE);

console.log(`\n${failed ? failed + ' failed' : 'all verdict checks passed'}\n`);
process.exit(failed ? 1 : 0);
