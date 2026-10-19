<?php

declare(strict_types=1);

/**
 * GET /api/models.php?action=list[&page=1&per_page=20]
 *   Lista os modelos convertidos com sucesso (escopo: dono da API key).
 *
 * DELETE /api/models.php?job_id=job_xxx
 *   Remove um modelo e seus arquivos.
 *
 * Compatibilidade: este endpoint existia na v1 varrendo o disco com glob(),
 * sem dono, sem paginação e sem autenticação. Agora é uma projeção da
 * tabela de jobs, escopada pela API key.
 */

require_once __DIR__ . '/config.php';

use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Response;
use SccBuilder\Api\Security;
use SccBuilder\Api\Storage;

Security::guard();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$owner  = Security::owner();

if ($method === 'GET') {
    $action = (string) ($_GET['action'] ?? 'list');

    if ($action !== 'list') {
        Response::error('unknown_action', "Ação '{$action}' desconhecida. Use action=list.", 400);
    }

    $page    = (int) ($_GET['page'] ?? 1);
    $perPage = (int) ($_GET['per_page'] ?? 20);

    $result = JobRepository::paginate($owner, JobRepository::COMPLETED, $page, $perPage);

    $models = \array_map(
        static fn (array $job): array => [
            'job_id'            => $job['id'],
            'external_ref'      => $job['external_ref'],
            'name'              => $job['original_name'],
            'input_format'      => $job['input_format'],
            'format'            => $job['target_format'],
            'size'              => $job['output_size'],
            'size_human'        => Storage::humanSize((int) ($job['output_size'] ?? 0)),
            'input_size'        => $job['input_size'],
            'compression_ratio' => $job['compression_ratio'],
            'triangles'         => $job['triangles_after'],
            'triangles_before'  => $job['triangles_before'],
            'duration_ms'       => $job['duration_ms'],
            'created_at'        => $job['created_at'],
            'download_url'      => $job['download_url'],
        ],
        $result['items']
    );

    $perPage = \max(1, \min(100, $perPage));

    Response::success([
        'models'     => $models,
        'count'      => \count($models),
        'pagination' => [
            'page'        => \max(1, $page),
            'per_page'    => $perPage,
            'total'       => $result['total'],
            'total_pages' => (int) \ceil($result['total'] / $perPage),
        ],
    ]);
}

if ($method === 'DELETE') {
    $jobId = \trim((string) ($_GET['job_id'] ?? ''));

    if ($jobId === '') {
        \parse_str((string) \file_get_contents('php://input'), $body);
        $jobId = \trim((string) ($body['job_id'] ?? ''));
    }

    if ($jobId === '') {
        Response::error(
            'missing_job_id',
            'Informe job_id. A exclusão por nome de arquivo foi removida na v2 por segurança.',
            400
        );
    }

    if (!JobRepository::delete($jobId, $owner)) {
        Response::error('not_found', 'Modelo não encontrado ou sem permissão.', 404);
    }

    Response::success(['deleted' => true, 'job_id' => $jobId]);
}

Response::error('method_not_allowed', 'Métodos aceitos: GET, DELETE.', 405);
