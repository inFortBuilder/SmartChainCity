<?php
/**
 * Configuração do site. Valores sensíveis ou por ambiente vêm de variáveis
 * de ambiente (ou de config.local.php, que não é versionado).
 */
declare(strict_types=1);

$env = static fn (string $key, mixed $default = null): mixed =>
    ($v = getenv($key)) !== false && $v !== '' ? $v : $default;

$config = [
    'app' => [
        'name'     => 'Smart Chain City',
        'tagline'  => 'Jogo NFT 3D de cidade com economia sustentável',
        'base_url' => rtrim((string) $env('SCC_BASE_URL', ''), '/'),
        'env'      => $env('SCC_ENV', 'dev'),            // dev | staging | prod
        'lang'     => 'pt-BR',
    ],
    'links' => [
        'play'       => $env('SCC_PLAY_URL', '/account.php'),       // URL do cliente WebGL
        'whitepaper' => $env('SCC_WHITEPAPER_URL', 'https://smartchaincity.gitbook.io/'),
        'trade'      => $env('SCC_TRADE_URL', 'https://pancakeswap.finance/swap'),
        'trailer'    => $env('SCC_TRAILER_URL', ''),                // URL de embed (YouTube/Vimeo); vazio = placeholder
        'discord'    => $env('SCC_DISCORD_URL', '#'),
        'instagram'  => $env('SCC_INSTAGRAM_URL', '#'),
        'telegram'   => $env('SCC_TELEGRAM_URL', '#'),
        'twitter'    => $env('SCC_TWITTER_URL', '#'),
        'support'    => $env('SCC_SUPPORT_URL', '#contato'),
        'audit'      => $env('SCC_AUDIT_URL', ''),
    ],
    'chain' => [
        'chain_id'       => (int) $env('SCC_CHAIN_ID', 97),          // 97 = BSC Testnet, 56 = BSC Mainnet
        'chain_name'     => $env('SCC_CHAIN_NAME', 'BNB Smart Chain Testnet'),
        'rpc_url'        => $env('SCC_RPC_URL', 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'),
        'explorer'       => $env('SCC_EXPLORER_URL', 'https://testnet.bscscan.com'),
        // Endereço do token SCITY. Vazio até o deploy (o endereço do material legado está incompleto).
        'token_address'  => $env('SCC_TOKEN_ADDRESS', ''),
        'token_symbol'   => 'SCITY',
        'token_decimals' => 18,
    ],
    'sale' => [
        'open'          => filter_var($env('SCC_SALE_OPEN', 'false'), FILTER_VALIDATE_BOOL),
        'price_usd'     => (float) $env('SCC_SALE_PRICE_USD', 0.05),
        'min_usd'       => (float) $env('SCC_SALE_MIN_USD', 50),
        'max_usd'       => (float) $env('SCC_SALE_MAX_USD', 5000),
        'hard_cap_usd'  => (float) $env('SCC_SALE_HARDCAP_USD', 350000),
        'raised_usd'    => (float) $env('SCC_SALE_RAISED_USD', 0),
        'pay_token'     => 'BUSD',
    ],
    'api' => [
        // API do jogo (gateway). Vazio = o site usa os dados de exemplo em src/data/.
        'game_api_url' => rtrim((string) $env('SCC_GAME_API_URL', ''), '/'),
        'timeout_s'    => 3,
    ],
    'contact' => [
        'storage'        => __DIR__ . '/../storage/contact.jsonl',
        'rate_limit_sec' => 60,
    ],
];

$local = __DIR__ . '/config.local.php';
if (is_file($local)) {
    $config = array_replace_recursive($config, require $local);
}

return $config;
