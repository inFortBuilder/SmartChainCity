<?php
// GET /api/stats.php — estatísticas públicas da cidade (painel da home).
declare(strict_types=1);
require __DIR__ . '/../../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'method_not_allowed'], 405);
}
header('Cache-Control: public, max-age=60');
json_response(GameData::stats());
