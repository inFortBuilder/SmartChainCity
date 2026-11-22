import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PAUSABLE, SEL, SIGNER_ROLE, encodeBatch, pauseBatch, rotateSignerBatches } from './safe-lote.mjs';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const addr = (i) => `0x${String(i).padStart(40, '0')}`;
const deployments = {
  chainId: 56,
  LandNFT: addr(1),
  PropertyNFT: addr(2),
  BuildingNFT: addr(3),
  LuckyBox: addr(4),
  GameVault: addr(5),
  Marketplace: addr(6),
  AvatarNFT: addr(7),
  Timelock: addr(8),
};

test('scheduleBatch igual ao cast calldata (fixture gerada com o Foundry)', () => {
  const role = (sel, who) => `0x${sel}${SIGNER_ROLE}${who.slice(2).toLowerCase().padStart(64, '0')}`;
  const got = encodeBatch(SEL.scheduleBatch, [A, B], [role(SEL.revokeRole, A), role(SEL.grantRole, B)], `0x${'0'.repeat(64)}`, `0x${'ab'.repeat(32)}`, 172800);
  assert.equal(got, '0x8f2a0bb000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000000abababababababababababababababababababababababababababababababab000000000000000000000000000000000000000000000000000000000002a3000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000111111111111111111111111111111111111111100000000000000000000000022222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000044d547741fe2f4eaae4a9751e85a3e4a7b9587827a877f29914755229b07a7b2da98285f7000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000442f2ff15de2f4eaae4a9751e85a3e4a7b9587827a877f29914755229b07a7b2da98285f70000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000');
});

test('pausar: pause() nos 6 contratos com pausa, sem o AvatarNFT', () => {
  const b = pauseBatch(deployments);
  assert.equal(b.chainId, '56');
  assert.deepEqual(b.transactions.map((t) => t.to), PAUSABLE.map((n) => deployments[n]));
  assert.ok(b.transactions.every((t) => t.data === '0x8456cb59' && t.value === '0'));
  assert.ok(!b.transactions.some((t) => t.to === deployments.AvatarNFT));
  assert.ok(pauseBatch(deployments, false).transactions.every((t) => t.data === '0x3f4ba83a'));
});

test('trocar o signer: agenda e executa a mesma operação no timelock', () => {
  const r = rotateSignerBatches(deployments, { antigo: A, novo: B, atraso: 172800, salt: `0x${'cd'.repeat(32)}` });
  const [s] = r.agendar.transactions;
  const [e] = r.executar.transactions;
  assert.equal(s.to, deployments.Timelock);
  assert.ok(s.data.startsWith('0x8f2a0bb0') && e.data.startsWith('0xe38335e5'));
  // Mesmos alvos e dados: o execute é o schedule sem o atraso no fim do cabeçalho.
  assert.equal(s.data.length, e.data.length + 64);
  assert.throws(() => rotateSignerBatches(deployments, { antigo: A, novo: A }), /igual/);
  assert.throws(() => rotateSignerBatches(deployments, { antigo: A, novo: 'x' }), /endereços/);
  assert.throws(() => pauseBatch({ chainId: 56 }), /sem o endereço de LandNFT/);
});
