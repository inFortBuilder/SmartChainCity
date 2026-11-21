// Carteira do jogador no navegador, para as transações que ele assina e paga
// (Mercado, depósito e resgate no GameVault): a MetaMask (window.ethereum) ou,
// na máquina local, a carteira de teste do login, direto no anvil.

const params = new URLSearchParams(location.search);
export const RPC = params.get('rpc') ?? 'http://127.0.0.1:8545';
export const VIEM = 'https://esm.sh/viem@2.21.54';
const DEV_WALLET_KEY = 'scc-carteira-de-teste';
// A carteira de teste guarda a chave no navegador: só serve em máquina local.
export const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

const devKey = () => {
  try {
    return LOCAL ? localStorage.getItem(DEV_WALLET_KEY) : null;
  } catch {
    return null;
  }
};

/** Há como assinar uma transação aqui? */
export const hasWallet = () => Boolean(window.ethereum) || Boolean(devKey());

/**
 * Conecta a carteira. Com `chainId`, confere que a MetaMask está na rede certa.
 * Devolve `{ viem, address, client, pub }`.
 */
export async function connectWallet(chainId) {
  const viem = await import(VIEM);
  if (window.ethereum) {
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const current = Number(await window.ethereum.request({ method: 'eth_chainId' }));
    if (chainId && current !== chainId) throw new Error(`A carteira está na rede ${current}; o jogo está na ${chainId}.`);
    const transport = viem.custom(window.ethereum);
    const account = viem.getAddress(address);
    return { viem, address: account, client: viem.createWalletClient({ account, transport }), pub: viem.createPublicClient({ transport }) };
  }
  const key = devKey();
  if (!key) throw new Error('Conecte a MetaMask (ou, na máquina local, entre com a carteira de teste).');
  const { privateKeyToAccount } = await import(`${VIEM}/accounts`);
  const account = privateKeyToAccount(key);
  const chain = viem.defineChain({ id: 31337, name: 'Anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const pub = viem.createPublicClient({ chain, transport: viem.http(RPC) });
  // Só no anvil: a carteira de teste recebe ETH de mentira para o gás.
  if ((await pub.getBalance({ address: account.address })) < 10n ** 17n) {
    await pub.request({ method: 'anvil_setBalance', params: [account.address, '0x8AC7230489E80000'] });
  }
  return { viem, address: account.address, client: viem.createWalletClient({ account, chain, transport: viem.http(RPC) }), pub };
}

/** Manda a transação e espera o recibo; reverteu, erro. `abi` em texto (parseAbi). */
export async function sendTx(w, address, abi, functionName, args) {
  const hash = await w.client.writeContract({ address, abi: w.viem.parseAbi(abi), functionName, args, chain: w.client.chain ?? null });
  const receipt = await w.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('A transação reverteu.');
  return receipt;
}

export const readContract = (w, address, abi, functionName, args = []) =>
  w.pub.readContract({ address, abi: w.viem.parseAbi(abi), functionName, args });

/** Mensagem curta para erros de transação: carteira recusou ou erro do contrato pelo nome. */
export function txError(error, names = {}) {
  const m = String(error?.shortMessage ?? error?.message ?? error);
  if (/User rejected|denied/i.test(m)) return 'Você recusou na carteira.';
  for (const [name, text] of Object.entries(names)) if (m.includes(name)) return text;
  return m.split('\n')[0].slice(0, 200);
}
