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
  findAccount(id: string): Promise<Account | null>;
  listWallets(accountId: string): Promise<WalletLink[]>;
}
