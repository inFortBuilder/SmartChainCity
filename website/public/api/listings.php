<?php
// GET /api/listings.php?category=property|land|avatar|item|all
declare(strict_types=1);
require __DIR__ . '/../../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'method_not_allowed'], 405);
}

$allowed  = ['all', 'property', 'land', 'avatar', 'item'];
$category = (string) ($_GET['category'] ?? 'all');
if (!in_array($category, $allowed, true)) {
    json_response(['error' => 'invalid_category', 'allowed' => $allowed], 400);
}

json_response(['category' => $category, 'items' => GameData::listings($category)]);
