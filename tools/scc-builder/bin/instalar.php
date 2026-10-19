<?php

declare(strict_types=1);

/**
 * SCC Builder — instalador.
 *
 * Idempotente: pode ser executado várias vezes sem estragar nada. O que já
 * está configurado é preservado (e informado), o que falta é criado.
 *
 * O que faz:
 *   1. detecta o binário do Node e o caminho público da instalação;
 *   2. gera as chaves de API;
 *   3. escreve api/config.local.php e .env;
 *   4. cria o storage FORA do webroot e o protege;
 *   5. inicializa o banco SQLite;
 *   6. relata o que ainda depende de ação manual (php.ini, módulos Apache).
 *
 * Uso:
 *   php bin/instalar.php
 *   php bin/instalar.php --forcar-chaves     regenera as chaves
 *   php bin/instalar.php --storage=D:/c3d    define o storage
 *   php bin/instalar.php --base=/scc-builder/  caminho público
 */

if (\PHP_SAPI !== 'cli') {
    \http_response_code(403);
    exit('Este script só roda via linha de comando.');
}

$raiz = \dirname(__DIR__);
$opts = \getopt('', ['forcar-chaves', 'storage::', 'base::', 'url::', 'help']);

if (isset($opts['help'])) {
    echo <<<TXT

    SCC Builder — instalador

      --forcar-chaves    Gera novas chaves de API (invalida as atuais)
      --storage=<path>   Diretório de storage (padrão: ao lado do webroot)
      --base=<path>      Caminho público (padrão: detectado da pasta)
      --url=<url>        URL base da API (padrão: derivada de --base)
      --help             Esta ajuda


    TXT;
    exit(0);
}

function passo(string $texto): void
{
    echo \PHP_EOL, "\033[1;36m▸ ", $texto, "\033[0m", \PHP_EOL;
}

function ok(string $texto): void
{
    echo "  \033[32m✔\033[0m ", $texto, \PHP_EOL;
}

function info(string $texto): void
{
    echo "  \033[90m·\033[0m ", $texto, \PHP_EOL;
}

function aviso(string $texto): void
{
    echo "  \033[33m!\033[0m ", $texto, \PHP_EOL;
}

function erro(string $texto): void
{
    echo "  \033[31m✖\033[0m ", $texto, \PHP_EOL;
}

function chave(): string
{
    return \bin2hex(\random_bytes(32));
}

echo \PHP_EOL, "\033[1;36m  SCC Builder — instalador  \033[0m", \PHP_EOL;
echo '  ', $raiz, \PHP_EOL;

$pendencias = [];

// ─────────────────────────────────────────────────────────────────────────
passo('1. Detectando o ambiente');

info('PHP ' . \PHP_VERSION . ' (' . \PHP_OS_FAMILY . ')');

if (\PHP_VERSION_ID < 80100) {
    erro('SCC Builder exige PHP 8.1 ou superior.');
    exit(1);
}

// ── Node ────────────────────────────────────────────────────────────────
$node = null;
$candidatos = [];

$saidaWhere = [];
$comando = \str_starts_with(\PHP_OS_FAMILY, 'Win') ? 'where node' : 'which node';
@\exec($comando . ' 2>&1', $saidaWhere, $codigo);

if ($codigo === 0) {
    foreach ($saidaWhere as $linha) {
        $linha = \trim($linha);
        // O "where" do Windows lista .exe e .cmd; queremos o executável.
        if ($linha !== '' && \is_file($linha) && !\str_ends_with(\strtolower($linha), '.cmd')) {
            $candidatos[] = $linha;
        }
    }
}

$candidatos = \array_merge($candidatos, [
    'C:/Program Files/nodejs/node.exe',
    'C:/Program Files (x86)/nodejs/node.exe',
    '/usr/bin/node',
    '/usr/local/bin/node',
]);

foreach ($candidatos as $candidato) {
    if (\is_file($candidato)) {
        $node = \str_replace('\\', '/', $candidato);
        break;
    }
}

