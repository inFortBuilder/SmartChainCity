<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Gestão dos diretórios de armazenamento.
 *
 * Diferenças em relação à v1:
 *  - permissões 0750 em vez de 0777;
 *  - `.htaccess` de bloqueio gravado automaticamente quando o storage
 *    fica dentro do webroot;
 *  - download sempre mediado por PHP (`download.php`), nunca por URL direta;
 *  - limpeza por retenção.
 */
final class Storage
{
    public const UPLOADS   = 'uploads';
    public const CONVERTED = 'converted';

    private const HTACCESS = <<<'HTA'
        # SCC Builder — bloqueio total de acesso HTTP direto a este diretório.
        # Os arquivos devem ser servidos exclusivamente por api/download.php.
        php_flag engine off
        RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .phar
        RemoveType .php .phtml .php3 .php4 .php5 .php7 .phar
        AddType text/plain .php .phtml .phar .html .htm

        <IfModule mod_authz_core.c>
            Require all denied
        </IfModule>
        <IfModule !mod_authz_core.c>
            Order allow,deny
            Deny from all
        </IfModule>
        HTA;

    public static function root(): string
    {
        return (string) Config::get('storage_dir');
    }

    public static function dir(string $name): string
    {
        $path = self::root() . '/' . $name;
        self::ensure($path);

        return $path;
    }

    public static function ensure(string $path): void
    {
        if (!\is_dir($path) && !@\mkdir($path, 0o750, true) && !\is_dir($path)) {
            throw new \RuntimeException("Não foi possível criar o diretório: {$path}");
        }
    }

    /**
     * Cria a árvore de storage e a protege. Chamado no bootstrap.
     */
    public static function bootstrap(): void
    {
        $root = self::root();
        self::ensure($root);

        foreach ([self::UPLOADS, self::CONVERTED, 'logs', 'ratelimit', 'tmp'] as $sub) {
            self::ensure($root . '/' . $sub);
        }

        // Só faz sentido escrever .htaccess se o storage estiver no webroot.
        if (self::isInsideWebroot()) {
            $file = $root . '/.htaccess';
            if (!\is_file($file)) {
                @\file_put_contents($file, self::HTACCESS);
            }
            @\file_put_contents($root . '/index.html', '');
        }
    }

    public static function isInsideWebroot(): bool
    {
        $docRoot = \str_replace('\\', '/', (string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
        if ($docRoot === '') {
            return true; // na dúvida, protege
        }

        return \str_starts_with(self::root(), \rtrim($docRoot, '/'));
    }

    /**
     * Resolve um nome de arquivo dentro de um diretório do storage,
     * garantindo que não há path traversal.
     *
     * @throws ValidationException
     */
    public static function resolve(string $dirName, string $fileName): string
    {
        $safe = \basename(\str_replace('\\', '/', $fileName));

        if ($safe === '' || $safe === '.' || $safe === '..' || \str_contains($safe, "\0")) {
            throw new ValidationException('invalid_filename', 'Nome de arquivo inválido.');
        }

        $dir  = self::dir($dirName);
        $path = $dir . '/' . $safe;

        $real    = \realpath($path);
        $realDir = \realpath($dir);

        if ($real === false || $realDir === false) {
            throw new ValidationException('not_found', 'Arquivo não encontrado.', 404);
        }

        if (!\str_starts_with(\str_replace('\\', '/', $real), \str_replace('\\', '/', $realDir))) {
            throw new ValidationException('path_traversal', 'Caminho de arquivo inválido.', 400);
        }

        return $real;
    }

    /**
     * Remove arquivos mais antigos que `retention_days`.
     *
     * @return int quantidade de arquivos removidos
     */
    public static function purgeExpired(): int
    {
        $days = (int) Config::get('retention_days', 30);
        if ($days <= 0) {
            return 0;
        }

        $cutoff  = \time() - ($days * 86400);
        $removed = 0;

        foreach ([self::UPLOADS, self::CONVERTED] as $sub) {
            foreach ((array) \glob(self::dir($sub) . '/*') as $file) {
                if (\is_string($file) && \is_file($file) && \filemtime($file) < $cutoff) {
                    if (@\unlink($file)) {
                        $removed++;
                    }
                }
            }
        }

        if ($removed > 0) {
            Logger::info('Limpeza por retenção executada', ['removidos' => $removed, 'dias' => $days]);
        }

        return $removed;
    }

    public static function humanSize(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i     = 0;
        $value = (float) $bytes;

        while ($value >= 1024 && $i < \count($units) - 1) {
            $value /= 1024;
            $i++;
        }

        return \sprintf('%.1f %s', $value, $units[$i]);
    }
}
