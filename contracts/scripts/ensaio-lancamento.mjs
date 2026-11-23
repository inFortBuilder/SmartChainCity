// Ensaio do lançamento (docs/lancamento.md, fase 2): a sequência inteira do dia do TGE num anvil com chain id
// 97, conferida passo a passo. Sem chave nenhuma: o deployer é a conta 0 do anvil, e os Safes são endereços
// com código (anvil_setCode) movidos por impersonação.
//
//   cd contracts && node scripts/ensaio-lancamento.mjs
//
// 1. TGE (DeployTGE): oferta inteira distribuída, deployer e distribuidor com 0.
// 2. Contratos (DeployMainnet) com o token do TGE: o próprio script confere os papéis finais.
// 3. LP travado (lockLiquidity): o Safe da liquidez manda o "LP" para o TokenLock. O LP é simulado pelo próprio
//    SCITY (o par na DEX é da PancakeSwap, fora do repositório).
// 4. Incidente: pausar e despausar tudo pelo Safe de pausa (lotes do safe-lote.mjs).
// 5. Troca do signer pelo timelock (48 h): o Safe de pausa não agenda, executar antes do atraso falha, depois passa.
//
// Os arquivos de um deploy real na testnet (deployments/97*.json, broadcast/*/97) são guardados antes e devolvidos
// no fim: o ensaio nunca os sobrescreve.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pauseBatch, rotateSignerBatches } from './safe-lote.mjs';

const PORT = process.env.ENSAIO_PORT ?? '8597';
const RPC = `http://127.0.0.1:${PORT}`;
const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SIGNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const NEW_SIGNER = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const TREASURY = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const safe = (n) => `0x${'5afe'.padEnd(36, '0')}${n.toString(16).padStart(4, '0')}`;
const ADMIN = safe(1);
const PAUSER = safe(2);
const SIGNER_ROLE = '0xe2f4eaae4a9751e85a3e4a7b9587827a877f29914755229b07a7b2da98285f70';
const WEI = 10n ** 18n;

let failures = 0;
const ok = (cond, what) => {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${what}`);
  if (!cond) failures++;
};
const step = (title) => console.log(`\n▶ ${title}`);

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} falhou:\n${(r.stderr || r.stdout).slice(-1500)}`);
  return r.stdout.trim();
}
const cast = (...args) => run('cast', [...args, '--rpc-url', RPC]);
const call = (to, sig, ...args) => cast('call', to, sig, ...args).split(' ')[0];
const tryCast = (...args) => spawnSync('cast', [...args, '--rpc-url', RPC], { encoding: 'utf8' }).status === 0;

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/** Um Safe simulado: código não vazio, BNB para o gás e transações por impersonação. */
async function fakeSafe(address) {
  await rpc('anvil_setCode', [address, '0x00']);
  await rpc('anvil_setBalance', [address, '0x56BC75E2D63100000']);
  await rpc('anvil_impersonateAccount', [address]);
}

/** Manda as transações de um lote do Transaction Builder pelo Safe. Devolve se todas passaram. */
function sendBatch(batch, from) {
  return batch.transactions.every((t) => tryCast('send', '--unlocked', '--from', from, t.to, t.data));
}

// ---------------------------------------------------------------- guarda dos arquivos de um deploy real

const backup = mkdtempSync(join(tmpdir(), 'ensaio-'));
const guarded = ['deployments/97.json', 'deployments/97-tge.json', 'deployments/97-lp-lock.json', 'broadcast/DeployTGE.s.sol/97', 'broadcast/DeployMainnet.s.sol/97'];
const stashed = [];
for (const p of guarded) {
  if (existsSync(p)) {
    cpSync(p, join(backup, p.replaceAll('/', '__')), { recursive: true });
    stashed.push(p);
  }
}
const configs = ['deploy/ensaio-tge.local.json', 'deploy/ensaio-bsc.local.json'];

const anvil = spawn('anvil', ['--chain-id', '97', '--port', PORT, '--silent'], { stdio: 'ignore' });
const cleanup = () => {
  anvil.kill();
  for (const p of [...guarded, ...configs]) rmSync(p, { recursive: true, force: true });
  for (const p of stashed) renameSync(join(backup, p.replaceAll('/', '__')), p);
  rmSync(backup, { recursive: true, force: true });
};

