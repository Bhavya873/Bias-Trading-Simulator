/**
 * Static audit: every CSS class referenced in JS/HTML should exist in theme.css.
 * Catches typos that would silently render an unstyled element.
 * Run: node test/css-audit.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(ROOT, 'css', 'theme.css'), 'utf8');

const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(entry)) files.push(p);
  }
})(ROOT);

/**
 * Pull class names out of ${...} interpolations, e.g. cond ? 'is-you' : ''.
 * Only strings in a ternary result position count — strings on the left of a
 * comparison are values being tested, not class names.
 */
function classesFromInterpolation(expr) {
  const results = expr.replace(/[^?:]*?(===|!==|==|!=)\s*['"][^'"]*['"]/g, ' ');
  return [...results.matchAll(/[?:]\s*'([a-zA-Z][\w-]*)'|[?:]\s*"([a-zA-Z][\w-]*)"/g)].map(
    (m) => m[1] || m[2]
  );
}

const used = new Map();
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    const raw = m[1];
    const names = [];

    // Collect literal names with interpolations stripped out
    for (const cls of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (cls) names.push(cls);
    }
    // Then collect quoted names from inside the interpolations
    for (const interp of raw.matchAll(/\$\{([^}]*)\}/g)) {
      names.push(...classesFromInterpolation(interp[1]));
    }

    for (const cls of names) {
      if (!used.has(cls)) used.set(cls, path.relative(ROOT, file));
    }
  }
}

const missing = [...used].filter(([cls]) => !defined.has(cls));

console.log('\nCSS audit\n');
console.log(`  ${defined.size} classes defined in theme.css`);
console.log(`  ${used.size} distinct classes referenced in JS/HTML`);

if (missing.length) {
  console.log('\n  Referenced but NOT defined:');
  for (const [cls, file] of missing) console.log(`    .${cls}  (${file})`);
  console.log('');
  process.exit(1);
}

console.log('\n  All referenced classes are defined\n');
