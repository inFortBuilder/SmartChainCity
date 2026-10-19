<?php

declare(strict_types=1);

namespace SccBuilder\Api;

use PDO;

/**
 * Repositório dos jobs de conversão.
 *
 * Estados: queued → processing → completed | failed
 */
final class JobRepository
{
    public const QUEUED     = 'queued';
    public const PROCESSING = 'processing';
    public const COMPLETED  = 'completed';
    public const FAILED     = 'failed';

    /** @param array<string,mixed> $data */
    public static function create(array $data): string
    {
        $id = 'job_' . \bin2hex(\random_bytes(10));

        $stmt = Database::pdo()->prepare(
            'INSERT INTO jobs (
                id, owner, builder_company_id, model_id, version, preset,
                external_ref, status, original_name, input_format,
                target_format, optimize_level, flip_axis, scale, input_file,
                input_size, created_at
             ) VALUES (
                :id, :owner, :builder_company_id, :model_id, :version, :preset,
                :external_ref, :status, :original_name, :input_format,
                :target_format, :optimize_level, :flip_axis, :scale, :input_file,
                :input_size, :created_at
             )'
        );

        $owner   = (string) ($data['owner'] ?? 'anonymous');
        $modelId = (string) ($data['model_id'] ?? '') ?: 'mdl_' . \bin2hex(\random_bytes(6));

        $stmt->execute([
            'id'             => $id,
            'owner'          => $owner,
            'builder_company_id' => $data['builder_company_id'] ?? null,
            'model_id'       => $modelId,
            'version'        => self::nextVersion($owner, $modelId),
            'preset'         => $data['preset'] ?? null,
            'external_ref'   => $data['external_ref'] ?? null,
            'status'         => self::QUEUED,
            'original_name'  => $data['original_name'],
            'input_format'   => $data['input_format'],
            'target_format'  => $data['target_format'] ?? 'glb',
            'optimize_level' => $data['optimize_level'] ?? 'balanced',
            'flip_axis'      => !empty($data['flip_axis']) ? 1 : 0,
            'scale'          => (float) ($data['scale'] ?? 1.0),
            'input_file'     => $data['input_file'],
            'input_size'     => (int) ($data['input_size'] ?? 0),
            'created_at'     => \date('c'),
        ]);

        Logger::info('Job criado', ['job_id' => $id, 'formato' => $data['input_format']]);

