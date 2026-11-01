/**
 * Logs in against a running gateway with a throwaway wallet and prints the JWT.
 * The same token opens the SCC Builder: VITE_SCC_TOKEN or #token=<jwt>.
 *
 *   pnpm --filter @scc/gateway login:dev [http://127.0.0.1:8000]
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const domain = process.env.SIWE_DOMAIN ?? 'localhost:5173';
const wallet = privateKeyToAccount(generatePrivateKey());

const post = async (path: string, body?: unknown) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
};

const { nonce } = await post('/v1/auth/siwe/nonce');
const message = createSiweMessage({
  address: wallet.address,
  chainId: Number(process.env.SIWE_CHAIN_ID ?? 97),
  domain,
  nonce,
  uri: `http://${domain}`,
  version: '1',
});
const signature = await wallet.signMessage({ message });
const { access_token: token, account } = await post('/v1/auth/siwe/verify', { message, signature });

console.error(`conta ${account.id}, carteira ${wallet.address}`);
console.log(token);
