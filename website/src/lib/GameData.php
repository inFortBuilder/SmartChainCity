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
