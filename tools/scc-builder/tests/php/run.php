<?php

declare(strict_types=1);

/**
 * Roda todos os tests/php/test-*.php.  Uso:  php tests/php/run.php
 * Sai com código 1 se algum caso falhar.
 */

require __DIR__ . '/bootstrap.php';

foreach (\glob(__DIR__ . '/test-*.php') ?: [] as $arquivo) {
    require $arquivo;
}

$falhas = 0;
foreach ($GLOBALS['scc_casos'] as [$nome, $fn]) {
    try {
        $fn();
        echo "  ok    {$nome}\n";
    } catch (\Throwable $e) {
        $falhas++;
        echo "  FALHA {$nome}\n        " . $e->getMessage() . ' (' . \basename($e->getFile()) . ':' . $e->getLine() . ")\n";
    }
}

\SccBuilder\Api\Database::reset();
apagarPasta($GLOBALS['scc_tmp']);

$total = \count($GLOBALS['scc_casos']);
echo "\n{$total} casos, {$falhas} falha(s).\n";
exit($falhas === 0 ? 0 : 1);
