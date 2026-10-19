<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Respostas HTTP em JSON com um envelope estável.
 *
 * Envelope de sucesso: { "status": "success", "data": {...}, "request_id": "..." }
 * Envelope de erro:    { "status": "error", "error": { "code", "message", "details" }, "request_id": "..." }
 */
final class Response
{
    private static string $requestId = '';

    public static function requestId(): string
    {
        if (self::$requestId === '') {
            self::$requestId = \bin2hex(\random_bytes(8));
        }

        return self::$requestId;
    }

    /** @param array<string,mixed> $data */
    public static function success(array $data = [], int $status = 200): never
    {
        self::emit([
            'status'     => 'success',
            'data'       => $data,
            'request_id' => self::requestId(),
        ], $status);
    }

    /** @param array<string,mixed> $details */
    public static function error(
        string $code,
        string $message,
        int $status = 400,
        array $details = []
    ): never {
        Logger::warning('Resposta de erro', [
            'code'    => $code,
            'message' => $message,
            'status'  => $status,
        ]);

        self::emit([
            'status'     => 'error',
            'error'      => [
                'code'    => $code,
                'message' => $message,
                'details' => $details,
            ],
            'request_id' => self::requestId(),
        ], $status);
    }

    /** @param array<string,mixed> $payload */
    private static function emit(array $payload, int $status): never
    {
        if (!\headers_sent()) {
            \http_response_code($status);
            \header('Content-Type: application/json; charset=utf-8');
            \header('X-Request-Id: ' . self::requestId());
            \header('X-Content-Type-Options: nosniff');
            \header('Cache-Control: no-store');
        }

        echo \json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
        );
        exit;
    }
}
