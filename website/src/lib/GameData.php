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
        $remote = self::fetch('/v1/market/listings' . ($category ? '?category=' . rawurlencode($category) : ''));
        $items = is_array($remote) && isset($remote['items']) ? $remote['items'] : require __DIR__ . '/../data/listings.php';

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
