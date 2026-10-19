<?php

declare(strict_types=1);

/**
 * Emite um JWT de DESENVOLVIMENTO assinado com o jwt_secret local.
 *
 *   php bin/token-dev.php <account_id> [minutos]
 *
 * Em produção quem assina é o gateway SCC no login SIWE; este script existe
 * para testar o editor e a API sem o gateway no ar. Cole o token em
 * VITE_SCC_TOKEN, ou abra o editor com #token=<jwt>.
 */

if (\PHP_SAPI !== 'cli') {
    \http_response_code(404);
    exit;
}

require_once \dirname(__DIR__) . '/api/config.php';

use SccBuilder\Api\Config;
use SccBuilder\Api\Jwt;

$conta   = (string) ($argv[1] ?? '');
$minutos = (int) ($argv[2] ?? 60);

if ($conta === '' || !Jwt::accountIdValido($conta)) {
    \fwrite(\STDERR, "Uso: php bin/token-dev.php <account_id> [minutos]\n");
    exit(1);
}

$segredo = (string) Config::get('jwt_secret', '');
if ($segredo === '') {
    \fwrite(\STDERR, "jwt_secret vazio: rode php bin/instalar.php ou defina em api/config.local.php.\n");
    exit(1);
}

$claims = ['sub' => $conta, 'iat' => \time(), 'exp' => \time() + \max(1, $minutos) * 60];
if ((string) Config::get('jwt_issuer', '') !== '') {
    $claims['iss'] = (string) Config::get('jwt_issuer');
}
if ((string) Config::get('jwt_audience', '') !== '') {
    $claims['aud'] = (string) Config::get('jwt_audience');
}

echo Jwt::encode($claims, $segredo), \PHP_EOL;
