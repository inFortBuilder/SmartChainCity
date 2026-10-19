<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Validação de arquivos 3D por extensão E por conteúdo (magic bytes / sniffing).
 *
 * Corrige C3 da auditoria: antes, a única barreira era a extensão do nome
 * enviado pelo cliente — trivialmente falsificável.
 */
final class FileValidator
{
    /** Assinaturas binárias conhecidas, por extensão. */
    private const MAGIC = [
        'glb' => "glTF",                 // 0x46546C67
        'fbx' => "Kaydara FBX Binary",   // FBX binário
    ];

    /**
     * Valida um arquivo já gravado em disco.
     *
     * @throws ValidationException
     */
    public static function validate(string $path, string $declaredExt): void
    {
        $ext = \strtolower($declaredExt);

        /** @var string[] $allowed */
        $allowed = (array) Config::get('input_formats', []);
        if (!\in_array($ext, $allowed, true)) {
            throw new ValidationException(
                'unsupported_format',
                "Formato '.{$ext}' não suportado. Aceitos: " . \implode(', ', $allowed) . '.'
            );
        }

        if (!\is_file($path)) {
            throw new ValidationException('file_missing', 'Arquivo não encontrado no servidor.');
        }

        $size = (int) \filesize($path);
        if ($size === 0) {
            throw new ValidationException('empty_file', 'O arquivo enviado está vazio.');
        }

        $max = (int) Config::get('max_file_size');
        if ($size > $max) {
            throw new ValidationException(
                'file_too_large',
                \sprintf('Arquivo de %.1f MB excede o limite de %.0f MB.', $size / 1048576, $max / 1048576)
            );
        }

        $head = (string) \file_get_contents($path, false, null, 0, 4096);

        if (!self::matchesContent($ext, $head)) {
            throw new ValidationException(
                'content_mismatch',
                "O conteúdo do arquivo não corresponde a um '.{$ext}' válido."
            );
        }

        self::rejectEmbeddedScript($ext, $head);
    }

    /** O conteúdo é plausivelmente do formato declarado? */
    private static function matchesContent(string $ext, string $head): bool
    {
        if (isset(self::MAGIC[$ext])) {
            return \str_starts_with($head, self::MAGIC[$ext]);
        }

        $trimmed = \ltrim($head);

        return match ($ext) {
            // JSON com a chave "asset" obrigatória na spec glTF 2.0
            'gltf' => \str_starts_with($trimmed, '{') && \str_contains($head, '"asset"'),

            // XML Collada
            'dae'  => \str_contains($head, '<COLLADA'),

            // Wavefront: comentário, mtllib, grupo, vértice ou objeto
            'obj'  => (bool) \preg_match('/^\s*(#|mtllib|usemtl|g\s|o\s|v\s|vn\s|vt\s|f\s)/mi', $head),

            // STL ASCII começa com "solid"; STL binário tem header de 80 bytes
            // livres seguido de um uint32 com a contagem de triângulos.
            'stl'  => \str_starts_with(\strtolower($trimmed), 'solid') || \strlen($head) >= 84,

            // PLY sempre começa com a palavra mágica "ply"
            'ply'  => \str_starts_with(\strtolower($trimmed), 'ply'),

            // FBX ASCII
            'fbx'  => \str_contains($head, 'FBXHeaderExtension'),

            default => false,
        };
    }

    /**
     * Formatos baseados em texto (OBJ, DAE, glTF) podem carregar payload
     * embutido. Não os executamos, mas recusamos por precaução.
     */
    private static function rejectEmbeddedScript(string $ext, string $head): void
    {
        if (!\in_array($ext, ['obj', 'dae', 'gltf', 'ply', 'stl'], true)) {
            return;
        }

        if (\preg_match('/<\?php|<\?=|<script\b|<%|#!\s*\/bin\//i', $head) === 1) {
            throw new ValidationException(
                'suspicious_content',
                'O arquivo contém marcações executáveis e foi rejeitado.'
            );
        }
    }

    /**
     * Nome de arquivo seguro: sem diretórios, sem caracteres especiais,
     * sem extensão dupla.
     */
    public static function sanitizeBaseName(string $originalName): string
    {
        $base = \pathinfo(\basename($originalName), PATHINFO_FILENAME);
        $base = \preg_replace('/[^A-Za-z0-9_-]+/', '_', $base) ?? '';
        $base = \trim($base, '_-');

        if ($base === '') {
            $base = 'model';
        }

        return \substr($base, 0, 80);
    }

    /**
     * Extensão normalizada e validada contra a allowlist (nunca confia no
     * nome bruto do cliente).
     */
    public static function extensionOf(string $originalName): string
    {
        $ext = \strtolower(\pathinfo(\basename($originalName), PATHINFO_EXTENSION));

        return \preg_replace('/[^a-z0-9]/', '', $ext) ?? '';
    }
}
