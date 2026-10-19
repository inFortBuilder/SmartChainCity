<?php

declare(strict_types=1);

use SccBuilder\Api\Config;
use SccBuilder\Api\Database;
use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Jwt;
use SccBuilder\Api\S3Publisher;
use SccBuilder\Api\Storage;

/**
 * Ponta a ponta: sobe a API num `php -S` com storage temporário e chama o
 * validate-lot.php por HTTP, com JWT de verdade — prova o caminho completo
 * (guard, escopo por account_id, leitura do modelo.meta.json, resposta).
 */

const SEGREDO_E2E = 'segredo-e2e-com-tamanho-suficiente-123456';

/**
 * @return array{0:int,1:array<string,mixed>|null}
 */
function chamar(string $base, string $caminho, ?array $corpo, array $headers = []): array
{
    $ctx = \stream_context_create(['http' => [
        'method'        => $corpo === null ? 'GET' : 'POST',
        'header'        => \implode("\r\n", \array_merge(['Content-Type: application/json'], $headers)),
        'content'       => $corpo === null ? '' : (string) \json_encode($corpo),
        'ignore_errors' => true,
        'timeout'       => 20,
    ]]);
    $resposta = @\file_get_contents($base . $caminho, false, $ctx);
    $status   = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (\preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m) === 1) {
            $status = (int) $m[1];
        }
    }

    return [$status, \is_string($resposta) ? \json_decode($resposta, true) : null];
}

/** Cria um job concluído com GLB e meta no storage dos testes. */
function semearJob(string $dono, array $meta): string
{
    $id = JobRepository::create([
        'owner'          => $dono,
        'model_id'       => 'mdl_torre',
        'preset'         => 'scc',
        'original_name'  => 'torre.glb',
        'input_format'   => 'glb',
        'input_file'     => 'entrada.glb',
        'input_size'     => 10,
    ]);
    $saida = $id . '.glb';
    \file_put_contents(Storage::dir(Storage::CONVERTED) . '/' . $saida, 'glTF');
    \file_put_contents(Storage::dir(Storage::CONVERTED) . '/' . $id . '.meta.json', \json_encode($meta));
    \file_put_contents(Storage::dir(Storage::CONVERTED) . '/' . $id . '-lod1.glb', 'glTF');
    JobRepository::markCompleted($id, ['output_file' => $saida, 'output_size' => 4, 'triangles_after' => $meta['triangles']]);

    return $id;
}

caso('S3: layout builder/<account_id>/<model_id>/v<n>/modelo.glb', function (): void {
    configurar(['s3_prefix' => 'builder']);
    igual('builder/0xabc/mdl_9f/v1/modelo.glb', S3Publisher::chave('0xabc', 'mdl_9f', 1));
    igual('builder/0xabc/mdl_9f/v3/modelo-lod1.glb', S3Publisher::chave('0xabc', 'mdl_9f', 3, 'modelo-lod1.glb'));
    igual('builder/key-world/mdl/v1/modelo.glb', S3Publisher::chave('key:world', 'mdl', 1));
    igual('builder/etc-passwd/x/v1/modelo.glb', S3Publisher::chave('../etc/passwd', 'x', 0));
});

caso('S3: endereço virtual-host e path-style (MinIO)', function (): void {
    configurar(['s3_region' => 'sa-east-1', 's3_endpoint' => '', 's3_path_style' => false]);
    igual('https://scc.s3.sa-east-1.amazonaws.com/builder/a/m/v1/modelo.glb', S3Publisher::endereco('scc', 'builder/a/m/v1/modelo.glb')[0]);
    configurar(['s3_endpoint' => 'http://localhost:9000', 's3_path_style' => true]);
    igual('http://localhost:9000/scc/builder/a/m/v1/modelo.glb', S3Publisher::endereco('scc', 'builder/a/m/v1/modelo.glb')[0]);
});

caso('S3: publicarJob envia GLB, LODs e meta com o layout do jogador', function (): void {
    configurar(['s3_enabled' => true, 's3_bucket' => 'scc', 's3_prefix' => 'builder', 's3_retries' => 1]);
    $enviados = [];
    S3Publisher::definirCliente(new class ($enviados) {
        public function __construct(private array &$log) {}
        public function putObject(array $args): void { $this->log[] = $args['Key'] . '|' . $args['ContentType']; }
    });
    $tmp = \tempnam(\sys_get_temp_dir(), 'scc');
    $chaves = S3Publisher::publicarJob(
        ['id' => 'job_1', 'owner' => '0xabc', 'model_id' => 'mdl_1', 'version' => 2],
        ['modelo.glb' => $tmp, 'modelo.meta.json' => $tmp]
    );
    S3Publisher::definirCliente(null);
    @\unlink($tmp);

    igual('builder/0xabc/mdl_1/v2/modelo.glb', $chaves['modelo.glb']);
    igual(['builder/0xabc/mdl_1/v2/modelo.glb|model/gltf-binary', 'builder/0xabc/mdl_1/v2/modelo.meta.json|application/json'], $enviados);
});

