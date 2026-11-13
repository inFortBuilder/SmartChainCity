export type AccountStatus = 'active' | 'suspended' | 'banned';

export interface Account {
  id: string;
  email: string | null;
  status: AccountStatus;
  kycLevel: number;
  createdAt: Date;
}

export interface WalletLink {
  accountId: string;
  /** EIP-55 checksum address. */
  address: string;
  chainId: number;
  verifiedAt: Date;
}

/** Persistence port. Mirrors `account` and `wallet_link` from doc 06 §2. */
export interface AuthStore {
  saveNonce(nonce: string, expiresAt: Date): Promise<void>;
  /** Single use: returns true only once, and only before expiry. Must be atomic. */
  consumeNonce(nonce: string, now: Date): Promise<boolean>;
  findOrCreateAccountByWallet(address: string, chainId: number, now: Date): Promise<Account>;
  findOrCreateAccountByEmail(email: string, now: Date): Promise<Account>;
  /**
   * Guarda o código de login do e-mail, trocando o anterior. Devolve false, sem
   * trocar, se o anterior foi criado há menos de `minIntervalSeconds`. Atômico.
   */
  saveEmailCode(email: string, codeHash: string, expiresAt: Date, now: Date, minIntervalSeconds: number): Promise<boolean>;
  /**
   * Confere o código: certo, dentro da validade e abaixo de `maxAttempts` erros,
   * apaga e devolve true (uma vez só, mesmo em paralelo); errado, conta um erro.
   */
  consumeEmailCode(email: string, codeHash: string, now: Date, maxAttempts: number): Promise<boolean>;
  findAccount(id: string): Promise<Account | null>;
  listWallets(accountId: string): Promise<WalletLink[]>;
}
