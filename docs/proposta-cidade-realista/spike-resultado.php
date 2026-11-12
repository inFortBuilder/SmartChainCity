<?php
// Recebe o resultado do ?spike vindo de outro aparelho da rede local (celular,
// notebook) e grava uma linha em .local/spike/resultados.jsonl, para não
// depender de print. Só para o servidor de desenvolvimento (php -S); o
// protótipo não tem backend e .local/ não é versionado.
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('{"ok":false,"erro":"use POST"}');
}

$raw = (string) file_get_contents('php://input', false, null, 0, 20000);
$data = json_decode($raw, true);
if (!is_array($data) || !isset($data['withBuildings'], $data['city'])) {
    http_response_code(400);
    exit('{"ok":false,"erro":"resultado fora do formato"}');
}

$data['recebido_em'] = gmdate('c');
$data['ip'] = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$data['user_agent'] = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300);

$dir = dirname(__DIR__, 2) . '/.local/spike';
if (!is_dir($dir) && !mkdir($dir, 0777, true) && !is_dir($dir)) {
    http_response_code(500);
    exit('{"ok":false,"erro":"sem pasta .local/spike"}');
}
file_put_contents($dir . '/resultados.jsonl', json_encode($data, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
echo '{"ok":true}';
