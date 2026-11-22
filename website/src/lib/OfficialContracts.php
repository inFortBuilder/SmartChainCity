<?php
declare(strict_types=1);

/**
 * Endereços oficiais (E4.2/E4.5): lidos dos arquivos que os scripts de deploy gravam em
 * contracts/deployments — `<chainId>.json` (DeployMainnet), `<chainId>-tge.json` (DeployTGE) e
 * `<chainId>-lp-lock.json` (trava do LP). Publicar o arquivo é publicar o endereço: o site não tem lista
 * própria para não divergir. No anvil (31337), o arquivo é `anvil.json`.
 */
final class OfficialContracts
{
    /** Nome no arquivo → o que mostrar. A ordem é a da página. */
    private const CORE = [
        'SCityToken'  => ['Token SCITY (BEP-20)', 'Oferta fixa de 1 bilhão, sem mint posterior'],
        'Timelock'    => ['Timelock (48 h)', 'Toda mudança de parâmetro e de upgrade espera 48 h'],
        'GameVault'   => ['GameVault (cofre)', 'Depósito e saque do jogo, com teto diário'],
        'Marketplace' => ['Marketplace', 'Mercado de lotes, imóveis e avatares'],
        'LandNFT'     => ['Lotes (LandNFT)', 'Lotes da cidade'],
        'PropertyNFT' => ['Imóveis (PropertyNFT)', 'Casas e negócios'],
        'BuildingNFT' => ['Prédios (BuildingNFT)', 'Prédios de construtores'],
        'AvatarNFT'   => ['Avatares (AvatarNFT)', 'Smartcityanos'],
        'LuckyBox'    => ['Lucky Box', 'Caixas com sorteio Chainlink VRF'],
    ];

    /** @return array{chain_id:int, core:list<array>, tge:list<array>, lock:?array, published:bool} */
    public static function all(): array
    {
        $chain = (int) cfg('chain.chain_id');
        $dir = rtrim((string) cfg('chain.deployments_dir'), '/\\');
        $base = $chain === 31337 ? 'anvil' : (string) $chain;

        $core = [];
        $main = self::read("$dir/$base.json");
        foreach (self::CORE as $key => [$label, $what]) {
            if (self::isAddress($main[$key] ?? null)) {
                $core[] = ['key' => $key, 'label' => $label, 'what' => $what, 'address' => $main[$key]];
            }
        }

        $tge = [];
        $t = self::read("$dir/$base-tge.json");
        if (self::isAddress($t['RewardsPool'] ?? null)) {
            $tge[] = ['label' => 'Play-to-Earn (RewardsPool)', 'what' => 'Parcelas anuais de 30%, 25%, 20%, 15% e 10%', 'address' => $t['RewardsPool']];
        }
        foreach (($t['vesting'] ?? []) as $name => $wallet) {
            if (self::isAddress($wallet) && $wallet !== '0x0000000000000000000000000000000000000000') {
                $tge[] = ['label' => "Vesting: $name", 'what' => 'VestingWallet da OpenZeppelin', 'address' => $wallet];
            }
        }
        if (!$core && self::isAddress($t['SCityToken'] ?? null)) {
            $core[] = ['key' => 'SCityToken', 'label' => self::CORE['SCityToken'][0], 'what' => self::CORE['SCityToken'][1], 'address' => $t['SCityToken']];
        }

        $lock = null;
        $l = self::read("$dir/$base-lp-lock.json");
        if (self::isAddress($l['TokenLock'] ?? null)) {
            $lock = ['address' => $l['TokenLock'], 'lp' => $l['lpToken'] ?? '', 'release' => (int) ($l['releaseTime'] ?? 0)];
        }

        return ['chain_id' => $chain, 'core' => $core, 'tge' => $tge, 'lock' => $lock, 'published' => (bool) $core];
    }

    private static function read(string $file): array
    {
        if (!is_file($file)) {
            return [];
        }
        $data = json_decode((string) file_get_contents($file), true);
        return is_array($data) ? $data : [];
    }

    private static function isAddress(mixed $v): bool
    {
        return is_string($v) && preg_match('/^0x[0-9a-fA-F]{40}$/', $v) === 1;
    }
}