try {
  for (let i = 0; ; i++) {
    try {
      await rpc('eth_chainId');
      break;
    } catch {
      if (i > 50) throw new Error('o anvil não subiu');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ---------------------------------------------------------------- 1. TGE
  step('TGE (DeployTGE)');
  const tge = JSON.parse(readFileSync('deploy/tge.example.json', 'utf8'));
  tge.playToEarn.beneficiary = safe(10);
  tge.allocations.forEach((a, i) => (a.beneficiary = safe(11 + i)));
  writeFileSync(configs[0], JSON.stringify(tge, null, 2));
  run('forge', ['script', 'script/DeployTGE.s.sol', '--rpc-url', RPC, '--broadcast', '--unlocked', '--sender', DEPLOYER], { TGE_CONFIG: configs[0] });
  const t = JSON.parse(readFileSync('deployments/97-tge.json', 'utf8'));
  const bal = (who) => BigInt(call(t.SCityToken, 'balanceOf(address)(uint256)', who));
  ok(BigInt(call(t.SCityToken, 'totalSupply()(uint256)')) === 1_000_000_000n * WEI, 'oferta de 1 bilhão');
  ok(bal(t.TgeDistributor) === 0n && bal(DEPLOYER) === 0n, 'distribuidor e deployer com 0 SCITY');
  ok(bal(t.RewardsPool) === 410_000_000n * WEI, 'Play-to-Earn: 410 mi no RewardsPool');
  ok(bal(t.vesting.Team) === 95_000_000n * WEI, 'Team: 95 mi na VestingWallet');
  const liquidity = t.beneficiaries['Liquidez (pool)'];
  ok(bal(liquidity) === 30_000_000n * WEI, 'Liquidez (pool): 30 mi direto no Safe');

  // ---------------------------------------------------------------- 2. contratos
  step('Contratos (DeployMainnet) com o token do TGE');
  await fakeSafe(ADMIN);
  await fakeSafe(PAUSER);
  const vrf = run('forge', ['create', 'src/dev/LocalVRFCoordinator.sol:LocalVRFCoordinator', '--rpc-url', RPC, '--unlocked', '--from', DEPLOYER, '--broadcast']).match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1];
  const bsc = JSON.parse(readFileSync('deploy/bsc.example.json', 'utf8'));
  Object.assign(bsc, { adminMultisig: ADMIN, pauserMultisig: PAUSER, signer: SIGNER, treasury: TREASURY, scity: t.SCityToken });
  Object.assign(bsc.vrf, { coordinator: vrf, keyHash: `0x${'11'.repeat(32)}`, subId: 1 });
  writeFileSync(configs[1], JSON.stringify(bsc, null, 2));
  run('forge', ['script', 'script/DeployMainnet.s.sol', '--rpc-url', RPC, '--broadcast', '--unlocked', '--sender', DEPLOYER], { DEPLOY_CONFIG: configs[1] });
  const d = JSON.parse(readFileSync('deployments/97.json', 'utf8'));
  ok(d.SCityToken.toLowerCase() === t.SCityToken.toLowerCase(), 'o jogo usa o token do TGE');
  ok(call(d.Timelock, 'getMinDelay()(uint256)') === '172800', 'timelock de 48 h');
  ok(call(d.GameVault, 'hasRole(bytes32,address)(bool)', `0x${'0'.repeat(64)}`, d.Timelock) === 'true', 'admin do cofre é o timelock');
  ok(call(d.GameVault, 'hasRole(bytes32,address)(bool)', `0x${'0'.repeat(64)}`, DEPLOYER) === 'false', 'deployer sem admin (o script também confere)');

  // ---------------------------------------------------------------- 3. LP travado
  step('LP travado (lockLiquidity), com o SCITY no papel do LP');
  run('forge', ['script', 'script/DeployTGE.s.sol', '--sig', 'lockLiquidity()', '--rpc-url', RPC, '--broadcast', '--unlocked', '--sender', DEPLOYER], {
    LP_TOKEN: t.SCityToken,
    LP_BENEFICIARY: liquidity,
    LP_LOCK_DAYS: '365',
  });
  const lock = JSON.parse(readFileSync('deployments/97-lp-lock.json', 'utf8')).TokenLock;
  await fakeSafe(liquidity);
  const lp = 30_000_000n * WEI;
  ok(tryCast('send', '--unlocked', '--from', liquidity, t.SCityToken, 'transfer(address,uint256)', lock, lp.toString()), 'o Safe da liquidez manda o LP para o TokenLock');
  const now = Number((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp);
  ok(Number(call(lock, 'releaseTime()(uint64)')) >= now + 365 * 86400, 'liberação em 365 dias ou mais');
  ok(bal(lock) === lp, 'LP inteiro no TokenLock');
  ok(!tryCast('send', '--unlocked', '--from', DEPLOYER, lock, 'release()'), 'antes do prazo, release() recusa');

  // ---------------------------------------------------------------- 4. incidente: pausar tudo
  step('Incidente: pausar e despausar tudo pelo Safe 2-de-3');
  const pause = pauseBatch(d, true);
  ok(!sendBatch(pause, ADMIN), 'o Safe de admin não pausa (pausa é do 2-de-3)');
  ok(sendBatch(pause, PAUSER), 'lote pausar pelo Safe de pausa');
  const paused = ['LandNFT', 'PropertyNFT', 'BuildingNFT', 'LuckyBox', 'GameVault', 'Marketplace'].every((n) => call(d[n], 'paused()(bool)') === 'true');
  ok(paused, 'os 6 contratos pausados');
  ok(sendBatch(pauseBatch(d, false), PAUSER), 'lote despausar');
  ok(call(d.GameVault, 'paused()(bool)') === 'false', 'cofre despausado');

  // ---------------------------------------------------------------- 5. troca do signer
  step('Troca do signer pelo timelock (48 h)');
  const rot = rotateSignerBatches(d, { antigo: SIGNER, novo: NEW_SIGNER, atraso: 172800, salt: `0x${'ab'.repeat(32)}` });
  ok(!sendBatch(rot.agendar, PAUSER), 'o Safe de pausa não agenda no timelock');
  ok(sendBatch(rot.agendar, ADMIN), 'o Safe de admin agenda');
  ok(!sendBatch(rot.executar, ADMIN), 'executar antes do atraso é recusado');
  await rpc('evm_increaseTime', [172801]);
  await rpc('evm_mine');
  ok(sendBatch(rot.executar, ADMIN), 'executar depois de 48 h');
  const roles = ['LandNFT', 'PropertyNFT', 'BuildingNFT', 'GameVault'].every(
    (n) => call(d[n], 'hasRole(bytes32,address)(bool)', SIGNER_ROLE, SIGNER) === 'false' && call(d[n], 'hasRole(bytes32,address)(bool)', SIGNER_ROLE, NEW_SIGNER) === 'true',
  );
  ok(roles, 'chave antiga fora e nova dentro nos 4 contratos de voucher');
} catch (error) {
  failures++;
  console.error(`\n${error.message}`);
} finally {
  cleanup();
}

console.log(failures ? `\n✖ Ensaio com ${failures} falha(s).` : '\n✔ Ensaio do lançamento completo.');
process.exit(failures ? 1 : 0);
