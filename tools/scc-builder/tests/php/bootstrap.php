<?php

declare(strict_types=1);

/**
 * Base dos testes PHP — sem PHPUnit, para rodar com o mesmo PHP do servidor:
 *
 *   php tests/php/run.php
 *
 * Cada arquivo test-*.php registra casos com caso('nome', fn) e usa
 * igual()/verdade()/lanca() para conferir.
 */

\error_reporting(\E_ALL);
\ini_set('display_errors', '1');

// Storage temporário: os testes nunca tocam o storage real.
$GLOBALS['scc_tmp'] = \sys_get_temp_dir() . '/scc-builder-testes-' . \bin2hex(\random_bytes(4));
\mkdir($GLOBALS['scc_tmp'], 0o777, true);
\putenv('SCC_BUILDER_STORAGE_DIR=' . $GLOBALS['scc_tmp']);

\spl_autoload_register(static function (string $class): void {
    $prefix = 'SccBuilder\\Api\\';
    if (\str_starts_with($class, $prefix)) {
        $file = \dirname(__DIR__, 2) . '/api/lib/' . \substr($class, \strlen($prefix)) . '.php';
        if (\is_file($file)) {
            require_once $file;
        }
    }
});

/** @var array<int,array{0:string,1:callable}> */
$GLOBALS['scc_casos'] = [];

function caso(string $nome, callable $fn): void
{
    $GLOBALS['scc_casos'][] = [$nome, $fn];
}

final class FalhaDeTeste extends \RuntimeException
{
}

function igual(mixed $esperado, mixed $obtido, string $msg = ''): void
{
    if ($esperado !== $obtido) {
        throw new FalhaDeTeste(\trim($msg . ' esperado ' . \var_export($esperado, true) . ', obtido ' . \var_export($obtido, true)));
    }
}

function perto(float $esperado, float $obtido, float $tol = 1e-6, string $msg = ''): void
{
    if (\abs($esperado - $obtido) > $tol) {
        throw new FalhaDeTeste(\trim("{$msg} esperado {$esperado}, obtido {$obtido}"));
    }
}

function verdade(bool $cond, string $msg = 'condição falsa'): void
{
    if (!$cond) {
        throw new FalhaDeTeste($msg);
    }
}

/**
 * Exige que $fn lance ValidationException com o código dado.
 */
function lanca(string $codigo, callable $fn): void
{
    try {
        $fn();
    } catch (\SccBuilder\Api\ValidationException $e) {
        igual($codigo, $e->errorCode(), 'código do erro:');

        return;
    }

    throw new FalhaDeTeste("esperava ValidationException {$codigo}, nada foi lançado");
}

/** Configuração limpa + sobrescritas, para cada caso. */
function configurar(array $valores = []): void
{
    \SccBuilder\Api\Config::reset();
    \SccBuilder\Api\Config::override($valores + ['storage_dir' => $GLOBALS['scc_tmp']]);
}

function apagarPasta(string $dir): void
{
    if (!\is_dir($dir)) {
        return;
    }
    foreach (new \RecursiveIteratorIterator(
        new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
        \RecursiveIteratorIterator::CHILD_FIRST
    ) as $item) {
        $item->isDir() ? @\rmdir($item->getPathname()) : @\unlink($item->getPathname());
    }
    @\rmdir($dir);
}
