<?php

declare(strict_types=1);

/**
 * SCC Builder — autodiagnóstico da instalação.
 *
 * Roda a bateria completa de verificações do lado servidor e imprime um
 * relatório com PASSOU / FALHOU / AVISO por item. Cada falha vem com a
 * ação corretiva, não só a mensagem de erro.
 *
 * Uso:
 *   php bin/validar.php
 *   php bin/validar.php --url=http://localhost/scc-builder/api
 *   php bin/validar.php --skip-http      (só checagens locais)
 *   php bin/validar.php --keep           (não apaga os artefatos de teste)
 *
 * Código de saída: 0 se tudo passou, 1 se houve qualquer falha.
 */

if (\PHP_SAPI !== 'cli') {
    \http_response_code(403);
    exit('Este script só roda via linha de comando.');
}

$options = \getopt('', ['url::', 'key::', 'skip-http', 'keep', 'help']);

if (isset($options['help'])) {
    echo <<<TXT

    SCC Builder — validação da instalação

      --url=<base>   URL base da API (padrão: http://localhost/scc-builder/api)
      --key=<chave>  API key a usar (padrão: a primeira de config.local.php)
      --skip-http    Pula os testes HTTP (útil se o Apache estiver parado)
      --keep         Mantém os arquivos de teste para inspeção
      --help         Esta ajuda


    TXT;
    exit(0);
}

require_once \dirname(__DIR__) . '/api/config.php';

use SccBuilder\Api\Config;
use SccBuilder\Api\ConversionRunner;
use SccBuilder\Api\Database;
use SccBuilder\Api\FileValidator;
use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Storage;

// ── Estado do relatório ──────────────────────────────────────────────────

$resultados = ['pass' => 0, 'fail' => 0, 'warn' => 0];
$falhas     = [];
$temporarios = [];

function titulo(string $texto): void
{
    echo \PHP_EOL, "\033[1m", $texto, "\033[0m", \PHP_EOL;
    echo \str_repeat('─', \min(64, \strlen($texto) + 4)), \PHP_EOL;
}

function checar(string $nome, bool $ok, string $detalhe = '', string $correcao = ''): bool
{
    global $resultados, $falhas;

    if ($ok) {
        $resultados['pass']++;
        echo "  \033[32m✔\033[0m {$nome}";
        echo $detalhe !== '' ? "  \033[90m{$detalhe}\033[0m" : '';
        echo \PHP_EOL;

        return true;
    }

    $resultados['fail']++;
    $falhas[] = ['nome' => $nome, 'correcao' => $correcao];

    echo "  \033[31m✖\033[0m {$nome}";
    echo $detalhe !== '' ? "  \033[90m{$detalhe}\033[0m" : '';
    echo \PHP_EOL;

    if ($correcao !== '') {
        echo "      \033[33m→ {$correcao}\033[0m", \PHP_EOL;
    }

    return false;
}

function avisar(string $nome, string $detalhe = '', string $sugestao = ''): void
{
    global $resultados;

    $resultados['warn']++;
    echo "  \033[33m!\033[0m {$nome}";
    echo $detalhe !== '' ? "  \033[90m{$detalhe}\033[0m" : '';
    echo \PHP_EOL;

    if ($sugestao !== '') {
        echo "      \033[90m→ {$sugestao}\033[0m", \PHP_EOL;
    }
}

function bytesDeIni(string $valor): int
{
    $valor = \trim($valor);
    if ($valor === '' || $valor === '-1') {
        return \PHP_INT_MAX;
    }

    $unidade = \strtolower($valor[\strlen($valor) - 1]);
    $numero  = (int) $valor;

    return match ($unidade) {
        'g'     => $numero * 1024 * 1024 * 1024,
        'm'     => $numero * 1024 * 1024,
        'k'     => $numero * 1024,
        default => $numero,
    };
}

echo \PHP_EOL, "\033[1;36m  SCC Builder — validação da instalação  \033[0m", \PHP_EOL;
echo '  ', \date('d/m/Y H:i:s'), ' · versão ', Config::get('version'), \PHP_EOL;

// ─────────────────────────────────────────────────────────────────────────
titulo('1. Ambiente PHP');

checar(
    'PHP 8.1 ou superior',
    \PHP_VERSION_ID >= 80100,
    \PHP_VERSION,
    'Troque a versão do PHP no WAMP (ícone da bandeja → PHP → Version).'
);

foreach (
    [
        'pdo_sqlite' => 'Banco de jobs. No WAMP: ícone → PHP → PHP extensions → pdo_sqlite',
        'curl'       => 'Usado pelo SDK. No WAMP: ícone → PHP → PHP extensions → curl',
        'json'       => 'Compilada por padrão; reinstale o PHP se faltar.',
        'fileinfo'   => 'Detecção de tipo de arquivo. Ative em php.ini.',
    ] as $extensao => $correcao
) {
    checar("Extensão {$extensao}", \extension_loaded($extensao), '', $correcao);
}

$uploadMax = bytesDeIni((string) \ini_get('upload_max_filesize'));
$postMax   = bytesDeIni((string) \ini_get('post_max_size'));
$minimo    = 64 * 1024 * 1024;

checar(
    'upload_max_filesize >= 64M',
    $uploadMax >= $minimo,
    \ini_get('upload_max_filesize'),
    'Edite o php.ini (ícone WAMP → PHP → php.ini) e reinicie os serviços.'
);

checar(
    'post_max_size >= upload_max_filesize',
    $postMax >= $uploadMax,
    \ini_get('post_max_size'),
    'post_max_size precisa ser maior ou igual a upload_max_filesize.'
);

$tempoMax = (int) \ini_get('max_execution_time');
if ($tempoMax !== 0 && $tempoMax < 120) {
    avisar(
        'max_execution_time baixo',
        "{$tempoMax}s",
        'Conversões síncronas de arquivos médios podem estourar. Sugerido: 300.'
    );
} else {
    checar('max_execution_time adequado', true, $tempoMax === 0 ? 'ilimitado' : "{$tempoMax}s");
}

// ─────────────────────────────────────────────────────────────────────────
titulo('2. Configuração');

$configLocal = \dirname(__DIR__) . '/api/config.local.php';

$temConfig = checar(
    'api/config.local.php existe',
    \is_file($configLocal),
    '',
    'Copie api/config.local.example.php para api/config.local.php.'
);

$chaves    = (array) Config::get('api_keys', []);
$jwtSecret = (string) Config::get('jwt_secret', '');

checar(
    'jwt_secret do gateway SCC definido e forte',
    \strlen($jwtSecret) >= 32 && !\str_contains($jwtSecret, 'TROQUE-ME'),
    $jwtSecret === '' ? 'vazio' : \strlen($jwtSecret) . ' caracteres',
    'Use o mesmo segredo HS256 do gateway (ou gere um local com bin/instalar.php).'
);

checar(
    'Ao menos uma API key definida (servidor a servidor e testes)',
    \count($chaves) > 0,
    \count($chaves) . ' chave(s)',
    'Gere com: php -r "echo bin2hex(random_bytes(32));" e cole em api_keys.'
);

foreach ($chaves as $id => $chave) {
    if (!\is_string($chave)) {
        continue;
    }

    if (\str_contains($chave, 'TROQUE-ME') || \strlen($chave) < 32) {
        checar(
            "Chave \"{$id}\" é forte",
            false,
            \strlen($chave) . ' caracteres',
            'Substitua pelo valor de: php -r "echo bin2hex(random_bytes(32));"'
        );
    } else {
        checar("Chave \"{$id}\" é forte", true, \strlen($chave) . ' caracteres');
    }
}

if (Config::get('allow_public') === true) {
    avisar(
        'allow_public está ativo',
        'a API aceita requisições sem chave',
        'Deixe false em qualquer ambiente acessível pela rede.'
    );
} else {
    checar('allow_public desativado', true);
}

$origens = (array) Config::get('cors_origins', []);
checar(
    'CORS com allowlist explícita',
    !\in_array('*', $origens, true),
    \implode(', ', $origens) ?: '(vazio)',
    'Remova o "*" de cors_origins e liste os domínios permitidos.'
);

// ─────────────────────────────────────────────────────────────────────────
titulo('3. Armazenamento');

$storage = Storage::root();

checar(
    'Diretório de storage existe',
    \is_dir($storage),
    $storage,
    'Verifique se o caminho em storage_dir é válido e acessível.'
);

checar(
    'Storage é gravável',
    \is_writable($storage),
    '',
    'Dê permissão de escrita ao usuário do Apache nessa pasta.'
);

if (Storage::isInsideWebroot()) {
    $htaccess = $storage . '/.htaccess';

    avisar(
        'Storage dentro do webroot',
        $storage,
        'Mova storage_dir para fora de www/ (ex.: C:/wamp64/scc-builder-storage).'
    );

    checar(
        '.htaccess de proteção presente',
        \is_file($htaccess),
        '',
        'Apague a pasta de storage e recarregue a API para regerá-lo.'
    );
} else {
    checar('Storage fora do webroot', true, $storage);
}

// Escrita/leitura real, não só a flag do sistema de arquivos.
$provaEscrita = $storage . '/.validacao_' . \bin2hex(\random_bytes(4));
$escreveu     = @\file_put_contents($provaEscrita, 'ok') !== false;
checar('Escrita real no storage', $escreveu, '', 'Permissão negada ao usuário do Apache.');
@\unlink($provaEscrita);

// ─────────────────────────────────────────────────────────────────────────
titulo('4. Banco de dados (SQLite)');

try {
    Database::pdo()->query('SELECT 1');
    checar('Conexão SQLite', true, $storage . '/scc-builder.sqlite');

    $jobTeste = JobRepository::create([
        'owner'         => '__validacao__',
        'original_name' => 'teste.obj',
        'input_format'  => 'obj',
        'input_file'    => 'inexistente.obj',
        'input_size'    => 1,
    ]);
    $temporarios['job'] = $jobTeste;

    $lido = JobRepository::find($jobTeste);
    checar('Criar e ler job', $lido !== null && $lido['id'] === $jobTeste);

    $claim = JobRepository::claimNext();
    checar('Reserva atômica da fila', $claim !== null);

    JobRepository::markCompleted($jobTeste, ['output_file' => 'x.glb', 'output_size' => 10]);
    $final = JobRepository::find($jobTeste);
    checar('Atualizar status do job', ($final['status'] ?? '') === 'completed');
} catch (\Throwable $e) {
    checar(
        'Banco de dados operacional',
        false,
        $e->getMessage(),
        'Confirme que pdo_sqlite está ativo e que o storage é gravável.'
    );
}

// ─────────────────────────────────────────────────────────────────────────
titulo('5. Node.js e pipeline de conversão');

$node = ConversionRunner::resolveNodeBinary();

$temNode = checar(
    'Binário do Node localizado',
    $node !== null,
    (string) $node,
    'Defina node_bin com o caminho absoluto em api/config.local.php '
        . '(ex.: C:/Program Files/nodejs/node.exe).'
);

if ($temNode) {
    $versao = \trim((string) \shell_exec(\escapeshellarg($node) . ' --version 2>&1'));
    $numero = (int) \ltrim(\explode('.', $versao)[0] ?? '0', 'v');

    checar('Node 18 ou superior', $numero >= 18, $versao, 'Atualize o Node.js.');
}

$nodeModules = \dirname(__DIR__) . '/node_modules';

checar(
    'node_modules instalado',
    \is_dir($nodeModules),
    '',
    'Execute: npm install (na pasta do projeto).'
);

foreach (['@gltf-transform/core', '@gltf-transform/functions', 'three'] as $pacote) {
    checar(
        "Pacote {$pacote}",
        \is_dir($nodeModules . '/' . $pacote),
        '',
        "Execute: npm install {$pacote}"
    );
}

// Conversão de ponta a ponta com um cubo gerado na hora.
if ($temNode && \is_dir($nodeModules . '/@gltf-transform/core')) {
    $entrada = $storage . '/tmp/validacao_cubo.obj';
    $saida   = $storage . '/tmp/validacao_cubo.glb';

    Storage::ensure(\dirname($entrada));
    \file_put_contents($entrada, cuboObj());
    $temporarios['arquivos'] = [$entrada, $saida];

    echo '  … convertendo um cubo de teste', \PHP_EOL;

    $run = ConversionRunner::run($entrada, $saida, 'glb', 'balanced', false, 1.0);

    $converteu = checar(
        'Conversão OBJ → GLB',
        $run['ok'],
        $run['ok'] ? '' : $run['code'] . ': ' . $run['message'],
        'Rode manualmente para ver o log completo: '
            . 'node bin/convert.js -i "' . $entrada . '" -o "' . $saida . '"'
    );

    if ($converteu) {
        $tamanho = (int) \filesize($saida);
        checar('Arquivo GLB gerado', $tamanho > 0, Storage::humanSize($tamanho));

        // Assinatura glTF binária: os 4 primeiros bytes são "glTF".
        $magic = (string) \file_get_contents($saida, false, null, 0, 4);
        checar('GLB tem assinatura válida', $magic === 'glTF', \bin2hex($magic));

        $resultado = $run['result'];

        checar(
            'Métricas de conversão retornadas',
            isset($resultado['triangles_before'], $resultado['triangles_after']),
            \sprintf(
                '%s → %s triângulos',
                $resultado['triangles_before'] ?? '?',
                $resultado['triangles_after'] ?? '?'
            )
        );

        if (($resultado['draco'] ?? false) === true) {
            checar('Compressão Draco ativa', true);
        } else {
            avisar(
                'Draco não aplicado',
                '',
                'Instale draco3dgltf: npm install draco3dgltf'
            );
        }
    }
}

// Conversores externos são opcionais — FBX/DAE dependem deles.
$externos = [];
foreach (['FBX2glTF', 'assimp'] as $binario) {
    $comando = \str_starts_with(\PHP_OS_FAMILY, 'Win') ? 'where' : 'which';
    \exec("{$comando} {$binario} 2>&1", $saidaCmd, $codigo);
    if ($codigo === 0) {
        $externos[] = $binario;
    }
}

if ($externos === []) {
    avisar(
        'Nenhum conversor de FBX/DAE no PATH',
        '',
        'Opcional. Sem FBX2glTF ou Assimp, .fbx e .dae falham no servidor '
            . '(o editor no browser continua abrindo os dois).'
    );
} else {
    checar('Conversor externo disponível', true, \implode(', ', $externos));
}

// ─────────────────────────────────────────────────────────────────────────
titulo('6. Validação de upload');

$casos = [
    ['nome' => 'GLB legítimo', 'ext' => 'glb', 'conteudo' => "glTF\x02\x00\x00\x00", 'aceita' => true],
    ['nome' => 'OBJ legítimo', 'ext' => 'obj', 'conteudo' => "v 0 0 0\nv 1 0 0\n", 'aceita' => true],
    ['nome' => 'PHP disfarçado de OBJ', 'ext' => 'obj', 'conteudo' => "<?php system(\$_GET['c']); ?>", 'aceita' => false],
    ['nome' => 'Executável renomeado para GLB', 'ext' => 'glb', 'conteudo' => "MZ\x90\x00binário", 'aceita' => false],
    ['nome' => 'Arquivo vazio', 'ext' => 'obj', 'conteudo' => '', 'aceita' => false],
];

foreach ($casos as $caso) {
    $arquivo = $storage . '/tmp/val_' . \bin2hex(\random_bytes(4)) . '.' . $caso['ext'];
    \file_put_contents($arquivo, $caso['conteudo']);

    $aceito = true;
    try {
        FileValidator::validate($arquivo, $caso['ext']);
    } catch (\Throwable) {
        $aceito = false;
    }

    @\unlink($arquivo);

    checar(
        $caso['nome'] . ($caso['aceita'] ? ' é aceito' : ' é rejeitado'),
        $aceito === $caso['aceita'],
        '',
        'A validação por magic bytes não está funcionando como esperado.'
    );
}

checar(
    'Path traversal bloqueado',
    (static function (): bool {
        try {
            Storage::resolve(Storage::UPLOADS, '../../api/config.local.php');

            return false;
        } catch (\Throwable) {
            return true;
        }
    })()
);

// ─────────────────────────────────────────────────────────────────────────
if (!isset($options['skip-http'])) {
    titulo('7. Endpoints HTTP');

    $baseUrl = \rtrim((string) ($options['url'] ?? 'http://localhost/scc-builder/api'), '/');
    $chave   = (string) ($options['key'] ?? (\reset($chaves) ?: ''));

    echo "  base: {$baseUrl}", \PHP_EOL;

    /**
     * @return array{status:int, body:array<mixed>|null, raw:string, erro:string}
     */
    $http = static function (
        string $metodo,
        string $caminho,
        array $headers = [],
        mixed $corpo = null
    ) use ($baseUrl): array {
        $ch = \curl_init($baseUrl . $caminho);
        \curl_setopt_array($ch, [
            \CURLOPT_RETURNTRANSFER => true,
            \CURLOPT_TIMEOUT        => 120,
            \CURLOPT_CONNECTTIMEOUT => 5,
            \CURLOPT_CUSTOMREQUEST  => $metodo,
            \CURLOPT_HTTPHEADER     => $headers,
        ]);

        if ($corpo !== null) {
            \curl_setopt($ch, \CURLOPT_POSTFIELDS, $corpo);
        }

        $raw    = \curl_exec($ch);
        $status = (int) \curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        $erro   = \curl_error($ch);
        \curl_close($ch);

        return [
            'status' => $status,
            'body'   => \is_string($raw) ? \json_decode($raw, true) : null,
            'raw'    => \is_string($raw) ? $raw : '',
            'erro'   => $erro,
        ];
    };

    $health = $http('GET', '/health.php');

    $servidorNoAr = checar(
        'Servidor responde',
        $health['status'] > 0,
        $health['erro'] !== '' ? $health['erro'] : "HTTP {$health['status']}",
        'Ligue o Apache no WAMP (ícone verde) e confirme a URL com --url='
    );

    if ($servidorNoAr) {
        checar(
            'health.php devolve JSON',
            \is_array($health['body']) && isset($health['body']['status']),
            '',
            'Se veio HTML, o PHP não está processando a pasta api/.'
        );

        checar(
            'Requisição sem chave é recusada',
            $http('GET', '/jobs.php')['status'] === 401,
            '',
            'A autenticação não está sendo aplicada — verifique Security::guard().'
        );

        checar(
            'Chave inválida é recusada',
            $http('GET', '/jobs.php', ['X-API-Key: chave-errada-123'])['status'] === 403
        );

        if ($jwtSecret !== '') {
            $falso = \SccBuilder\Api\Jwt::encode(['sub' => 'validar', 'exp' => \time() + 60], 'segredo-errado');
            checar(
                'JWT com assinatura errada é recusado',
                $http('GET', '/jobs.php', ['Authorization: Bearer ' . $falso])['status'] === 401
            );

            $bom = \SccBuilder\Api\Jwt::encode(['sub' => 'validar', 'exp' => \time() + 60]
                + ((string) Config::get('jwt_issuer', '') !== '' ? ['iss' => Config::get('jwt_issuer')] : [])
                + ((string) Config::get('jwt_audience', '') !== '' ? ['aud' => Config::get('jwt_audience')] : []), $jwtSecret);
            $comJwt = $http('GET', '/jobs.php', ['Authorization: Bearer ' . $bom]);
            checar(
                'JWT do gateway é aceito',
                $comJwt['status'] === 200,
                "HTTP {$comJwt['status']}",
                'Se veio 401 sem motivo, o Apache pode estar descartando o header Authorization '
                    . '(veja CGIPassAuth / SetEnvIf em docs/01-DEPLOY.md).'
            );
        }

        if ($chave !== '') {
            $auth = ['X-API-Key: ' . $chave];

            $jobs = $http('GET', '/jobs.php', $auth);
            checar(
                'Chave válida é aceita',
                $jobs['status'] === 200,
                "HTTP {$jobs['status']}",
                'Confira se a chave usada consta em api_keys.'
            );

            // Upload real de ponta a ponta.
            $arquivoUpload = $storage . '/tmp/upload_validacao.obj';
            \file_put_contents($arquivoUpload, cuboObj());

            $envio = $http('POST', '/convert.php', $auth, [
                'file'          => new \CURLFile($arquivoUpload, 'text/plain', 'cubo.obj'),
                'target_format' => 'glb',
                'optimize'      => 'balanced',
            ]);

            @\unlink($arquivoUpload);

            $enviou = checar(
                'Upload e conversão via API',
                \in_array($envio['status'], [201, 202], true),
                "HTTP {$envio['status']} "
                    . ($envio['body']['error']['message'] ?? ''),
                'Veja storage/logs/api-' . \date('Y-m-d') . '.jsonl com o request_id.'
            );

            if ($enviou) {
                $job = $envio['body']['data']['job'] ?? [];
                $jobId = (string) ($job['id'] ?? '');

                if ($envio['status'] === 202) {
                    avisar(
                        'Job foi enfileirado',
                        $jobId,
                        'Rode "php bin/worker.php --once" para processá-lo.'
                    );
                } else {
                    checar('Job concluído de forma síncrona', ($job['status'] ?? '') === 'completed');

                    $download = $http('GET', '/download.php?job_id=' . \rawurlencode($jobId), $auth);
                    checar(
                        'Download do GLB convertido',
                        $download['status'] === 200 && \str_starts_with($download['raw'], 'glTF'),
                        Storage::humanSize(\strlen($download['raw']))
                    );

                    $http('DELETE', '/models.php?job_id=' . \rawurlencode($jobId), $auth);
                }

                checar(
                    'Consulta de job por id',
                    $http('GET', '/jobs.php?job_id=' . \rawurlencode($jobId), $auth)['status'] === 200
                );
            }

            checar(
                'Formato não suportado é recusado',
                (static function () use ($http, $auth, $storage): bool {
                    $falso = $storage . '/tmp/malicioso.ifc';
                    \file_put_contents($falso, 'ISO-10303-21;');
                    $r = $http('POST', '/convert.php', $auth, [
                        'file' => new \CURLFile($falso, 'text/plain', 'x.ifc'),
                    ]);
                    @\unlink($falso);

                    return $r['status'] === 400;
                })(),
                '',
                'IFC deveria ser rejeitado — confira input_formats na configuração.'
            );

            checar(
                'Listagem de modelos',
                $http('GET', '/models.php?action=list', $auth)['status'] === 200
            );
        } else {
            avisar('Testes autenticados pulados', 'nenhuma chave disponível');
        }

        // Storage nunca deve ser servido direto pelo Apache.
        $direto = \curl_init(\str_replace('/api', '', $baseUrl) . '/storage/scc-builder.sqlite');
        \curl_setopt_array($direto, [
            \CURLOPT_RETURNTRANSFER => true,
            \CURLOPT_TIMEOUT        => 10,
            \CURLOPT_NOBODY         => true,
        ]);
        \curl_exec($direto);
        $statusDireto = (int) \curl_getinfo($direto, \CURLINFO_HTTP_CODE);
        \curl_close($direto);

        checar(
            'Banco não é acessível por HTTP',
            $statusDireto === 403 || $statusDireto === 404,
            "HTTP {$statusDireto}",
            'CRÍTICO: o storage está exposto. Mova-o para fora do webroot.'
        );
    }
} else {
    titulo('7. Endpoints HTTP');
    echo '  (pulado por --skip-http)', \PHP_EOL;
}

// ─────────────────────────────────────────────────────────────────────────
// Limpeza
if (!isset($options['keep'])) {
    if (isset($temporarios['job'])) {
        try {
            Database::pdo()
                ->prepare('DELETE FROM jobs WHERE owner = :o')
                ->execute(['o' => '__validacao__']);
        } catch (\Throwable) {
            // sem consequência
        }
    }

    foreach ($temporarios['arquivos'] ?? [] as $arquivo) {
        @\unlink($arquivo);
    }
}

// ─────────────────────────────────────────────────────────────────────────
titulo('Resumo');

echo \sprintf(
    "  \033[32m%d passaram\033[0m · \033[31m%d falharam\033[0m · \033[33m%d avisos\033[0m%s",
    $resultados['pass'],
    $resultados['fail'],
    $resultados['warn'],
    \PHP_EOL
);

if ($falhas !== []) {
    echo \PHP_EOL, "  \033[1mO que corrigir:\033[0m", \PHP_EOL;
    foreach ($falhas as $i => $falha) {
        echo '   ', $i + 1, '. ', $falha['nome'], \PHP_EOL;
        if ($falha['correcao'] !== '') {
            echo "      \033[33m{$falha['correcao']}\033[0m", \PHP_EOL;
        }
    }
    echo \PHP_EOL;
    exit(1);
}

echo \PHP_EOL, "  \033[1;32mInstalação validada.\033[0m", \PHP_EOL;
echo '  Próximo passo: abra o editor e siga docs/02-VALIDACAO.md (seção browser).', \PHP_EOL, \PHP_EOL;
exit(0);

/** Cubo unitário fechado, em OBJ — entrada previsível para os testes. */
function cuboObj(): string
{
    return <<<'OBJ'
        # SCC Builder — cubo de validação
        v -1 -1 -1
        v  1 -1 -1
        v  1  1 -1
        v -1  1 -1
        v -1 -1  1
        v  1 -1  1
        v  1  1  1
        v -1  1  1
        f 1 3 2
        f 1 4 3
        f 5 6 7
        f 5 7 8
        f 1 5 8
        f 1 8 4
        f 2 3 7
        f 2 7 6
        f 4 8 7
        f 4 7 3
        f 1 2 6
        f 1 6 5
        OBJ;
}