if ($node !== null) {
    $versao = \trim((string) @\shell_exec(\escapeshellarg($node) . ' --version 2>&1'));
    ok("Node encontrado: {$node} ({$versao})");

    if ((int) \ltrim(\explode('.', $versao)[0] ?? '0', 'v') < 18) {
        aviso('Node abaixo da versão 18 — atualize antes de usar em produção.');
        $pendencias[] = 'Atualizar o Node.js para a versão 18 ou superior.';
    }
} else {
    erro('Node.js não encontrado.');
    $node = 'C:/Program Files/nodejs/node.exe';
    $pendencias[] = 'Instalar o Node.js e corrigir "node_bin" em api/config.local.php.';
}

// ── Caminho público ─────────────────────────────────────────────────────
$pasta = \basename($raiz);
$base  = (string) ($opts['base'] ?? "/{$pasta}/");
$base  = '/' . \trim($base, '/') . '/';

if ($base === '//') {
    $base = '/';
}

ok("Caminho público: {$base}");

$urlApi = (string) ($opts['url'] ?? ('http://localhost' . $base . 'api'));
ok("URL da API: {$urlApi}");

// ── Storage ─────────────────────────────────────────────────────────────
// O padrão fica FORA do webroot: irmão da pasta www, não filho dela.
$storagePadrao = \dirname(\dirname($raiz)) . '/scc-builder-storage';
if (\str_contains(\str_replace('\\', '/', $raiz), '/www/')) {
    $wamp = \substr($raiz, 0, \strpos(\str_replace('\\', '/', $raiz), '/www/'));
    $storagePadrao = $wamp . '/scc-builder-storage';
}

$storage = \str_replace('\\', '/', (string) ($opts['storage'] ?? $storagePadrao));
$storage = \rtrim($storage, '/');

ok("Storage: {$storage}");

// ─────────────────────────────────────────────────────────────────────────
passo('2. Chaves de API');

$configLocal = $raiz . '/api/config.local.php';
$chaves = [];

if (\is_file($configLocal) && !isset($opts['forcar-chaves'])) {
    /** @var mixed $atual */
    $atual = require $configLocal;

    if (\is_array($atual) && !empty($atual['api_keys'])) {
        foreach ((array) $atual['api_keys'] as $id => $valor) {
            if (\is_string($valor) && \strlen($valor) >= 32 && !\str_contains($valor, 'TROQUE-ME')) {
                $chaves[$id] = $valor;
            }
        }
    }
}

if ($chaves === []) {
    // 'world': o serviço World chamando a API (servidor a servidor).
    // 'dev': o editor local, via VITE_API_KEY — nunca num build público.
    $chaves = ['world' => chave(), 'dev' => chave()];
    ok('Duas chaves geradas (world e dev)');
} else {
    ok(\count($chaves) . ' chave(s) existente(s) preservada(s)');
    info('Use --forcar-chaves para regerar.');
}

// Segredo HS256 do JWT. Em produção é o MESMO do gateway SCC; aqui nasce um
// local, para o bin/token-dev.php emitir tokens de teste.
$jwtSecret = '';
if (isset($atual) && \is_array($atual) && \is_string($atual['jwt_secret'] ?? null)
    && \strlen($atual['jwt_secret']) >= 32 && !\str_contains($atual['jwt_secret'], 'TROQUE-ME')
    && !isset($opts['forcar-chaves'])) {
    $jwtSecret = $atual['jwt_secret'];
    ok('jwt_secret existente preservado');
} else {
    $jwtSecret = chave();
    ok('jwt_secret local gerado (troque pelo do gateway SCC em produção)');
}

// ─────────────────────────────────────────────────────────────────────────
passo('3. api/config.local.php');

if (\is_file($configLocal)) {
    $backup = $configLocal . '.bak-' . \date('Ymd-His');
    \copy($configLocal, $backup);
    info('Backup: ' . \basename($backup));
}

$linhasChaves = '';
foreach ($chaves as $id => $valor) {
    $linhasChaves .= \sprintf("        %-12s => '%s',\n", "'{$id}'", $valor);
}

$host = \parse_url($urlApi, \PHP_URL_HOST) ?: 'localhost';
$esquema = \parse_url($urlApi, \PHP_URL_SCHEME) ?: 'http';
$porta = \parse_url($urlApi, \PHP_URL_PORT);
$origem = $esquema . '://' . $host . ($porta ? ':' . $porta : '');

