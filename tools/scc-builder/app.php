<?php
/**
 * app.php — entrega o build da SPA (dist/index.html).
 *
 * O editor em si é público: ele só converte e visualiza no browser. O que
 * é do jogador — enviar, listar, baixar e validar no lote — passa pela API,
 * que exige o JWT do gateway SCC em cada chamada (Security::guard()). Não
 * existe sessão de servidor nem cookie: o JWT chega pelo link do jogo
 * (#token=…) e o cliente o manda em Authorization: Bearer.
 */

$index = __DIR__ . '/dist/index.html';

if (!is_file($index))
{
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Build não encontrado. Rode 'npm run build' em tools/scc-builder/.\n");
}

header('Content-Type: text/html; charset=utf-8');

// O cache é do build (assets com hash), não do HTML: um HTML cacheado
// prenderia o jogador numa versão antiga.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// Pode ser embutido só pela própria origem (o cliente web do jogo, se
// servido no mesmo domínio).
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

readfile($index);
