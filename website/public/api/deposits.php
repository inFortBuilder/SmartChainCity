<?php
// GET /api/deposits.php?wallet=0x… — depósitos da carteira no GameVault (pelo chain-indexer), para a conta.
declare(strict_types=1);
require __DIR__ . '/../../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'method_not_allowed'], 405);
}
$wallet = (string) ($_GET['wallet'] ?? '');
if (!preg_match('/^0x[0-9a-fA-F]{40}$/', $wallet)) {
    json_response(['error' => 'invalid_wallet'], 400);
}
header('Cache-Control: no-store');
json_response(['deposits' => GameData::deposits($wallet)]);