caso('Jobs: reenvio do mesmo model_id gera v1, v2; outro jogador começa do v1', function (): void {
    configurar();
    Database::reset();
    $a = JobRepository::create(['owner' => 'acc_v', 'model_id' => 'mdl_x', 'original_name' => 'a', 'input_format' => 'glb', 'input_file' => 'a']);
    $b = JobRepository::create(['owner' => 'acc_v', 'model_id' => 'mdl_x', 'original_name' => 'a', 'input_format' => 'glb', 'input_file' => 'a']);
    $c = JobRepository::create(['owner' => 'acc_w', 'model_id' => 'mdl_x', 'original_name' => 'a', 'input_format' => 'glb', 'input_file' => 'a']);
    igual(1, JobRepository::find($a)['version']);
    igual(2, JobRepository::find($b)['version']);
    igual(1, JobRepository::find($c)['version']);
    verdade(\str_starts_with((string) JobRepository::find(JobRepository::create(['owner' => 'x', 'original_name' => 'a', 'input_format' => 'glb', 'input_file' => 'a']))['model_id'], 'mdl_'));
});

caso('HTTP: POST validate-lot.php com JWT, escopo e erros', function (): void {
    if (!\extension_loaded('pdo_sqlite')) {
        throw new FalhaDeTeste('pdo_sqlite ausente neste PHP — rode com o PHP do servidor');
    }

    configurar();
    Database::reset();
    $job = semearJob('0xDono', metaCaixa());
    Database::reset(); // solta o arquivo para o servidor

    // Porta livre
    $sock = \stream_socket_server('tcp://127.0.0.1:0');
    $porta = (int) \substr((string) \stream_socket_get_name($sock, false), \strrpos((string) \stream_socket_get_name($sock, false), ':') + 1);
    \fclose($sock);

    $env = \array_merge(\getenv(), [
        'SCC_BUILDER_STORAGE_DIR'       => (string) Config::get('storage_dir'),
        'SCC_BUILDER_JWT_SECRET'        => SEGREDO_E2E,
        'SCC_BUILDER_RATE_LIMIT_REQUESTS' => '0',
    ]);
    $proc = \proc_open(
        [\PHP_BINARY, '-S', "127.0.0.1:{$porta}", '-t', \dirname(__DIR__, 2)],
        [0 => ['pipe', 'r'], 1 => ['file', \sys_get_temp_dir() . '/scc-e2e.log', 'a'], 2 => ['file', \sys_get_temp_dir() . '/scc-e2e.log', 'a']],
        $pipes,
        null,
        $env
    );
    verdade(\is_resource($proc), 'php -S não subiu');

    try {
        $base = "http://127.0.0.1:{$porta}";
        for ($i = 0; $i < 50 && @\fsockopen('127.0.0.1', $porta) === false; $i++) {
            \usleep(100000);
        }

        $dono  = 'Authorization: Bearer ' . Jwt::encode(['sub' => '0xDono', 'exp' => \time() + 120], SEGREDO_E2E);
        $outro = 'Authorization: Bearer ' . Jwt::encode(['sub' => '0xOutro', 'exp' => \time() + 120], SEGREDO_E2E);
        $corpo = [
            'job_id'    => $job,
            'lot'       => ['id' => 'A1-078'] + loteQuadrado(),
            'transform' => ['rotation_deg' => 0, 'units' => 'm'],
        ];

        [$st, $r] = chamar($base, '/api/validate-lot.php', $corpo, [$dono]);
        igual(200, $st, 'dono:');
        $d = $r['data'];
        igual(true, $d['valid']);
        igual('A1-078', $d['lot_id']);
        igual(25, $d['suggested_floors']);
        igual(400, $d['footprint']['area_m2']);
        igual('builder/0xDono/mdl_torre/v1/modelo.glb', $d['artifacts']['glb']);
        igual('builder/0xDono/mdl_torre/v1/modelo-lod1.glb', $d['artifacts']['lod1']);
        igual(null, $d['artifacts']['lod2']);
        igual(false, $d['published']);

        [$st] = chamar($base, '/api/validate-lot.php', $corpo, [$outro]);
        igual(404, $st, 'outro jogador não vê o job:');

        [$st, $r] = chamar($base, '/api/validate-lot.php', $corpo, []);
        igual(401, $st, 'sem credencial:');
        igual('missing_credentials', $r['error']['code']);

        $vencido = 'Authorization: Bearer ' . Jwt::encode(['sub' => '0xDono', 'exp' => \time() - 600], SEGREDO_E2E);
        [$st, $r] = chamar($base, '/api/validate-lot.php', $corpo, [$vencido]);
        igual(401, $st, 'token vencido:');
        igual('token_expired', $r['error']['code']);

        [$st, $r] = chamar($base, '/api/validate-lot.php', ['job_id' => $job, 'lot' => ['polygon' => [[0, 0]]]], [$dono]);
        igual(400, $st, 'polígono inválido:');
        igual('invalid_polygon', $r['error']['code']);

        [$st, $r] = chamar($base, '/api/validate-lot.php', ['job_id' => $job, 'lot' => loteQuadrado(['max_height_m' => 30])], [$dono]);
        igual(200, $st);
        igual(false, $r['data']['valid']);
    } finally {
        \proc_terminate($proc);
        \proc_close($proc);
    }
});
