<?php

declare(strict_types=1);

use SccBuilder\Api\Config;
use SccBuilder\Api\Jwt;
use SccBuilder\Api\Security;

const SEGREDO = 'segredo-de-teste-com-32-bytes-no-minimo!!';

caso('JWT: token válido devolve os claims', function (): void {
    $t = Jwt::encode(['sub' => '0xabc123', 'exp' => \time() + 60], SEGREDO);
    $c = Jwt::decode($t, SEGREDO);
    igual('0xabc123', $c['sub']);
});

caso('JWT: assinatura com outro segredo é recusada', function (): void {
    $t = Jwt::encode(['sub' => 'acc_1', 'exp' => \time() + 60], 'outro-segredo');
    lanca('invalid_token', fn () => Jwt::decode($t, SEGREDO));
});

caso('JWT: payload adulterado é recusado', function (): void {
    $t = Jwt::encode(['sub' => 'acc_1', 'exp' => \time() + 60], SEGREDO);
    [$h, , $s] = \explode('.', $t);
    $p = \rtrim(\strtr(\base64_encode('{"sub":"acc_2","exp":' . (\time() + 60) . '}'), '+/', '-_'), '=');
    lanca('invalid_token', fn () => Jwt::decode("{$h}.{$p}.{$s}", SEGREDO));
});

caso('JWT: expirado é recusado (com folga)', function (): void {
    $t = Jwt::encode(['sub' => 'acc_1', 'exp' => 1000], SEGREDO);
    lanca('token_expired', fn () => Jwt::decode($t, SEGREDO, ['now' => 1031, 'leeway' => 30]));
    igual('acc_1', Jwt::decode($t, SEGREDO, ['now' => 969, 'leeway' => 30])['sub']);
});

caso('JWT: sem exp é recusado', function (): void {
    $t = Jwt::encode(['sub' => 'acc_1'], SEGREDO);
    lanca('invalid_token', fn () => Jwt::decode($t, SEGREDO));
});

caso('JWT: sem sub ou com sub inseguro é recusado', function (): void {
    lanca('invalid_token', fn () => Jwt::decode(Jwt::encode(['exp' => \time() + 60], SEGREDO), SEGREDO));
    lanca('invalid_token', fn () => Jwt::decode(Jwt::encode(['sub' => '../etc', 'exp' => \time() + 60], SEGREDO), SEGREDO));
});

caso('JWT: alg none e HS512 são recusados', function (): void {
    $p = \rtrim(\strtr(\base64_encode('{"sub":"acc_1","exp":' . (\time() + 60) . '}'), '+/', '-_'), '=');
    foreach (['none', 'HS512', 'RS256'] as $alg) {
        $h = \rtrim(\strtr(\base64_encode('{"alg":"' . $alg . '","typ":"JWT"}'), '+/', '-_'), '=');
        $s = \rtrim(\strtr(\base64_encode(\hash_hmac('sha256', "{$h}.{$p}", SEGREDO, true)), '+/', '-_'), '=');
        lanca('invalid_token', fn () => Jwt::decode("{$h}.{$p}.{$s}", SEGREDO));
    }
});

caso('JWT: iss e aud são conferidos quando configurados', function (): void {
    $t = Jwt::encode(['sub' => 'acc_1', 'exp' => \time() + 60, 'iss' => 'scc-gateway', 'aud' => ['scc-builder']], SEGREDO);
    igual('acc_1', Jwt::decode($t, SEGREDO, ['issuer' => 'scc-gateway', 'audience' => 'scc-builder'])['sub']);
    lanca('invalid_token', fn () => Jwt::decode($t, SEGREDO, ['issuer' => 'outro']));
    lanca('invalid_token', fn () => Jwt::decode($t, SEGREDO, ['audience' => 'outro']));
});

caso('JWT: nbf no futuro é recusado', function (): void {
    $t = Jwt::encode(['sub' => 'acc_1', 'exp' => \time() + 600, 'nbf' => \time() + 300], SEGREDO);
    lanca('invalid_token', fn () => Jwt::decode($t, SEGREDO));
});

caso('JWT: malformado e sem segredo', function (): void {
    lanca('invalid_token', fn () => Jwt::decode('a.b', SEGREDO));
    lanca('invalid_token', fn () => Jwt::decode('###.###.###', SEGREDO));
    lanca('jwt_not_configured', fn () => Jwt::decode(Jwt::encode(['sub' => 'a', 'exp' => \time() + 9], SEGREDO), ''));
});

caso('Security: Bearer JWT escopa os jobs pelo account_id', function (): void {
    configurar(['jwt_secret' => SEGREDO, 'api_keys' => ['world' => 'chave-world']]);
    $t = Jwt::encode(['sub' => '0xJogador', 'exp' => \time() + 60, 'builder_company_id' => 'cmp_7'], SEGREDO);
    Security::authenticate(['HTTP_AUTHORIZATION' => "Bearer {$t}"]);
    igual('jwt', Security::method());
    igual('0xJogador', Security::owner());
    igual('cmp_7', Security::builderCompanyId());
});

caso('Security: JWT inválido não cai para API key', function (): void {
    configurar(['jwt_secret' => SEGREDO, 'api_keys' => ['world' => 'chave-world']]);
    $t = Jwt::encode(['sub' => 'acc', 'exp' => \time() + 60], 'errado');
    lanca('invalid_token', fn () => Security::authenticate(['HTTP_AUTHORIZATION' => "Bearer {$t}", 'HTTP_X_API_KEY' => 'chave-world']));
});

caso('Security: API key servidor a servidor, com e sem X-Account-Id', function (): void {
    configurar(['jwt_secret' => SEGREDO, 'api_keys' => ['world' => 'chave-world']]);
    Security::authenticate(['HTTP_X_API_KEY' => 'chave-world']);
    igual('api_key', Security::method());
    igual('key:world', Security::owner());

    Security::authenticate(['HTTP_X_API_KEY' => 'chave-world', 'HTTP_X_ACCOUNT_ID' => '0xJogador']);
    igual('0xJogador', Security::owner());

    Security::authenticate(['HTTP_AUTHORIZATION' => 'Bearer chave-world']);
    igual('key:world', Security::owner());

    lanca('invalid_account_id', fn () => Security::authenticate(['HTTP_X_API_KEY' => 'chave-world', 'HTTP_X_ACCOUNT_ID' => 'a/b']));
    lanca('invalid_api_key', fn () => Security::authenticate(['HTTP_X_API_KEY' => 'chave-errada']));
});

caso('Security: sem credencial é 401, a menos que allow_public', function (): void {
    configurar(['jwt_secret' => SEGREDO]);
    lanca('missing_credentials', fn () => Security::authenticate([]));

    configurar(['allow_public' => true]);
    Security::authenticate([]);
    igual('public', Security::owner());
    verdade(Config::isConfigured());
});

caso('Config: só jwt_secret já configura a API', function (): void {
    configurar(['jwt_secret' => SEGREDO, 'api_keys' => [], 'allow_public' => false]);
    verdade(Config::isConfigured());
    configurar(['jwt_secret' => '', 'api_keys' => [], 'allow_public' => false]);
    verdade(!Config::isConfigured());
});
