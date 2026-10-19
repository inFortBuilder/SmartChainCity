<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Logger de arquivo em linhas JSON (JSONL), com rotação por tamanho.
 * Substitui o antigo `@exec` silencioso: nada mais falha sem deixar rastro.
 */
final class Logger
{
    private const LEVELS = ['debug' => 10, 'info' => 20, 'warning' => 30, 'error' => 40];
    private const MAX_BYTES = 5_242_880; // 5 MB

    private static ?string $file = null;

    private static function file(): string
    {
        if (self::$file === null) {
            $dir = Config::get('storage_dir') . '/logs';
            if (!\is_dir($dir)) {
                @\mkdir($dir, 0o750, true);
            }
            self::$file = $dir . '/api-' . \date('Y-m-d') . '.jsonl';
        }

        return self::$file;
    }

    /** @param array<string,mixed> $context */
    public static function log(string $level, string $message, array $context = []): void
    {
        $threshold = self::LEVELS[(string) Config::get('log_level', 'info')] ?? 20;
        if ((self::LEVELS[$level] ?? 20) < $threshold) {
            return;
        }

        $file = self::file();

        if (\is_file($file) && \filesize($file) > self::MAX_BYTES) {
            @\rename($file, $file . '.' . \time() . '.old');
        }

        $line = \json_encode([
            'ts'         => \date('c'),
            'level'      => $level,
            'message'    => $message,
            'request_id' => Response::requestId(),
            'ip'         => Security::clientIp(),
            'context'    => $context,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($line !== false) {
            @\file_put_contents($file, $line . PHP_EOL, FILE_APPEND | LOCK_EX);
        }
    }

    /** @param array<string,mixed> $c */
    public static function debug(string $m, array $c = []): void
    {
        self::log('debug', $m, $c);
    }

    /** @param array<string,mixed> $c */
    public static function info(string $m, array $c = []): void
    {
        self::log('info', $m, $c);
    }

    /** @param array<string,mixed> $c */
    public static function warning(string $m, array $c = []): void
    {
        self::log('warning', $m, $c);
    }

    /** @param array<string,mixed> $c */
    public static function error(string $m, array $c = []): void
    {
        self::log('error', $m, $c);
    }
}
