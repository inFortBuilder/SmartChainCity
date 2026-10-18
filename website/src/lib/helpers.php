<?php
declare(strict_types=1);

/** Lê um valor da configuração por caminho com pontos: cfg('chain.chain_id'). */
function cfg(string $path, mixed $default = null): mixed
{
    $value = $GLOBALS['scc_config'];
    foreach (explode('.', $path) as $key) {
        if (!is_array($value) || !array_key_exists($key, $value)) {
            return $default;
        }
        $value = $value[$key];
    }
    return $value;
}

/** Escapa texto para HTML. */
function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** URL de um asset com versão por data de modificação (cache busting). */
function asset(string $path): string
{
    $file = __DIR__ . '/../../public/assets/' . ltrim($path, '/');
    $version = is_file($file) ? (string) filemtime($file) : '1';
    return cfg('app.base_url') . '/assets/' . ltrim($path, '/') . '?v=' . $version;
}

/**
 * Logo oficial (arte 3D da pasta MKT, com fundo transparente) em WebP responsivo.
 * $sizes segue o atributo HTML sizes (largura exibida). A proporção da arte é 1000 × 513.
 */
function logo_img(string $class, string $sizes, int $width, bool $lazy = false): string
{
    $srcset = implode(', ', array_map(
        static fn (int $w): string => asset("img/brand/logo-3d-{$w}.webp") . " {$w}w",
        [260, 520, 1000]
    ));
    return sprintf(
        '<img class="%s" src="%s" srcset="%s" sizes="%s" width="%d" height="%d" alt="%s"%s decoding="async">',
        e($class), e(asset('img/brand/logo-3d-520.webp')), e($srcset), e($sizes),
        $width, (int) round($width * 513 / 1000), e(cfg('app.name')), $lazy ? ' loading="lazy"' : ''
    );
}

/** URL interna do site. */
function url(string $path = ''): string
{
    return cfg('app.base_url') . '/' . ltrim($path, '/');
}

/** Página atual (nome do arquivo sem extensão), usada para marcar o menu. */
function current_page(): string
{
    return basename((string) ($_SERVER['SCRIPT_NAME'] ?? 'index.php'), '.php');
}

/** Formata número no padrão brasileiro. */
function num(float|int $value, int $decimals = 0): string
{
    return number_format((float) $value, $decimals, ',', '.');
}

/** Token CSRF da sessão. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_valid(?string $token): bool
{
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

/** Envia resposta JSON e encerra. */
function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

/** Renderiza um partial de src/partials com variáveis locais. */
function partial(string $name, array $vars = []): void
{
    extract($vars, EXTR_SKIP);
    require __DIR__ . '/../partials/' . $name . '.php';
}

/** Configuração pública exposta ao JavaScript (nada sensível aqui). */
function public_js_config(): array
{
    return [
        'baseUrl' => cfg('app.base_url'),
        'chain'   => [
            'chainId'       => cfg('chain.chain_id'),
            'chainName'     => cfg('chain.chain_name'),
            'rpcUrl'        => cfg('chain.rpc_url'),
            'explorer'      => cfg('chain.explorer'),
            'tokenAddress'  => cfg('chain.token_address'),
            'tokenSymbol'   => cfg('chain.token_symbol'),
            'tokenDecimals' => cfg('chain.token_decimals'),
        ],
        'sale'    => [
            'open'     => cfg('sale.open'),
            'priceUsd' => cfg('sale.price_usd'),
            'minUsd'   => cfg('sale.min_usd'),
            'maxUsd'   => cfg('sale.max_usd'),
        ],
        'links'   => ['play' => cfg('links.play')],
    ];
}