$conteudo = <<<PHP
<?php

declare(strict_types=1);

/**
 * SCC Builder — configuração local.
 *
 * Gerado por bin/instalar.php em {$_SERVER['REQUEST_TIME']}.
 * NÃO versione este arquivo: ele contém as chaves de API.
 */

return [
    // ── Segurança ────────────────────────────────────────────────────────
    // JWT HS256 do gateway SCC (sub = account_id). Em produção, o segredo
    // do gateway.
    'jwt_secret'   => '{$jwtSecret}',
    'jwt_issuer'   => '',
    'jwt_audience' => '',

    // Servidor a servidor (X-API-Key, opcionalmente com X-Account-Id).
    'api_keys' => [
{$linhasChaves}    ],

    'cors_origins' => [
        '{$origem}',
        'http://localhost:5173',
    ],

    'allow_public' => false,

    'rate_limit_requests' => 60,
    'rate_limit_window'   => 60,

    // ── Armazenamento ────────────────────────────────────────────────────
    'storage_dir'    => '{$storage}',
    'max_file_size'  => 524288000,
    'retention_days' => 30,

    // ── Conversão ────────────────────────────────────────────────────────
    'node_bin'        => '{$node}',
    'convert_timeout' => 600,
    'async_threshold' => 16777216,
    'queue_enabled'   => true,

    // ── Diagnóstico ──────────────────────────────────────────────────────
    'debug'     => false,
    'log_level' => 'info',
];

PHP;

$conteudo = \str_replace((string) $_SERVER['REQUEST_TIME'], \date('d/m/Y H:i'), $conteudo);

if (\file_put_contents($configLocal, $conteudo) === false) {
    erro('Não foi possível escrever api/config.local.php');
    exit(1);
}

ok('api/config.local.php escrito');

// ─────────────────────────────────────────────────────────────────────────
passo('4. .env do frontend');

$envFile = $raiz . '/.env';
$chaveFrontend = $chaves['dev'] ?? $chaves['frontend'] ?? \reset($chaves);

$env = <<<ENV
# SCC Builder — configuração do frontend
# Gerado por bin/instalar.php em {$_SERVER['REQUEST_TIME']}

VITE_BASE_PATH={$base}
VITE_API_BASE_URL={$base}api
# Só para desenvolvimento local: em produção o editor usa o JWT do jogo.
VITE_API_KEY={$chaveFrontend}
VITE_DEV_PORT=5173

ENV;

$env = \str_replace((string) $_SERVER['REQUEST_TIME'], \date('d/m/Y H:i'), $env);

if (\is_file($envFile)) {
    \copy($envFile, $envFile . '.bak-' . \date('Ymd-His'));
    info('Backup do .env anterior criado');
}

\file_put_contents($envFile, $env);
ok(".env escrito (base {$base})");

// ─────────────────────────────────────────────────────────────────────────
passo('5. Storage');

$subdirs = ['uploads', 'converted', 'logs', 'ratelimit', 'tmp'];
$criados = 0;

foreach (\array_merge([''], $subdirs) as $sub) {
    $caminho = $storage . ($sub === '' ? '' : '/' . $sub);

    if (\is_dir($caminho)) {
        continue;
    }

    if (!@\mkdir($caminho, 0o750, true) && !\is_dir($caminho)) {
        erro("Falha ao criar {$caminho}");
        $pendencias[] = "Criar manualmente o diretório {$caminho} com permissão de escrita.";
        break;
    }

    $criados++;
}

ok($criados > 0 ? "{$criados} diretório(s) criado(s)" : 'Estrutura de storage já existia');

$prova = $storage . '/.escrita_' . \bin2hex(\random_bytes(3));
if (@\file_put_contents($prova, 'ok') !== false) {
    @\unlink($prova);
    ok('Storage é gravável');
} else {
    erro('Storage NÃO é gravável');
    $pendencias[] = "Dar permissão de escrita ao usuário do Apache em {$storage}.";
}

