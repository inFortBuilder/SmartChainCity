<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Validação do JWT emitido pelo gateway da Smart Chain City (login SIWE).
 *
 * Só HS256, de propósito: aceitar o "alg" que vem no cabeçalho do token é a
 * falha clássica do JWT ("alg": "none", ou RS256 tratado como HMAC). O
 * algoritmo é fixo do lado do servidor e o cabeçalho só é conferido.
 *
 * Claims exigidos: sub (account_id do jogador) e exp. iss e aud são
 * conferidos quando configurados; nbf e iat, quando presentes.
 */
final class Jwt
{
    /**
     * @param array{issuer?:string|null, audience?:string|null, leeway?:int, now?:int} $opcoes
     *
     * @return array<string,mixed> os claims do token
     *
     * @throws ValidationException token ausente, malformado, com assinatura
     *                             errada, expirado ou sem os claims exigidos
     */
    public static function decode(string $token, string $segredo, array $opcoes = []): array
    {
        if ($segredo === '') {
            throw new ValidationException('jwt_not_configured', 'Segredo do JWT não configurado (jwt_secret).', 503);
        }

        $partes = \explode('.', $token);
        if (\count($partes) !== 3) {
            throw new ValidationException('invalid_token', 'Token malformado.', 401);
        }

        [$h64, $p64, $s64] = $partes;

        $cabecalho = self::json($h64);
        $claims    = self::json($p64);
        $assinatura = self::base64UrlDecode($s64);

        if (($cabecalho['alg'] ?? null) !== 'HS256') {
            throw new ValidationException('invalid_token', 'Algoritmo do token não aceito (só HS256).', 401);
        }

        $esperada = \hash_hmac('sha256', $h64 . '.' . $p64, $segredo, true);
        if ($assinatura === null || !\hash_equals($esperada, $assinatura)) {
            throw new ValidationException('invalid_token', 'Assinatura do token inválida.', 401);
        }

        $agora  = (int) ($opcoes['now'] ?? \time());
        $folga  = \max(0, (int) ($opcoes['leeway'] ?? 30));

        if (!isset($claims['exp']) || !\is_numeric($claims['exp'])) {
            throw new ValidationException('invalid_token', 'Token sem expiração (exp).', 401);
        }
        if ($agora - $folga >= (int) $claims['exp']) {
            throw new ValidationException('token_expired', 'Token expirado.', 401);
        }
        if (isset($claims['nbf']) && \is_numeric($claims['nbf']) && $agora + $folga < (int) $claims['nbf']) {
            throw new ValidationException('invalid_token', 'Token ainda não é válido (nbf).', 401);
        }
        if (isset($claims['iat']) && \is_numeric($claims['iat']) && $agora + $folga < (int) $claims['iat']) {
            throw new ValidationException('invalid_token', 'Token emitido no futuro (iat).', 401);
        }

        $sub = $claims['sub'] ?? null;
        if (!\is_string($sub) || !self::accountIdValido($sub)) {
            throw new ValidationException('invalid_token', 'Token sem account_id válido (sub).', 401);
        }

        $emissor = $opcoes['issuer'] ?? null;
        if (\is_string($emissor) && $emissor !== '' && ($claims['iss'] ?? null) !== $emissor) {
            throw new ValidationException('invalid_token', 'Emissor do token não aceito (iss).', 401);
        }

        $publico = $opcoes['audience'] ?? null;
        if (\is_string($publico) && $publico !== '') {
            $aud = $claims['aud'] ?? null;
            $ok  = \is_array($aud) ? \in_array($publico, $aud, true) : $aud === $publico;
            if (!$ok) {
                throw new ValidationException('invalid_token', 'Público do token não aceito (aud).', 401);
            }
        }

        return $claims;
    }

    /**
     * Gera um token HS256. Usado pelos testes e pelo instalador para emitir
     * um token de desenvolvimento — em produção quem assina é o gateway.
     *
     * @param array<string,mixed> $claims
     */
    public static function encode(array $claims, string $segredo): string
    {
        $h64 = self::base64UrlEncode((string) \json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $p64 = self::base64UrlEncode((string) \json_encode($claims, \JSON_UNESCAPED_SLASHES));
        $sig = self::base64UrlEncode(\hash_hmac('sha256', $h64 . '.' . $p64, $segredo, true));

        return $h64 . '.' . $p64 . '.' . $sig;
    }

    /** Parece um JWT (três partes base64url)? Distingue do Bearer de API key. */
    public static function pareceJwt(string $token): bool
    {
        return \preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/', $token) === 1;
    }

    /**
     * O account_id vira pasta no storage e chave no bucket: só caracteres
     * seguros (UUID, endereço 0x…, id numérico).
     */
    public static function accountIdValido(string $id): bool
    {
        return \preg_match('/^[A-Za-z0-9_.:-]{1,128}$/', $id) === 1;
    }

    // ── interno ──────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private static function json(string $parte): array
    {
        $bruto = self::base64UrlDecode($parte);
        $dados = $bruto === null ? null : \json_decode($bruto, true);

        if (!\is_array($dados)) {
            throw new ValidationException('invalid_token', 'Token malformado.', 401);
        }

        return $dados;
    }

    private static function base64UrlEncode(string $dados): string
    {
        return \rtrim(\strtr(\base64_encode($dados), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $dados): ?string
    {
        $resto = \strlen($dados) % 4;
        if ($resto === 1) {
            return null;
        }
        if ($resto > 0) {
            $dados .= \str_repeat('=', 4 - $resto);
        }

        $bruto = \base64_decode(\strtr($dados, '-_', '+/'), true);

        return $bruto === false ? null : $bruto;
    }
}
