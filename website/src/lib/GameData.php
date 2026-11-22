<?php
declare(strict_types=1);

/**
 * Fonte de dados do jogo para o site.
 *
 * Se SCC_GAME_API_URL estiver configurada, busca na API do jogo (gateway);
 * caso contrário — ou se a API falhar — usa os dados de exemplo em src/data/.
 */
final class GameData
{
    /** Estatísticas públicas da cidade (painel da home). */
    public static function stats(): array
    {
        $remote = self::fetch('/v1/public/stats');
        if (is_array($remote) && isset($remote['avatars'])) {
            return $remote + ['source' => 'api'];
        }
        return (require __DIR__ . '/../data/stats.php') + ['source' => 'sample'];
    }

    /**
     * Anúncios do marketplace, com filtro por categoria.
     * @return list<array<string,mixed>>
     */
    public static function listings(?string $category = null): array
    {
        return self::market($category)['items'];
    }

    /**
     * Listagens do Marketplace on-chain pelo chain-indexer (E3.6), no formato do card. Sem o indexer, ou
     * com ele fora, os anúncios de exemplo (source = 'sample').
     * @return array{items: list<array<string,mixed>>, source: string}
     */
    public static function market(?string $category = null): array
    {
        $base = (string) cfg('api.indexer_url');
        $remote = $base ? self::fetch('/v1/market/listings?limit=100', $base) : null;
        if (is_array($remote) && isset($remote['listings']) && is_array($remote['listings'])) {
            $items = array_values(array_filter(array_map([self::class, 'fromChain'], $remote['listings'])));
            if ($category !== null && $category !== '' && $category !== 'all') {
                $items = array_values(array_filter($items, static fn (array $i): bool => $i['category'] === $category));
            }
            return ['items' => $items, 'source' => 'chain'];
        }
        return ['items' => self::sampleListings($category), 'source' => 'sample'];
    }

    /** Uma listagem do indexer vira um card: categoria pela coleção, combo quando tem mais de um NFT. */
    private static function fromChain(mixed $l): ?array
    {
        if (!is_array($l) || !isset($l['listing_id'], $l['price_wei'], $l['items']) || !is_array($l['items'])) {
            return null;
        }
        $kinds = ['LandNFT' => ['land', 'Lote'], 'PropertyNFT' => ['property', 'Imóvel'], 'AvatarNFT' => ['avatar', 'Avatar']];
        $names = [];
        $category = null;
        foreach ($l['items'] as $it) {
            [$cat, $label] = $kinds[(string) ($it['collection'] ?? '')] ?? ['item', 'NFT'];
            $category ??= $cat;
            $id = (string) ($it['token_id'] ?? '');
            // Lote: o tokenId leva a cidade nos 32 bits altos; o número do lote fica nos baixos.
            $shown = $cat === 'land' && ctype_digit($id) ? (string) ((int) bcmod_safe($id, '4294967296') + 1) : $id;
            $names[] = "$label #$shown";
        }
        $wei = (string) $l['price_wei'];
        return [
            'id'         => 'L' . $l['listing_id'],
            'listing_id' => (string) $l['listing_id'],
            'price_wei'  => $wei,
            'category'   => $category ?? 'item',
            'name'       => count($names) > 1 ? 'Combo: ' . implode(' + ', $names) : ($names[0] ?? 'NFT'),
            'badge'      => count($names) > 1 ? 'Combo' : ['land' => 'Lote', 'property' => 'Imóvel', 'avatar' => 'Avatar'][$category] ?? 'NFT',
            'price'      => wei_to_float($wei),
            'rarity'     => 'common',
            'seller'     => (string) ($l['seller'] ?? ''),
            'expires_at' => (string) ($l['expires_at'] ?? ''),
            'chain'      => true,
        ];
    }

    private static function sampleListings(?string $category): array
    {
        $items = require __DIR__ . '/../data/listings.php';

        if ($category !== null && $category !== '' && $category !== 'all') {
            $items = array_values(array_filter($items, static fn (array $i): bool => $i['category'] === $category));
        }
        return $items;
    }

    /**
     * Travas de incidente do economy (saque e câmbio suspensos), para o aviso no topo do site.
     * Sem a API, ou com ela fora, não há aviso: o site não inventa incidente.
     * @return array<string, array{frozen:bool, reason:?string}>
     */
    public static function status(): array
    {
        $remote = self::fetch('/v1/economy/status', (string) cfg('api.economy_api_url'));
        $out = [];
        foreach ((is_array($remote) ? ($remote['switches'] ?? []) : []) as $name => $s) {
            if (is_string($name) && is_array($s)) {
                $out[$name] = ['frozen' => (bool) ($s['frozen'] ?? false), 'reason' => isset($s['reason']) ? (string) $s['reason'] : null];
            }
        }
        return $out;
    }

