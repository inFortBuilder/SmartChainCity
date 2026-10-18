<?php
/**
 * Inicialização comum a todas as páginas e endpoints.
 */
declare(strict_types=1);

error_reporting(E_ALL);

$GLOBALS['scc_config'] = require __DIR__ . '/config.php';
ini_set('display_errors', $GLOBALS['scc_config']['app']['env'] === 'dev' ? '1' : '0');

require __DIR__ . '/lib/helpers.php';
require __DIR__ . '/lib/icons.php';
require __DIR__ . '/lib/GameData.php';

if (session_status() === PHP_SESSION_NONE && PHP_SAPI !== 'cli') {
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
}

if (PHP_SAPI !== 'cli') {
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Frame-Options: SAMEORIGIN');
}
