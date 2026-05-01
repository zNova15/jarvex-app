// Runner: ejecuta los tests E2E en serie y reporta passed/failed.
//
// Uso:
//   export JX_TEST_EMAIL="grabieljesusjulcasalazar@gmail.com"
//   export JX_TEST_PASSWORD="********"
//   node tests/e2e/run-all.mjs
//
// Opcional:
//   HEADLESS=false node tests/e2e/run-all.mjs   (modo visible)
//   JX_TEST_URL=https://otra.url/ ...          (override URL)

import { run as smoke }     from './01-smoke.test.mjs';
import { run as nav }       from './02-navegacion.test.mjs';
import { run as busqueda }  from './03-busqueda.test.mjs';
import { run as alertas }   from './04-alertas.test.mjs';

const TESTS = [
  { name: '01-smoke',       fn: smoke },
  { name: '02-navegacion',  fn: nav },
  { name: '03-busqueda',    fn: busqueda },
  { name: '04-alertas',     fn: alertas },
];

const CHECK = '✓'; // ✓
const CROSS = '✗'; // ✗

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms/1000).toFixed(1)}s`;
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   JARVEX E2E TEST SUITE');
  console.log(`   URL:  ${process.env.JX_TEST_URL || 'https://jarvex-app.vercel.app/'}`);
  console.log(`   USER: ${process.env.JX_TEST_EMAIL || '(no JX_TEST_EMAIL)'}`);
  console.log(`   MODE: ${process.env.HEADLESS === 'false' ? 'headed' : 'headless'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = [];
  let passed = 0, failed = 0;

  for (const t of TESTS) {
    const t0 = Date.now();
    process.stdout.write(`▶  ${t.name} ... `);
    try {
      const r = await t.fn();
      const dt = Date.now() - t0;
      if (r?.ok) {
        passed++;
        console.log(`${CHECK} PASS  (${fmtMs(dt)})`);
        if (r.details) console.log(`     └─ ${JSON.stringify(r.details)}`);
        results.push({ name: t.name, ok: true, ms: dt, details: r.details });
      } else {
        failed++;
        console.log(`${CROSS} FAIL  (${fmtMs(dt)})`);
        results.push({ name: t.name, ok: false, ms: dt });
      }
    } catch (e) {
      const dt = Date.now() - t0;
      failed++;
      console.log(`${CROSS} FAIL  (${fmtMs(dt)})`);
      console.log(`     └─ ${e.message}`);
      results.push({ name: t.name, ok: false, ms: dt, error: e.message });
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   RESUMEN:  ${passed} passed · ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(failed === 0 ? 0 : 1);
})();
