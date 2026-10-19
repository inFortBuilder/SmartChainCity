<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Executa o pipeline Node de conversão.
 *
 * Corrige C4 da auditoria:
 *  - binário do Node configurável e validado (o Apache não herda o PATH);
 *  - `proc_open` com timeout real em vez de `@exec` sem limite;
 *  - stdout/stderr capturados e registrados em log;
 *  - o sucesso depende do JSON de resultado E da existência do arquivo.
 */
final class ConversionRunner
{
    /**
     * @return array{ok: bool, code: string, message: string, result: array<string,mixed>, log: string}
     */
    public static function run(
        string $inputPath,
        string $outputPath,
        string $targetFormat,
        string $optimizeLevel = 'balanced',
        bool $flipAxis = false,
        float $scale = 1.0,
        ?string $preset = null
    ): array {
        $node = self::resolveNodeBinary();
        if ($node === null) {
            return self::failure(
                'node_not_found',
                'Node.js não encontrado. Defina "node_bin" com o caminho absoluto '
                    . 'em api/config.local.php (ex.: C:/Program Files/nodejs/node.exe).'
            );
        }

        $script = \dirname(__DIR__, 2) . '/bin/convert.js';
        if (!\is_file($script)) {
            return self::failure('script_missing', 'bin/convert.js não encontrado.');
        }

        $args = [
            $node,
            $script,
            '--input', $inputPath,
            '--output', $outputPath,
            '--format', $targetFormat,
            '--optimize', $optimizeLevel,
            '--scale', (string) $scale,
            '--json',
        ];
        if ($flipAxis) {
            $args[] = '--flip-axis';
        }
        if ($preset !== null && $preset !== '') {
            $args[] = '--preset';
            $args[] = $preset;
        }

        $started = \microtime(true);
        [$exitCode, $stdout, $stderr] = self::exec($args, (int) Config::get('convert_timeout', 600));
        $elapsed = (int) \round((\microtime(true) - $started) * 1000);

        $log = \trim($stdout . "\n" . $stderr);

        Logger::debug('Pipeline Node finalizado', [
            'exit_code'  => $exitCode,
            'elapsed_ms' => $elapsed,
        ]);

        if ($exitCode === 124) {
            return self::failure('timeout', 'A conversão excedeu o tempo limite.', $log);
        }

        $result = self::parseJsonResult($stdout);

        if ($exitCode !== 0) {
            return self::failure(
                (string) ($result['code'] ?? 'conversion_failed'),
                (string) ($result['message'] ?? 'O pipeline de conversão retornou erro.'),
                $log
            );
        }

        if (!\is_file($outputPath) || \filesize($outputPath) === 0) {
            return self::failure(
                'no_output',
                'O pipeline terminou sem erro, mas não gerou arquivo de saída.',
                $log
            );
        }

        $result['duration_ms'] = $result['duration_ms'] ?? $elapsed;
        $result['output_size'] = (int) \filesize($outputPath);

        return ['ok' => true, 'code' => 'ok', 'message' => 'Conversão concluída.', 'result' => $result, 'log' => $log];
    }

    /**
     * O pipeline imprime uma linha `@@RESULT@@{...}` para separar o
     * resultado estruturado dos logs de progresso.
     *
     * @return array<string,mixed>
     */
    private static function parseJsonResult(string $stdout): array
    {
        if (\preg_match('/@@RESULT@@(\{.*\})/s', $stdout, $m) !== 1) {
            return [];
        }

        $decoded = \json_decode($m[1], true);

        return \is_array($decoded) ? $decoded : [];
    }

    /**
     * @param string[] $args
     * @return array{0:int,1:string,2:string}
     */
    private static function exec(array $args, int $timeoutSeconds): array
    {
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        // No Windows, proc_open aceita array desde o PHP 7.4 e faz o escaping.
        $process = \proc_open($args, $descriptors, $pipes, \dirname(__DIR__, 2));

        if (!\is_resource($process)) {
            return [1, '', 'Não foi possível iniciar o processo de conversão.'];
        }

        \fclose($pipes[0]);
        \stream_set_blocking($pipes[1], false);
        \stream_set_blocking($pipes[2], false);

        $stdout   = '';
        $stderr   = '';
        $deadline = \time() + $timeoutSeconds;

        while (true) {
            $stdout .= (string) \stream_get_contents($pipes[1]);
            $stderr .= (string) \stream_get_contents($pipes[2]);

            $status = \proc_get_status($process);
            if ($status['running'] === false) {
                break;
            }

            if (\time() > $deadline) {
                \proc_terminate($process, 9);
                \fclose($pipes[1]);
                \fclose($pipes[2]);
                \proc_close($process);

                return [124, $stdout, $stderr . "\n[timeout] processo encerrado após {$timeoutSeconds}s"];
            }

            \usleep(100_000);
        }

        $stdout .= (string) \stream_get_contents($pipes[1]);
        $stderr .= (string) \stream_get_contents($pipes[2]);

        \fclose($pipes[1]);
        \fclose($pipes[2]);

        $exitCode = \proc_close($process);

        return [$exitCode, $stdout, $stderr];
    }

    /** Localiza um binário Node utilizável, ou null. */
    public static function resolveNodeBinary(): ?string
    {
        $configured = (string) Config::get('node_bin', 'node');

        // Caminho absoluto informado
        if (\str_contains($configured, '/') || \str_contains($configured, '\\')) {
            return \is_file($configured) ? $configured : null;
        }

        // Procura no PATH
        $isWindows = \str_starts_with(\PHP_OS_FAMILY, 'Win');
        $paths     = \explode(\PATH_SEPARATOR, (string) \getenv('PATH'));
        $names     = $isWindows ? [$configured . '.exe', $configured . '.cmd'] : [$configured];

        foreach ($paths as $dir) {
            foreach ($names as $name) {
                $candidate = \rtrim($dir, '/\\') . \DIRECTORY_SEPARATOR . $name;
                if (\is_file($candidate)) {
                    return $candidate;
                }
            }
        }

        // Locais comuns no Windows
        if ($isWindows) {
            foreach (['C:/Program Files/nodejs/node.exe', 'C:/Program Files (x86)/nodejs/node.exe'] as $c) {
                if (\is_file($c)) {
                    return $c;
                }
            }
        }

        return null;
    }

    /**
     * @return array{ok: bool, code: string, message: string, result: array<string,mixed>, log: string}
     */
    private static function failure(string $code, string $message, string $log = ''): array
    {
        return ['ok' => false, 'code' => $code, 'message' => $message, 'result' => [], 'log' => $log];
    }
}
