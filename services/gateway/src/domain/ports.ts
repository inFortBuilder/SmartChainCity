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

/** Resultado de ligar uma carteira a uma conta que já existe. */
export type LinkWalletResult = 'linked' | 'already_linked' | 'taken';
/** Resultado de pôr um e-mail numa conta que já existe. */
export type SetEmailResult = 'set' | 'already_set' | 'taken' | 'has_other';

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
  /**
   * Liga a carteira à conta. `taken` se ela já é de outra conta (uma carteira,
   * uma conta só). Atômico: duas contas disputando a mesma carteira, uma ganha.
   */
  linkWallet(accountId: string, address: string, chainId: number, now: Date): Promise<LinkWalletResult>;
  /**
   * Põe o e-mail na conta que ainda não tem. `taken` se outra conta usa o e-mail;
   * `has_other` se esta já tem outro. Atômico.
   */
  setAccountEmail(accountId: string, email: string): Promise<SetEmailResult>;
  findAccount(id: string): Promise<Account | null>;
  listWallets(accountId: string): Promise<WalletLink[]>;
}
