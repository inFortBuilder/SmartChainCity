<?php

declare(strict_types=1);

namespace SccBuilder\Api;

use PDO;

/**
 * Persistência em SQLite (PDO) — substitui o `glob()` do disco por
 * metadados reais: dono, status, contagem de triângulos, tempo de
 * conversão, taxa de compressão.
 *
 * SQLite é suficiente para milhares de jobs e não exige nada além do
 * pdo_sqlite (habilitado por padrão no WAMP).
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        Storage::ensure(Storage::root());
        $file = Storage::root() . '/scc-builder.sqlite';

        $pdo = new PDO('sqlite:' . $file, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);

        // WAL permite leitura concorrente enquanto o worker escreve.
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = ON');

        self::$pdo = $pdo;
        self::migrate($pdo);

        return $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS jobs (
                id                TEXT PRIMARY KEY,
                owner             TEXT NOT NULL DEFAULT 'anonymous',
                builder_company_id TEXT,
                model_id          TEXT,
                version           INTEGER NOT NULL DEFAULT 1,
                preset            TEXT,
                external_ref      TEXT,
                status            TEXT NOT NULL DEFAULT 'queued',
                progress          INTEGER NOT NULL DEFAULT 0,
                original_name     TEXT NOT NULL,
                input_format      TEXT NOT NULL,
                target_format     TEXT NOT NULL DEFAULT 'glb',
                optimize_level    TEXT NOT NULL DEFAULT 'balanced',
                flip_axis         INTEGER NOT NULL DEFAULT 0,
                scale             REAL NOT NULL DEFAULT 1.0,
                input_file        TEXT NOT NULL,
                output_file       TEXT,
                input_size        INTEGER NOT NULL DEFAULT 0,
                output_size       INTEGER,
                triangles_before  INTEGER,
                triangles_after   INTEGER,
                duration_ms       INTEGER,
                error_code        TEXT,
                error_message     TEXT,
                created_at        TEXT NOT NULL,
                started_at        TEXT,
                finished_at       TEXT
            )
            SQL
        );

        // Bancos criados pelo Convert3D original não têm as colunas do SCC
        // Builder: acrescenta o que faltar, sem perder os jobs existentes.
        $colunas = \array_column($pdo->query('PRAGMA table_info(jobs)')->fetchAll(), 'name');
        foreach (
            [
                'builder_company_id' => 'TEXT',
                'model_id'           => 'TEXT',
                'version'            => 'INTEGER NOT NULL DEFAULT 1',
                'preset'             => 'TEXT',
            ] as $coluna => $tipo
        ) {
            if (!\in_array($coluna, $colunas, true)) {
                $pdo->exec("ALTER TABLE jobs ADD COLUMN {$coluna} {$tipo}");
            }
        }

        foreach (
            [
                'CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs (status, created_at)',
                'CREATE INDEX IF NOT EXISTS idx_jobs_owner   ON jobs (owner, created_at DESC)',
                'CREATE INDEX IF NOT EXISTS idx_jobs_ref     ON jobs (external_ref)',
                'CREATE INDEX IF NOT EXISTS idx_jobs_model   ON jobs (owner, model_id, version)',
            ] as $sql
        ) {
            $pdo->exec($sql);
        }
    }

    /** Apenas para testes. */
    public static function reset(): void
    {
        self::$pdo = null;
    }
}
