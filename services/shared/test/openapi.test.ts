import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * O `openapi.yaml` de cada serviço bate com as rotas do código: toda rota tem a sua operação e toda
 * operação existe. Rota nova sem documentação (ou documentação de rota que saiu) quebra aqui.
 */
const SERVICES = join(import.meta.dirname, '..', '..');
const NAMES = ['gateway', 'economy', 'game-core', 'world', 'chain-indexer', 'realtime'];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : f.endsWith('.ts') ? [p] : [];
  });
}

/** Rotas do código, no formato do OpenAPI (`:id` → `{id}`). */
function codeRoutes(service: string): string[] {
  const re = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'|createEndpoint\(\s*'([^']+)',\s*\{\s*method:\s*'([A-Z]+)'/g;
  const out = new Set<string>();
  for (const f of tsFiles(join(SERVICES, service, 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(re)) {
      const method = (m[1] ?? m[4]!).toLowerCase();
      out.add(`${method} ${(m[2] ?? m[3]!).replace(/:(\w+)/g, '{$1}')}`);
    }
  }
  return [...out].sort();
}

/** Operações do `openapi.yaml` (caminhos com 2 espaços, métodos com 4). */
function specOperations(service: string): { ops: string[]; text: string } {
  const text = readFileSync(join(SERVICES, service, 'openapi.yaml'), 'utf8');
  const ops: string[] = [];
  let path: string | null = null;
  let inPaths = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) inPaths = true;
    else if (/^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const p = line.match(/^ {2}(\/\S*):\s*$/);
    if (p) path = p[1]!;
    const m = line.match(/^ {4}(\w+):/);
    if (m && path && METHODS.includes(m[1]!)) ops.push(`${m[1]} ${path}`);
  }
  return { ops: ops.sort(), text };
}

describe('openapi.yaml dos serviços', () => {
  for (const service of NAMES) {
    it(`${service}: as rotas do código e as do openapi.yaml são as mesmas`, () => {
      const { ops, text } = specOperations(service);
      expect(text).toMatch(/^openapi: 3\.1\.0/);
      expect(new Set(ops).size, 'operação repetida').toBe(ops.length);
      const code = codeRoutes(service);
      expect(code.length).toBeGreaterThan(0);
      expect({ sem_documentacao: code.filter((r) => !ops.includes(r)), sem_rota: ops.filter((o) => !code.includes(o)) }).toEqual({
        sem_documentacao: [],
        sem_rota: [],
      });
    });
  }
});
