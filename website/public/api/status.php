<?php
// GET /api/status.php — travas de incidente do jogo (saque e câmbio), para o aviso no topo do site (E4.6).
declare(strict_types=1);
require __DIR__ . '/../../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'method_not_allowed'], 405);
}
header('Cache-Control: public, max-age=30');
json_response(['switches' => GameData::status()]);
