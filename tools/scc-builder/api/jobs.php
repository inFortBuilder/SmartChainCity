<?php

declare(strict_types=1);

/**
 * GET /api/jobs.php?job_id=job_xxx        → detalhe de um job
 * GET /api/jobs.php?status=queued&page=1  → lista paginada
 * DELETE /api/jobs.php?job_id=job_xxx     → remove job e arquivos
 */

require_once __DIR__ . '/config.php';

use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Response;
use SccBuilder\Api\Security;

Security::guard();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$owner  = Security::owner();

if ($method === 'GET') {
    $jobId = \trim((string) ($_GET['job_id'] ?? ''));

    if ($jobId !== '') {
        $job = JobRepository::find($jobId);

        if ($job === null || $job['owner'] !== $owner) {
            Response::error('not_found', 'Job não encontrado.', 404);
        }

        Response::success(['job' => $job]);
    }

    $status = \trim((string) ($_GET['status'] ?? ''));
    if ($status !== '' && !\in_array($status, ['queued', 'processing', 'completed', 'failed'], true)) {
        Response::error('invalid_status', 'status inválido.', 400);
    }

    $page    = (int) ($_GET['page'] ?? 1);
    $perPage = (int) ($_GET['per_page'] ?? 20);

    $result = JobRepository::paginate($owner, $status ?: null, $page, $perPage);

    Response::success([
        'jobs'       => $result['items'],
        'pagination' => [
            'page'        => \max(1, $page),
            'per_page'    => \max(1, \min(100, $perPage)),
            'total'       => $result['total'],
            'total_pages' => (int) \ceil($result['total'] / \max(1, \min(100, $perPage))),
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
        Response::error('missing_job_id', 'Informe job_id.', 400);
    }

    if (!JobRepository::delete($jobId, $owner)) {
        Response::error('not_found', 'Job não encontrado ou sem permissão.', 404);
    }

    Response::success(['deleted' => true, 'job_id' => $jobId]);
}

Response::error('method_not_allowed', 'Métodos aceitos: GET, DELETE.', 405);
