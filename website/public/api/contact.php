<?php
// POST /api/contact.php — recebe o formulário de contato.
// Proteções: CSRF, honeypot, limite por sessão, validação e tamanho máximo.
// As mensagens são gravadas em storage/contact.jsonl (fora da pasta pública).
declare(strict_types=1);
require __DIR__ . '/../../src/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}
if (!csrf_valid($_POST['csrf'] ?? null)) {
    json_response(['ok' => false, 'error' => 'Sessão expirada. Recarregue a página e tente de novo.'], 403);
}
// Honeypot: robôs preenchem o campo oculto; respondemos "ok" sem gravar.
if (!empty($_POST['website'])) {
    json_response(['ok' => true]);
}

$wait = (int) cfg('contact.rate_limit_sec', 60);
if (isset($_SESSION['contact_at']) && time() - $_SESSION['contact_at'] < $wait) {
    json_response(['ok' => false, 'error' => 'Aguarde um minuto antes de enviar outra mensagem.'], 429);
}

$name    = trim((string) ($_POST['name'] ?? ''));
$email   = trim((string) ($_POST['email'] ?? ''));
$topic   = (string) ($_POST['topic'] ?? 'suporte');
$message = trim((string) ($_POST['message'] ?? ''));

$errors = [];
if ($name === '' || mb_strlen($name) > 120)            { $errors['name'] = 'Informe seu nome.'; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL))        { $errors['email'] = 'Informe um e-mail válido.'; }
if (!in_array($topic, ['suporte', 'parceria', 'guilda', 'criador', 'imprensa'], true)) { $topic = 'suporte'; }
if ($message === '' || mb_strlen($message) > 2000)     { $errors['message'] = 'Escreva uma mensagem de até 2000 caracteres.'; }
if ($errors) {
    json_response(['ok' => false, 'error' => 'Confira os campos destacados.', 'fields' => $errors], 422);
}

$file = cfg('contact.storage');
$dir  = dirname($file);
if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
    json_response(['ok' => false, 'error' => 'Não foi possível registrar agora. Tente mais tarde.'], 500);
}

$record = [
    'at'      => gmdate('c'),
    'name'    => $name,
    'email'   => $email,
    'topic'   => $topic,
    'message' => $message,
    'ip_hash' => hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . session_id()), // LGPD: não guardamos o IP em claro
];
file_put_contents($file, json_encode($record, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);

$_SESSION['contact_at'] = time();
json_response(['ok' => true, 'message' => 'Mensagem enviada! Responderemos pelo e-mail informado.']);
