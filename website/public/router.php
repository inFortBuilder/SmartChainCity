<?php
// Roteador para o servidor embutido do PHP (desenvolvimento):
//   php -S localhost:8080 -t public public/router.php
// Em produção (Apache/Nginx) use o .htaccess ou a configuração equivalente.
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$file = __DIR__ . $path;

if ($path === '/router.php') {
    require __DIR__ . '/404.php';
    return true;
}
if ($path !== '/' && is_file($file)) {
    return false; // arquivo estático ou .php existente
}
if ($path === '/') {
    require __DIR__ . '/index.php';
    return true;
}
// URLs amigáveis: /tutorial → tutorial.php
$php = __DIR__ . rtrim($path, '/') . '.php';
if (is_file($php) && str_starts_with(realpath($php) ?: '', __DIR__)) {
    $_SERVER['SCRIPT_NAME'] = rtrim($path, '/') . '.php';
    require $php;
    return true;
}
require __DIR__ . '/404.php';
return true;
