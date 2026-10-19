<?php

declare(strict_types=1);

/**
 * SCC Builder — bootstrap da API.
 *
 * Este arquivo NÃO contém segredos e NÃO aplica CORS por conta própria.
 * Cada endpoint chama Security::guard() explicitamente.
 *
 * Configuração local: copie config.local.example.php → config.local.php
 */

use SccBuilder\Api\Config;
use SccBuilder\Api\Logger;
use SccBuilder\Api\Response;
use SccBuilder\Api\Storage;
use SccBuilder\Api\ValidationException;

if (\PHP_VERSION_ID < 80100) {
    \http_response_code(500);
    exit('SCC Builder requer PHP 8.1 ou superior. Versão atual: ' . \PHP_VERSION);
}

// ── Autoload PSR-4 simples para SccBuilder\Api\* ──────────────────────────
\spl_autoload_register(static function (string $class): void {
    $prefix = 'SccBuilder\\Api\\';
    if (!\str_starts_with($class, $prefix)) {
        return;
    }

    $relative = \substr($class, \strlen($prefix));
    $file     = __DIR__ . '/lib/' . \str_replace('\\', '/', $relative) . '.php';

    if (\is_file($file)) {
        require_once $file;
    }
});

// ── Erros nunca vazam para o corpo da resposta ───────────────────────────
\ini_set('display_errors', '0');
\ini_set('log_errors', '1');
\error_reporting(\E_ALL);

\set_exception_handler(static function (\Throwable $e): void {
    Logger::error('Exceção não tratada', [
        'type'    => $e::class,
        'message' => $e->getMessage(),
        'file'    => $e->getFile(),
        'line'    => $e->getLine(),
    ]);

    if ($e instanceof ValidationException) {
        Response::error($e->errorCode(), $e->getMessage(), $e->statusCode());
    }

    Response::error(
        'internal_error',
        Config::get('debug') === true
            ? $e->getMessage()
            : 'Erro interno. Consulte os logs do servidor com o request_id acima.',
        500
    );
});

\register_shutdown_function(static function (): void {
    $err = \error_get_last();
    if ($err !== null && \in_array($err['type'], [\E_ERROR, \E_PARSE, \E_CORE_ERROR, \E_COMPILE_ERROR], true)) {
        Logger::error('Erro fatal', $err);
    }
});

// ── Storage ──────────────────────────────────────────────────────────────
Storage::bootstrap();

// Limpeza oportunista por retenção (1 em 200 requisições)
if (\random_int(1, 200) === 1) {
    Storage::purgeExpired();
}

// ── Constantes de compatibilidade com a v1 do Convert3D ─────────────────
\define('SCC_BUILDER_VERSION', (string) Config::get('version'));
\define('BASE_DIR', \dirname(__DIR__));
\define('STORAGE_DIR', Storage::root());
\define('UPLOAD_DIR', Storage::root() . '/' . Storage::UPLOADS);
\define('CONVERTED_DIR', Storage::root() . '/' . Storage::CONVERTED);
\define('MAX_FILE_SIZE', (int) Config::get('max_file_size'));
