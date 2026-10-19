<?php

declare(strict_types=1);

/**
 * SCC Builder — worker da fila de conversão.
 *
 * Consome os jobs em estado "queued" criados por api/convert.php.
 * Escrito em PHP (e não em Node) para reaproveitar JobRepository,
 * ConversionRunner e a conexão SQLite já existentes — sem adicionar
 * um driver de banco ao lado Node.
 *
 * Uso:
 *   php bin/worker.php                 # loop contínuo
 *   php bin/worker.php --once          # processa a fila atual e sai
 *   php bin/worker.php --max-jobs=50   # sai após N jobs (recicla memória)
 *   php bin/worker.php --sleep=3       # intervalo de polling em segundos
 *
 * Windows (Agendador de Tarefas), a cada minuto:
 *   "C:\wamp64\bin\php\php8.1.0\php.exe" "C:\wamp64\www\scc-builder\bin\worker.php" --once
 *
 * Linux (systemd/supervisor): rode sem --once e deixe o supervisor reiniciar.
 */

if (\PHP_SAPI !== 'cli') {
    \http_response_code(403);
    exit('Este script só pode ser executado via linha de comando.');
}

require_once \dirname(__DIR__) . '/api/config.php';

use SccBuilder\Api\ConversionRunner;
use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Logger;
use SccBuilder\Api\S3Publisher;
use SccBuilder\Api\Storage;

$options = \getopt('', ['once', 'max-jobs::', 'sleep::', 'verbose', 'help']);

if (isset($options['help'])) {
    echo <<<TXT
    SCC Builder Worker

      --once           Processa os jobs pendentes e encerra
      --max-jobs=N     Encerra após N jobs processados (padrão: 100)
      --sleep=N        Segundos entre verificações da fila (padrão: 2)
      --verbose        Imprime o log do pipeline
      --help           Esta ajuda

    TXT;
    exit(0);
}

$once     = isset($options['once']);
$maxJobs  = (int) ($options['max-jobs'] ?? 100);
$sleepFor = \max(1, (int) ($options['sleep'] ?? 2));
$verbose  = isset($options['verbose']);

$running = true;

// Encerramento gracioso: termina o job atual antes de sair.
if (\function_exists('pcntl_signal')) {
    \pcntl_async_signals(true);
    foreach ([\SIGTERM, \SIGINT] as $signal) {
        \pcntl_signal($signal, static function () use (&$running): void {
            out('Sinal recebido — encerrando após o job atual.');
            $running = false;
        });
    }
}

out('Worker iniciado (pid ' . \getmypid() . ')');

$node = ConversionRunner::resolveNodeBinary();
if ($node === null) {
    out('ERRO: Node.js não encontrado. Configure "node_bin" em api/config.local.php.');
    exit(1);
}
out('Node: ' . $node);

$processed = 0;
$idleTicks = 0;

while ($running && $processed < $maxJobs) {
    $job = JobRepository::claimNext();

    if ($job === null) {
        if ($once) {
            break;
        }
        $idleTicks++;
        // Limpeza por retenção a cada ~5 minutos de ociosidade
        if ($idleTicks % \max(1, (int) (300 / $sleepFor)) === 0) {
            Storage::purgeExpired();
        }
        \sleep($sleepFor);
        continue;
    }

    $idleTicks = 0;
    $processed++;

    out(\sprintf(
        '[%d/%d] %s — %s (%s)',
        $processed,
        $maxJobs,
        $job['id'],
        $job['original_name'],
        Storage::humanSize((int) $job['input_size'])
    ));

    try {
        $inputPath  = Storage::resolve(Storage::UPLOADS, (string) $job['input_file']);
        $outputName = \pathinfo((string) $job['input_file'], PATHINFO_FILENAME)
            . '.' . $job['target_format'];
        $outputPath = Storage::dir(Storage::CONVERTED) . '/' . $outputName;

        $run = ConversionRunner::run(
            $inputPath,
            $outputPath,
            (string) $job['target_format'],
            (string) $job['optimize_level'],
            (bool) $job['flip_axis'],
            (float) $job['scale'],
            isset($job['preset']) ? (string) $job['preset'] : null
        );

        if ($verbose && $run['log'] !== '') {
            echo $run['log'], \PHP_EOL;
        }

        if ($run['ok']) {
            JobRepository::markCompleted($job['id'], $run['result'] + ['output_file' => $outputName]);

            // Mesma publicação do caminho síncrono. Sem isto, só as conversões
            // pequenas chegariam ao bucket — as grandes, que são justamente as
            // que vão para a fila, ficariam apenas no disco. O dono do job é o
            // account_id gravado na criação.
            $concluido = (array) JobRepository::find((string) $job['id']);
            $locais    = \array_map(
                static fn (string $nome): string => Storage::dir(Storage::CONVERTED) . '/' . $nome,
                JobRepository::artifacts($concluido)
            );

            foreach (S3Publisher::publicarJob($concluido, $locais) as $chaveS3) {
                out('  ↑ publicado no S3: ' . $chaveS3);
            }
            out(\sprintf(
                '  ✔ concluído — %s → %s (%s)',
                Storage::humanSize((int) $job['input_size']),
                Storage::humanSize((int) ($run['result']['output_size'] ?? 0)),
                isset($run['result']['compression_ratio'])
                    ? \sprintf('%.1f%% menor', $run['result']['compression_ratio'] * 100)
                    : 'sem métrica'
            ));
        } else {
            JobRepository::markFailed($job['id'], $run['code'], $run['message']);
            out('  ✖ falhou — ' . $run['code'] . ': ' . $run['message']);
        }
    } catch (\Throwable $e) {
        JobRepository::markFailed($job['id'], 'worker_exception', $e->getMessage());
        Logger::error('Exceção no worker', ['job_id' => $job['id'], 'message' => $e->getMessage()]);
        out('  ✖ exceção — ' . $e->getMessage());
    }
}

out("Worker encerrado. Jobs processados: {$processed}.");
exit(0);

function out(string $message): void
{
    echo '[' . \date('H:i:s') . '] ' . $message . \PHP_EOL;
}
