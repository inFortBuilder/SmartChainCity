// Confere a cobertura de linhas dos contratos da auditoria no resumo do `forge coverage --report summary`.
//   node scripts/coverage-gate.mjs coverage.txt 95 src/GameVault.sol src/Marketplace.sol
import { readFileSync } from 'node:fs';

const [file, min, ...contracts] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
let failed = false;
for (const c of contracts) {
  const row = text.split('\n').find((l) => l.includes(`| ${c} `));
  const pct = row ? Number(/\|\s*([\d.]+)%/.exec(row.slice(row.indexOf(c) + c.length))?.[1]) : NaN;
  const ok = pct >= Number(min);
  if (!ok) failed = true;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${c}: ${Number.isNaN(pct) ? 'sem linha no resumo' : `${pct}% das linhas`} (mínimo ${min}%)`);
}
process.exit(failed ? 1 : 0);