    /**
     * Depósitos de uma carteira no GameVault e se já viraram saldo (chain-indexer). null sem o indexer.
     * @return ?list<array{tx_hash:string, amount_wei:string, status:string}>
     */
    public static function deposits(string $wallet): ?array
    {
        $base = (string) cfg('api.indexer_url');
        if (!$base || !preg_match('/^0x[0-9a-fA-F]{40}$/', $wallet)) {
            return null;
        }
        $r = self::fetch('/v1/chain/deposits/' . $wallet, $base);
        if (!is_array($r) || !isset($r['deposits']) || !is_array($r['deposits'])) {
            return null;
        }
        $out = [];
        foreach (array_slice($r['deposits'], 0, 10) as $d) {
            if (is_array($d) && isset($d['tx_hash'], $d['amount_wei'], $d['status'])) {
                $out[] = ['tx_hash' => (string) $d['tx_hash'], 'amount_wei' => (string) $d['amount_wei'], 'status' => (string) $d['status']];
            }
        }
        return $out;
    }

    /**
     * NFTs da carteira (lotes, imóveis e avatares), pelo chain-indexer. null sem o indexer.
     * @return ?list<array{category:string, token_id:string, name:string}>
     */
    public static function owned(string $wallet): ?array
    {
        $base = (string) cfg('api.indexer_url');
        if (!$base || !preg_match('/^0x[0-9a-fA-F]{40}$/', $wallet)) {
            return null;
        }
        $r = self::fetch('/v1/chain/owners/' . $wallet, $base);
        if (!is_array($r)) {
            return null;
        }
        $out = [];
        foreach (($r['lots'] ?? []) as $l) {
            $out[] = ['category' => 'land', 'token_id' => (string) $l['token_id'], 'name' => 'Lote #' . ((int) ($l['lot'] ?? 0) + 1)];
        }
        foreach (($r['properties'] ?? []) as $p) {
            $out[] = ['category' => 'property', 'token_id' => (string) $p['token_id'], 'name' => 'Imóvel ' . strtoupper((string) ($p['type'] ?? '')) . ' #' . $p['token_id']];
        }
        foreach (($r['avatars'] ?? []) as $a) {
            $out[] = ['category' => 'avatar', 'token_id' => (string) $a['token_id'], 'name' => 'Avatar ' . (string) ($a['profession'] ?? '') . ' #' . $a['token_id']];
        }
        return $out;
    }

    /**
     * Leilões abertos do Marketplace on-chain, pelo chain-indexer. Vazio sem o indexer.
     * @return list<array<string,mixed>>
     */
    public static function auctions(): array
    {
        $base = (string) cfg('api.indexer_url');
        $r = $base ? self::fetch('/v1/market/auctions?limit=50', $base) : null;
        if (!is_array($r) || !isset($r['auctions']) || !is_array($r['auctions'])) {
            return [];
        }
        $labels = ['LandNFT' => 'Lote', 'PropertyNFT' => 'Imóvel', 'AvatarNFT' => 'Avatar'];
        $out = [];
        foreach ($r['auctions'] as $a) {
            if (!is_array($a) || ($a['status'] ?? '') !== 'active') {
                continue;
            }
            $names = array_map(static function (array $i) use ($labels): string {
                $label = $labels[(string) ($i['collection'] ?? '')] ?? 'NFT';
                $id = (string) ($i['token_id'] ?? '');
                return $label === 'Lote' && ctype_digit($id) ? 'Lote #' . ((int) bcmod_safe($id, '4294967296') + 1) : "$label #$id";
            }, is_array($a['items'] ?? null) ? $a['items'] : []);
            $out[] = [
                'auction_id'   => (string) $a['auction_id'],
                'name'         => implode(' + ', $names) ?: 'NFT',
                'seller'       => (string) ($a['seller'] ?? ''),
                'highest'      => $a['highest_bid_wei'] ? wei_to_float((string) $a['highest_bid_wei']) : null,
                'minimum_wei'  => (string) ($a['minimum_bid_wei'] ?? '0'),
                'minimum'      => wei_to_float((string) ($a['minimum_bid_wei'] ?? '0')),
                'bids'         => (int) ($a['bids'] ?? 0),
                'ends_at'      => (string) ($a['ends_at'] ?? ''),
                'ended'        => (bool) ($a['ended'] ?? false),
            ];
        }
        return $out;
    }

    /** Busca JSON na API do jogo; retorna null em qualquer falha. */
    private static function fetch(string $path, ?string $base = null): ?array
    {
        $base = $base ?? cfg('api.game_api_url');
        if (!$base) {
            return null;
        }
        $ctx = stream_context_create(['http' => [
            'timeout' => cfg('api.timeout_s', 3),
            'header'  => "Accept: application/json\r\n",
        ]]);
        $body = @file_get_contents($base . $path, false, $ctx);
        if ($body === false) {
            return null;
        }
        $data = json_decode($body, true);
        return is_array($data) ? $data : null;
    }
}