        return $id;
    }

    /**
     * Próxima versão de um modelo do jogador: v1, v2… Cada reenvio do mesmo
     * model_id vira uma pasta nova no bucket, e a anterior continua lá — o
     * prédio já publicado na cidade não muda por baixo do jogo.
     */
    public static function nextVersion(string $owner, string $modelId): int
    {
        $stmt = Database::pdo()->prepare(
            'SELECT MAX(version) AS v FROM jobs WHERE owner = :o AND model_id = :m'
        );
        $stmt->execute(['o' => $owner, 'm' => $modelId]);

        return (int) ($stmt->fetch()['v'] ?? 0) + 1;
    }

    /**
     * Arquivos de um job concluído: nome no bucket => nome em storage/converted.
     * O GLB principal e, quando o preset "scc" os gerou, os LODs e o
     * modelo.meta.json (contorno da base, caixa, triângulos).
     *
     * @param array<string,mixed> $job
     * @return array<string,string>
     */
    public static function artifacts(array $job): array
    {
        $saida = (string) ($job['output_file'] ?? '');
        if ($saida === '') {
            return [];
        }

        $ext  = \pathinfo($saida, \PATHINFO_EXTENSION);
        $base = \substr($saida, 0, -\strlen($ext) - 1);

        $lista = ['modelo.' . $ext => $saida];
        foreach ([
            'modelo-lod1.' . $ext => $base . '-lod1.' . $ext,
            'modelo-lod2.' . $ext => $base . '-lod2.' . $ext,
            'modelo.meta.json'    => $base . '.meta.json',
        ] as $nome => $arquivo) {
            if (\is_file(Storage::dir(Storage::CONVERTED) . '/' . $arquivo)) {
                $lista[$nome] = $arquivo;
            }
        }

        return $lista;
    }

    /** @return array<string,mixed>|null */
    public static function find(string $id): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM jobs WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : self::hydrate($row);
    }

    public static function markProcessing(string $id): void
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE jobs SET status = :s, started_at = :t, progress = 5
             WHERE id = :id AND status = :q'
        );
        $stmt->execute(['s' => self::PROCESSING, 't' => \date('c'), 'id' => $id, 'q' => self::QUEUED]);
    }

    public static function updateProgress(string $id, int $progress): void
    {
        $stmt = Database::pdo()->prepare('UPDATE jobs SET progress = :p WHERE id = :id');
        $stmt->execute(['p' => \max(0, \min(100, $progress)), 'id' => $id]);
    }

    /** @param array<string,mixed> $result */
    public static function markCompleted(string $id, array $result): void
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE jobs SET status = :s, progress = 100, output_file = :of,
                output_size = :os, triangles_before = :tb, triangles_after = :ta,
                duration_ms = :d, finished_at = :t
             WHERE id = :id'
        );

        $stmt->execute([
            's'  => self::COMPLETED,
            'of' => $result['output_file'] ?? null,
            'os' => isset($result['output_size']) ? (int) $result['output_size'] : null,
            'tb' => isset($result['triangles_before']) ? (int) $result['triangles_before'] : null,
            'ta' => isset($result['triangles_after']) ? (int) $result['triangles_after'] : null,
            'd'  => isset($result['duration_ms']) ? (int) $result['duration_ms'] : null,
            't'  => \date('c'),
            'id' => $id,
        ]);

        Logger::info('Job concluído', ['job_id' => $id] + $result);
    }

    public static function markFailed(string $id, string $code, string $message): void
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE jobs SET status = :s, error_code = :c, error_message = :m, finished_at = :t
             WHERE id = :id'
        );
        $stmt->execute([
            's'  => self::FAILED,
            'c'  => $code,
            'm'  => \substr($message, 0, 2000),
            't'  => \date('c'),
            'id' => $id,
        ]);

        Logger::error('Job falhou', ['job_id' => $id, 'code' => $code, 'message' => $message]);
    }

    /**
     * Reserva o próximo job da fila de forma atômica (evita dois workers
     * pegarem o mesmo job).
     *
     * @return array<string,mixed>|null
     */
    public static function claimNext(): ?array
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();

        try {
            $stmt = $pdo->query(
                "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
            );
            $row = $stmt === false ? false : $stmt->fetch();

            if ($row === false) {
                $pdo->commit();

                return null;
            }

            $upd = $pdo->prepare(
                "UPDATE jobs SET status = 'processing', started_at = :t, progress = 5
                 WHERE id = :id AND status = 'queued'"
            );
            $upd->execute(['t' => \date('c'), 'id' => $row['id']]);

            if ($upd->rowCount() === 0) {
                $pdo->commit();

                return null; // outro worker pegou primeiro
            }

            $pdo->commit();

            return self::hydrate($row);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * @return array{items: array<int,array<string,mixed>>, total: int}
     */
    public static function paginate(
        string $owner,
        ?string $status = null,
        int $page = 1,
        int $perPage = 20,
        bool $scopeToOwner = true
    ): array {
        $page    = \max(1, $page);
        $perPage = \max(1, \min(100, $perPage));

        $where  = [];
        $params = [];

        if ($scopeToOwner) {
            $where[]          = 'owner = :owner';
            $params['owner']  = $owner;
        }
        if ($status !== null && $status !== '') {
            $where[]          = 'status = :status';
            $params['status'] = $status;
        }

        $clause = $where === [] ? '' : ' WHERE ' . \implode(' AND ', $where);

        $countStmt = Database::pdo()->prepare('SELECT COUNT(*) AS c FROM jobs' . $clause);
        $countStmt->execute($params);
        $total = (int) ($countStmt->fetch()['c'] ?? 0);

        $stmt = Database::pdo()->prepare(
            'SELECT * FROM jobs' . $clause . ' ORDER BY created_at DESC LIMIT :limit OFFSET :offset'
        );
        foreach ($params as $k => $v) {
            $stmt->bindValue(':' . $k, $v);
        }
        $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $stmt->execute();

        return [
            'items' => \array_map([self::class, 'hydrate'], $stmt->fetchAll()),
            'total' => $total,
        ];
    }

    public static function delete(string $id, string $owner, bool $scopeToOwner = true): bool
    {
        $job = self::find($id);
        if ($job === null) {
            return false;
        }
        if ($scopeToOwner && $job['owner'] !== $owner) {
            return false;
        }

        $arquivos = [[Storage::UPLOADS, $job['input_file']]];
        foreach (self::artifacts($job) as $local) {
            $arquivos[] = [Storage::CONVERTED, $local];
        }

        foreach ($arquivos as [$dir, $name]) {
            if (\is_string($name) && $name !== '') {
                try {
                    @\unlink(Storage::resolve($dir, $name));
                } catch (ValidationException) {
                    // já removido — segue
                }
            }
        }

        $stmt = Database::pdo()->prepare('DELETE FROM jobs WHERE id = :id');
        $stmt->execute(['id' => $id]);

        Logger::info('Job removido', ['job_id' => $id]);

        return true;
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private static function hydrate(array $row): array
    {
        $row['flip_axis'] = (bool) $row['flip_axis'];
        $row['progress']  = (int) $row['progress'];
        $row['scale']     = (float) $row['scale'];
        $row['version']   = (int) ($row['version'] ?? 1);

        foreach (['input_size', 'output_size', 'triangles_before', 'triangles_after', 'duration_ms'] as $k) {
            $row[$k] = $row[$k] === null ? null : (int) $row[$k];
        }

        if ($row['input_size'] > 0 && ($row['output_size'] ?? 0) > 0) {
            $row['compression_ratio'] = \round(1 - ($row['output_size'] / $row['input_size']), 4);
        } else {
            $row['compression_ratio'] = null;
        }

        $row['download_url'] = $row['status'] === self::COMPLETED && $row['output_file'] !== null
            ? 'download.php?job_id=' . \rawurlencode((string) $row['id'])
            : null;

        return $row;
    }
}
