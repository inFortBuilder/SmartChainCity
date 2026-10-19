<?php

declare(strict_types=1);

/**
 * GET /api/health.php — diagnóstico da instalação.
 *
 * Responde sem exigir API key para permitir checagem de disponibilidade,
 * mas só revela detalhes do ambiente quando autenticado.
 */

require_once __DIR__ . '/config.php';

use SccBuilder\Api\Config;
use SccBuilder\Api\ConversionRunner;
use SccBuilder\Api\Database;
use SccBuilder\Api\Response;
use SccBuilder\Api\Security;
use SccBuilder\Api\Storage;

Security::applyCors();

$authenticated = false;
$provided      = \trim((string) ($_SERVER['HTTP_X_API_KEY'] ?? ''));

foreach ((array) Config::get('api_keys', []) as $key) {
    if (\is_string($key) && $key !== '' && \hash_equals($key, $provided)) {
        $authenticated = true;
        break;
    }
}
if (Config::get('allow_public') === true) {
    $authenticated = true;
}

$payload = [
    'service'   => 'scc-builder-api',
    'version'   => Config::get('version'),
    'status'    => Config::isConfigured() ? 'ok' : 'not_configured',
    'timestamp' => \date('c'),
];

if ($authenticated) {
    $node = ConversionRunner::resolveNodeBinary();

    $dbOk = false;
    try {
        Database::pdo()->query('SELECT 1');
        $dbOk = true;
    } catch (\Throwable) {
        $dbOk = false;
    }

    $payload['checks'] = [
        'php_version'          => \PHP_VERSION,
        'pdo_sqlite'           => \extension_loaded('pdo_sqlite'),
        'database_writable'    => $dbOk,
        'node_binary'          => $node,
        'node_available'       => $node !== null,
        'storage_dir'          => Storage::root(),
        'storage_writable'     => \is_writable(Storage::root()),
        'storage_inside_webroot' => Storage::isInsideWebroot(),
        'upload_max_filesize'  => \ini_get('upload_max_filesize'),
        'post_max_size'        => \ini_get('post_max_size'),
        'max_execution_time'   => \ini_get('max_execution_time'),
        'memory_limit'         => \ini_get('memory_limit'),
        'input_formats'        => Config::get('input_formats'),
        'output_formats'       => Config::get('output_formats'),
        'queue_enabled'        => Config::get('queue_enabled'),
    ];

    // Módulos do Apache — só visíveis quando o PHP roda como módulo.
    // Sem mod_rewrite o roteamento do .htaccess não funciona; sem
    // mod_headers os headers de segurança e cache não são aplicados.
    if (\function_exists('apache_get_modules')) {
        $modulos = \apache_get_modules();

        $payload['checks']['apache'] = [
            'sapi'        => \PHP_SAPI,
            'rewrite'     => \in_array('mod_rewrite', $modulos, true),
            'headers'     => \in_array('mod_headers', $modulos, true),
            'deflate'     => \in_array('mod_deflate', $modulos, true),
            'expires'     => \in_array('mod_expires', $modulos, true),
        ];
    } else {
        $payload['checks']['apache'] = ['sapi' => \PHP_SAPI, 'modules' => 'indisponível'];
    }

    $warnings = [];

    foreach (['rewrite' => 'roteamento', 'headers' => 'headers de segurança'] as $modulo => $funcao) {
        if (($payload['checks']['apache'][$modulo] ?? true) === false) {
            $warnings[] = "mod_{$modulo} desativado no Apache — o {$funcao} do .htaccess "
                . 'não será aplicado. Ative em: ícone WAMP → Apache → Apache modules.';
        }
    }

    if (!$payload['checks']['node_available']) {
        $warnings[] = 'Node.js não localizado — a conversão no servidor não funcionará.';
    }
    if ($payload['checks']['storage_inside_webroot']) {
        $warnings[] = 'O storage está dentro do webroot. Mova-o para fora por segurança.';
    }
    if (!$payload['checks']['pdo_sqlite']) {
        $warnings[] = 'A extensão pdo_sqlite não está habilitada.';
    }
    if (Config::get('allow_public') === true) {
        $warnings[] = 'allow_public está ativo: a API aceita requisições sem chave.';
    }

    $payload['warnings'] = $warnings;
}

Response::success($payload);
