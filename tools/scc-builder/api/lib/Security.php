<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Porta de entrada de segurança: CORS com allowlist, autenticação e rate
 * limiting por identidade/IP.
 *
 * Duas formas de autenticar, e só elas:
 *
 *   · JWT do gateway SCC (login SIWE) em `Authorization: Bearer <jwt>` —
 *     o caminho do jogador. O claim `sub` é o account_id, que escopa os
 *     jobs: cada jogador só enxerga os próprios modelos.
 *   · API key em `X-API-Key` (ou `Bearer <chave>`) — chamadas servidor a
 *     servidor, como o serviço World. A chave pode agir em nome de um
 *     jogador informando `X-Account-Id`; sem ele, o escopo é a própria chave.
 *
 * Corrige C2 da auditoria (API totalmente aberta).
 */
final class Security
{
    /** Identidade autenticada: 'jwt', 'api_key' ou 'public'. */
    private static ?string $metodo = null;

    /** Nome da API key usada (índice em api_keys), quando for o caso. */
    private static ?string $apiKeyId = null;

    private static ?string $accountId = null;

    private static ?string $builderCompanyId = null;

    /**
     * Aplica CORS, headers de segurança e responde preflight.
     * Deve ser a primeira coisa executada em qualquer endpoint.
     */
    public static function applyCors(): void
    {
        $allowed = (array) Config::get('cors_origins', []);
        $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';

        if ($origin !== '') {
            $isAllowed = \in_array($origin, $allowed, true)
                || (\in_array('*', $allowed, true) && Config::get('allow_public') === true);

            if ($isAllowed) {
                \header('Access-Control-Allow-Origin: ' . $origin);
                \header('Vary: Origin');
            }
        }

        \header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
        \header('Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Key, X-Account-Id, X-Requested-With');
        \header('Access-Control-Max-Age: 600');

        // Headers de endurecimento
        \header('X-Content-Type-Options: nosniff');
        \header('X-Frame-Options: SAMEORIGIN');
        \header('Referrer-Policy: no-referrer');
        \header_remove('X-Powered-By');

        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            \http_response_code(204);
            exit;
        }
    }

    /**
     * Exige JWT do gateway ou API key válida, a menos que allow_public
     * esteja ativo. Encerra a requisição com 401/403 quando falha.
     */
    public static function requireAuth(): void
    {
        if (!Config::isConfigured()) {
            Response::error(
                'not_configured',
                'A API não foi configurada. Copie api/config.local.example.php para '
                    . 'api/config.local.php e defina "jwt_secret" e/ou ao menos uma chave em "api_keys".',
                503
            );
        }

        try {
            self::authenticate($_SERVER);
        } catch (ValidationException $e) {
            Logger::warning('Autenticação recusada', ['motivo' => $e->errorCode()]);
            Response::error($e->errorCode(), $e->getMessage(), $e->statusCode());
        }
    }

    /**
     * A autenticação em si, sem efeito colateral de resposta — testável.
     *
     * @param array<string,mixed> $server o $_SERVER da requisição
     *
     * @throws ValidationException
     */
    public static function authenticate(array $server): void
    {
        self::reset();

        $bearer = '';
        $auth   = (string) ($server['HTTP_AUTHORIZATION'] ?? $server['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if (\preg_match('/^Bearer\s+(.+)$/i', $auth, $m) === 1) {
            $bearer = \trim($m[1]);
        }

        // 1. JWT do jogador
        if ($bearer !== '' && Jwt::pareceJwt($bearer)) {
            $claims = Jwt::decode($bearer, (string) Config::get('jwt_secret', ''), [
                'issuer'   => Config::get('jwt_issuer'),
                'audience' => Config::get('jwt_audience'),
                'leeway'   => (int) Config::get('jwt_leeway', 30),
            ]);

            self::$metodo    = 'jwt';
            self::$accountId = (string) $claims['sub'];

            $empresa = $claims['builder_company_id'] ?? null;
            if ((\is_string($empresa) || \is_int($empresa)) && Jwt::accountIdValido((string) $empresa)) {
                self::$builderCompanyId = (string) $empresa;
            }

            return;
        }

        // 2. API key, servidor a servidor
        $key = \trim((string) ($server['HTTP_X_API_KEY'] ?? ''));
        if ($key === '') {
            $key = $bearer;
        }

        if ($key !== '') {
            /** @var array<int|string,string> $keys */
            $keys = (array) Config::get('api_keys', []);
            foreach ($keys as $id => $valor) {
                if (\is_string($valor) && $valor !== '' && \hash_equals($valor, $key)) {
                    self::$metodo   = 'api_key';
                    self::$apiKeyId = \is_string($id) ? $id : 'key' . $id;

                    $conta = \trim((string) ($server['HTTP_X_ACCOUNT_ID'] ?? ''));
                    if ($conta !== '') {
                        if (!Jwt::accountIdValido($conta)) {
                            throw new ValidationException('invalid_account_id', 'X-Account-Id inválido.', 400);
                        }
                        self::$accountId = $conta;
                    }

                    return;
                }
            }

            throw new ValidationException('invalid_api_key', 'Chave de API inválida.', 403);
        }

        // 3. Desenvolvimento local, sem credencial
        if (Config::get('allow_public') === true) {
            self::$metodo = 'public';

            return;
        }

        throw new ValidationException(
            'missing_credentials',
            'Envie Authorization: Bearer <JWT SCC> ou o header X-API-Key.',
            401
        );
    }

    /** Como a requisição se autenticou: 'jwt', 'api_key', 'public' ou 'anonymous'. */
    public static function method(): string
    {
        return self::$metodo ?? 'anonymous';
    }

    public static function apiKeyId(): string
    {
        return self::$apiKeyId ?? self::method();
    }

    /** account_id do jogador (JWT ou X-Account-Id), ou null. */
    public static function accountId(): ?string
    {
        return self::$accountId;
    }

    /** Empresa construtora do jogador (claim opcional builder_company_id). */
    public static function builderCompanyId(): ?string
    {
        return self::$builderCompanyId;
    }

    /**
     * O DONO dos jobs, para escopar o que cada um vê.
     *
     * É o account_id do jogador. Uma API key sem X-Account-Id é dona dos
     * próprios jobs ("key:<nome>"), como no Convert3D original. Como é o
     * MESMO dono na escrita e na leitura, os jobs nascem e são lidos sob a
     * mesma identidade.
     */
    public static function owner(): string
    {
        if (self::$accountId !== null) {
            return self::$accountId;
        }

        return self::$apiKeyId !== null ? 'key:' . self::$apiKeyId : self::method();
    }

    /**
     * Rate limit por janela fixa, persistido em arquivo.
     * Suficiente para Apache sem Redis.
     */
    public static function enforceRateLimit(): void
    {
        $limit  = (int) Config::get('rate_limit_requests', 60);
        $window = (int) Config::get('rate_limit_window', 60);

        if ($limit <= 0) {
            return;
        }

        $dir = Config::get('storage_dir') . '/ratelimit';
        if (!\is_dir($dir)) {
            @\mkdir($dir, 0o750, true);
        }

        $bucket = \floor(\time() / $window);
        $id     = \hash('sha256', self::owner() . '|' . self::clientIp());
        $file   = $dir . '/' . $id . '-' . $bucket . '.cnt';

        $count = 0;
        $fh    = @\fopen($file, 'c+');
        if ($fh === false) {
            return; // não bloqueia a API se o disco falhar
        }

        if (\flock($fh, LOCK_EX)) {
            $count = (int) \stream_get_contents($fh) + 1;
            \ftruncate($fh, 0);
            \rewind($fh);
            \fwrite($fh, (string) $count);
            \flock($fh, LOCK_UN);
        }
        \fclose($fh);

        \header('X-RateLimit-Limit: ' . $limit);
        \header('X-RateLimit-Remaining: ' . \max(0, $limit - $count));

        if ($count > $limit) {
            \header('Retry-After: ' . $window);
            Response::error(
                'rate_limited',
                "Limite de {$limit} requisições a cada {$window}s excedido.",
                429
            );
        }

        // Limpeza oportunista de janelas antigas (1 em 50 requisições)
        if (\random_int(1, 50) === 1) {
            foreach ((array) \glob($dir . '/*.cnt') as $old) {
                if (\is_string($old) && \filemtime($old) < \time() - ($window * 5)) {
                    @\unlink($old);
                }
            }
        }
    }

    public static function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? 'cli');
    }

    /** Atalho: CORS + autenticação + rate limit. */
    public static function guard(): void
    {
        self::applyCors();
        self::requireAuth();
        self::enforceRateLimit();
    }

    /** Descarta a identidade da requisição anterior. Usado pelos testes. */
    public static function reset(): void
    {
        self::$metodo           = null;
        self::$apiKeyId         = null;
        self::$accountId        = null;
        self::$builderCompanyId = null;
    }
}
