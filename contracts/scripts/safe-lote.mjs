// Lotes do Safe para a resposta a incidentes (E4.6, docs/incidentes). Gera o JSON do Transaction Builder
// do Safe (app "Transaction Builder" → "Load"), sem chave nenhuma: quem assina são os donos do Safe.
//
//   node scripts/safe-lote.mjs pausar        deployments/56.json > pausar.json      (Safe 2-de-3 da pausa)
//   node scripts/safe-lote.mjs despausar     deployments/56.json > despausar.json
//   node scripts/safe-lote.mjs trocar-signer deployments/56.json --antigo 0x… --novo 0x… [--atraso 172800] [--salt 0x…]
//     → { agendar, executar }: o Safe 3-de-5 propõe no timelock e, depois do atraso, executa.
//
// A pausa vale para todos os contratos com PAUSER_ROLE (o AvatarNFT não pausa: só a LuckyBox minta).
// Na troca do signer, os quatro contratos que conferem voucher perdem a chave antiga e ganham a nova numa
// operação só do timelock. Até ela executar, a pausa segura os vouchers da chave vazada.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PAUSABLE = ['LandNFT', 'PropertyNFT', 'BuildingNFT', 'LuckyBox', 'GameVault', 'Marketplace'];
export const SIGNED = ['LandNFT', 'PropertyNFT', 'BuildingNFT', 'GameVault'];

/** Seletores e o hash do papel (conferidos com `cast sig` e `cast keccak`, e no ensaio do anvil). */
export const SEL = {
  pause: '8456cb59',
  unpause: '3f4ba83a',
  grantRole: '2f2ff15d',
  revokeRole: 'd547741f',
  scheduleBatch: '8f2a0bb0',
  executeBatch: 'e38335e5',
};
export const SIGNER_ROLE = 'e2f4eaae4a9751e85a3e4a7b9587827a877f29914755229b07a7b2da98285f70';

const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (n) => BigInt(n).toString(16).padStart(64, '0');

/** Codificação ABI de um bytes dinâmico: tamanho + dados em blocos de 32 bytes. */
const bytes = (hex) => {
  const h = hex.replace(/^0x/, '');
  return uint(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
};

/** (address[] alvos, uint256[] valores, bytes[] dados, bytes32, bytes32[, uint256]) do TimelockController. */
export function encodeBatch(selector, targets, payloads, predecessor, salt, delay) {
  const head = delay === undefined ? 5 : 6;
  const addrs = uint(targets.length) + targets.map(word).join('');
  const values = uint(targets.length) + targets.map(() => uint(0)).join('');
  const encoded = payloads.map(bytes);
  let offset = payloads.length * 32;
  const offsets = encoded.map((e) => {
    const o = uint(offset);
    offset += e.length / 2;
    return o;
  });
  const datas = uint(payloads.length) + offsets.join('') + encoded.join('');
  const off1 = head * 32;
  const off2 = off1 + addrs.length / 2;
  const off3 = off2 + values.length / 2;
  const tail = delay === undefined ? '' : uint(delay);
  return `0x${selector}${uint(off1)}${uint(off2)}${uint(off3)}${word(predecessor)}${word(salt)}${tail}${addrs}${values}${datas}`;
}

const roleCall = (sel, account) => `0x${sel}${SIGNER_ROLE}${word(account)}`;

function need(d, names) {
  for (const n of names) if (!isAddress(d[n])) throw new Error(`deployments sem o endereço de ${n}`);
}

/** O JSON que o Transaction Builder do Safe carrega. */
export function txBuilder(chainId, name, description, transactions) {
  return {
    version: '1.0',
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: { name, description, txBuilderVersion: '1.16.5' },
    transactions: transactions.map((t) => ({ to: t.to, value: '0', data: t.data, contractMethod: null, contractInputsValues: null })),
  };
}

export function pauseBatch(d, pause = true) {
  need(d, PAUSABLE);
  const sel = pause ? SEL.pause : SEL.unpause;
  return txBuilder(
    d.chainId,
    pause ? 'Incidente: pausar tudo' : 'Incidente: despausar tudo',
    `${pause ? 'pause()' : 'unpause()'} em ${PAUSABLE.join(', ')}. Assina o Safe da pausa (2-de-3).`,
    PAUSABLE.map((n) => ({ to: d[n], data: `0x${sel}` })),
  );
}

export function rotateSignerBatches(d, { antigo, novo, atraso = 172_800, salt }) {
  need(d, [...SIGNED, 'Timelock']);
  if (!isAddress(antigo) || !isAddress(novo)) throw new Error('--antigo e --novo precisam ser endereços');
  if (antigo.toLowerCase() === novo.toLowerCase()) throw new Error('o signer novo é igual ao antigo');
  const targets = SIGNED.flatMap((n) => [d[n], d[n]]);
  const payloads = SIGNED.flatMap(() => [roleCall(SEL.revokeRole, antigo), roleCall(SEL.grantRole, novo)]);
  const s = salt ?? `0x${uint(BigInt(Date.now()))}`;
  const zero = `0x${'0'.repeat(64)}`;
  const what = `Troca o SIGNER_ROLE de ${antigo} para ${novo} em ${SIGNED.join(', ')}`;
  return {
    salt: s,
    agendar: txBuilder(d.chainId, 'Incidente: agendar troca do signer', `${what}. Agenda no timelock (atraso ${atraso} s).`, [
      { to: d.Timelock, data: encodeBatch(SEL.scheduleBatch, targets, payloads, zero, s, atraso) },
    ]),
    executar: txBuilder(d.chainId, 'Incidente: executar troca do signer', `${what}. Executa depois do atraso.`, [
      { to: d.Timelock, data: encodeBatch(SEL.executeBatch, targets, payloads, zero, s) },
    ]),
  };
}

function main(argv) {
  const [cmd, file, ...rest] = argv;
  const opt = (k) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!cmd || !file) throw new Error('uso: safe-lote.mjs <pausar|despausar|trocar-signer> deployments/<chainId>.json [opções]');
  const d = JSON.parse(readFileSync(file, 'utf8'));
  if (cmd === 'pausar' || cmd === 'despausar') return pauseBatch(d, cmd === 'pausar');
  if (cmd === 'trocar-signer') {
    return rotateSignerBatches(d, { antigo: opt('antigo'), novo: opt('novo'), atraso: Number(opt('atraso') ?? 172_800), salt: opt('salt') });
  }
  throw new Error(`comando desconhecido: ${cmd}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
