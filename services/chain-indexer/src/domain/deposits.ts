import type { IndexerStore } from './indexer.js';

/**
 * Depósito SCITY do `GameVault` (doc 05 §4, doc 07 §2.4). O indexer só vê o
 * evento depois das confirmações; aqui ele vira saldo no ledger do jogo.
 *
 * - Quem: a carteira que depositou, ligada a uma conta no gateway. Carteira sem
 *   conta fica `pending` e o crédito sai quando ela for ligada.
 * - Quanto: o mesmo SCITY, em wei (o ledger conta SCITY em wei, como a compra de
 *   lotes). A conversão para THALER é outra operação, com o câmbio do dia.
 * - Uma vez só: a chave do ledger é `chain:<rede>:<tx>:<log>`. Se o indexer
 *   refizer as projeções (reorganização), o depósito volta a `pending`, mas o
 *   ledger devolve o lançamento antigo em vez de creditar de novo.
 */
export interface Deposit {
  txHash: string;
  logIndex: number;
  account: string;
  amountWei: string;
  block: bigint;
  status: 'pending' | 'credited';
  accountId: string | null;
}

export interface WalletOwners {
  /** Conta dona da carteira, ou null se ninguém a ligou. */
  ownerOf(address: string): Promise<string | null>;
}

export interface DepositLedger {
  /** Credita o SCITY na conta. Idempotente pela chave. */
  credit(key: string, accountId: string, amountWei: string, ref: string): Promise<void>;
}

export const depositKey = (chainId: number, d: Pick<Deposit, 'txHash' | 'logIndex'>) => `chain:${chainId}:${d.txHash}:${d.logIndex}`;

/** Credita os depósitos pendentes. Devolve quantos creditou e quantos esperam a carteira ser ligada. */
export async function creditDeposits(store: IndexerStore, chainId: number, owners: WalletOwners, ledger: DepositLedger, batch = 100) {
  let credited = 0;
  let unlinked = 0;
  for (const d of await store.pendingDeposits(chainId, batch)) {
    const accountId = await owners.ownerOf(d.account);
    if (!accountId) {
      unlinked++;
      continue;
    }
    const key = depositKey(chainId, d);
    await ledger.credit(key, accountId, d.amountWei, `${d.txHash}:${d.logIndex}`);
    await store.markDepositCredited(chainId, d.txHash, d.logIndex, accountId);
    credited++;
  }
  return { credited, unlinked };
}