// Se, mesmo assim, o storage acabou dentro do webroot, protege com .htaccess.
$docRootProvavel = \dirname($raiz);
if (\str_starts_with($storage, \str_replace('\\', '/', $docRootProvavel))) {
    aviso('O storage ficou dentro do webroot — gravando .htaccess de proteção.');

    \file_put_contents($storage . '/.htaccess', <<<'HTA'
        php_flag engine off
        RemoveHandler .php .phtml .php3 .php5 .phar
        <IfModule mod_authz_core.c>
            Require all denied
        </IfModule>
        <IfModule !mod_authz_core.c>
            Order allow,deny
            Deny from all
        </IfModule>
        HTA);

    $pendencias[] = 'Mover storage_dir para fora do webroot (recomendado).';
}

// ─────────────────────────────────────────────────────────────────────────
passo('6. Banco de dados');

// Carrega a configuração recém-escrita e inicializa o SQLite.
require_once $raiz . '/api/config.php';

try {
    \SccBuilder\Api\Database::pdo()->query('SELECT 1');
    ok('SQLite inicializado em ' . $storage . '/scc-builder.sqlite');
} catch (\Throwable $e) {
    erro('Falha no banco: ' . $e->getMessage());
    $pendencias[] = 'Ativar a extensão pdo_sqlite no php.ini.';
}

// ─────────────────────────────────────────────────────────────────────────
passo('7. Verificações do ambiente');

foreach (['pdo_sqlite', 'curl', 'json', 'fileinfo'] as $ext) {
    if (\extension_loaded($ext)) {
        ok("Extensão {$ext}");
    } else {
        erro("Extensão {$ext} ausente");
        $pendencias[] = "Ativar extension={$ext} no php.ini e reiniciar o Apache.";
    }
}

$limites = [
    'upload_max_filesize' => 64 * 1024 * 1024,
    'post_max_size'       => 64 * 1024 * 1024,
];

foreach ($limites as $chaveIni => $minimo) {
    $valor = (string) \ini_get($chaveIni);
    $bytes = (int) $valor * match (\strtolower(\substr($valor, -1))) {
        'g' => 1024 ** 3,
        'm' => 1024 ** 2,
        'k' => 1024,
        default => 1,
    };

    if ($bytes >= $minimo) {
        ok("{$chaveIni} = {$valor}");
    } else {
        aviso("{$chaveIni} = {$valor} (baixo)");
        $pendencias[] = "Aumentar {$chaveIni} para 512M no php.ini.";
    }
}

if (!\is_dir($raiz . '/node_modules')) {
    aviso('node_modules ausente');
    $pendencias[] = 'Executar: npm install';
} else {
    ok('node_modules presente');
}

if (!\is_dir($raiz . '/dist')) {
    aviso('build de produção ausente');
    $pendencias[] = 'Executar: npm run build';
} else {
    ok('build presente em dist/');
}

// ─────────────────────────────────────────────────────────────────────────
passo('Resumo');

echo \PHP_EOL, "  \033[1mChaves de API\033[0m (guarde em local seguro):", \PHP_EOL;
foreach ($chaves as $id => $valor) {
    echo "    {$id}: \033[36m{$valor}\033[0m", \PHP_EOL;
}

echo \PHP_EOL, "  \033[1mEndereços\033[0m", \PHP_EOL;
echo "    Editor:  \033[36mhttp://localhost{$base}\033[0m", \PHP_EOL;
echo "    API:     \033[36m{$urlApi}\033[0m", \PHP_EOL;
echo "    Health:  \033[36m{$urlApi}/health.php\033[0m", \PHP_EOL;

if ($pendencias !== []) {
    echo \PHP_EOL, "  \033[1;33mAinda falta:\033[0m", \PHP_EOL;
    foreach (\array_unique($pendencias) as $i => $pendencia) {
        echo '   ', $i + 1, '. ', $pendencia, \PHP_EOL;
    }
    echo \PHP_EOL;
    exit(1);
}

echo \PHP_EOL, "  \033[1;32mInstalação concluída.\033[0m", \PHP_EOL;
echo '  Valide com: php bin/validar.php', \PHP_EOL, \PHP_EOL;
exit(0);
