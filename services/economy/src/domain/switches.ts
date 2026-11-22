import { AppError } from '@scc/shared';

/**
 * Travas de incidente (E4.6, [plano de incidentes](../../../../docs/incidentes/README.md)).
 *
 * São interruptores da operação para estancar o dinheiro que sai do jogo enquanto o incidente é
 * investigado, sem deploy e sem esperar o multisig:
 * - `withdrawals`: novos pedidos de saque (voucher do GameVault) param. Os já emitidos continuam valendo
 *   no contrato; para eles, a resposta é pausar o cofre pelo multisig 2-de-3.
 * - `exchange`: o câmbio THALER ↔ SCITY para nos dois sentidos.
 *
 * O resto do jogo segue (turnos, compras com THALER, depósitos creditados). A trava fica no banco, vale
 * para todas as instâncias e sobrevive a reinício. Cada mudança guarda quem, quando e o motivo, e o motivo
 * público aparece para o jogador.
 */
export const SWITCHES = ['withdrawals', 'exchange'] as const;
export type SwitchName = (typeof SWITCHES)[number];

export interface Switch {
  name: SwitchName;
  frozen: boolean;
  /** Texto para o jogador (sem detalhe do incidente). */
  reason: string | null;
  /** Quem mudou: nome do operador ou do runbook. */
  by: string | null;
  since: Date | null;
}

export interface SwitchStore {
  all(): Promise<Switch[]>;
  set(s: Switch): Promise<void>;
}

export const isSwitch = (name: string): name is SwitchName => (SWITCHES as readonly string[]).includes(name);

const MESSAGES: Record<SwitchName, string> = {
  withdrawals: 'Saques suspensos temporariamente',
  exchange: 'Câmbio suspenso temporariamente',
};

/** Recusa a operação se a trava estiver ligada. 503: é temporário, o cliente tenta depois. */
export async function assertOpen(store: SwitchStore, name: SwitchName) {
  const s = (await store.all()).find((x) => x.name === name);
  if (s?.frozen) {
    throw new AppError(`${name}_frozen`, `${MESSAGES[name]}${s.reason ? `: ${s.reason}` : ''}. Seu saldo está seguro.`, 503);
  }
}

/** Todas as travas, com as que nunca foram mexidas como abertas. */
export async function statusOf(store: SwitchStore): Promise<Switch[]> {
  const saved = await store.all();
  return SWITCHES.map((name) => saved.find((s) => s.name === name) ?? { name, frozen: false, reason: null, by: null, since: null });
}

export const switchDto = (s: Switch) => ({
  frozen: s.frozen,
  reason: s.reason,
  since: s.since?.toISOString() ?? null,
});
