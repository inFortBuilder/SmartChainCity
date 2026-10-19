<?php

declare(strict_types=1);

/**
 * GET /api/download.php?job_id=job_xxx[&source=converted|original]
 *
 * Serve o arquivo por PHP. O diretório de storage nunca é exposto
 * diretamente pelo Apache (corrige C3 da auditoria).
 */

require_once __DIR__ . '/config.php';

use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Logger;
use SccBuilder\Api\Response;
use SccBuilder\Api\Security;
use SccBuilder\Api\Storage;
use SccBuilder\Api\ValidationException;

Security::guard();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    Response::error('method_not_allowed', 'Use GET para este endpoint.', 405);
}

$jobId = \trim((string) ($_GET['job_id'] ?? ''));
if ($jobId === '') {
    Response::error('missing_job_id', 'Informe job_id.', 400);
}

$job = JobRepository::find($jobId);
if ($job === null || $job['owner'] !== Security::owner()) {
    Response::error('not_found', 'Job não encontrado.', 404);
}

$source = ($_GET['source'] ?? 'converted') === 'original' ? 'original' : 'converted';

if ($source === 'converted') {
    if ($job['status'] !== JobRepository::COMPLETED || empty($job['output_file'])) {
        Response::error('not_ready', 'A conversão ainda não foi concluída.', 409, ['job' => $job]);
    }
    $dir      = Storage::CONVERTED;
    $fileName = (string) $job['output_file'];
    $download = \pathinfo((string) $job['original_name'], PATHINFO_FILENAME)
        . '.' . $job['target_format'];
} else {
    $dir      = Storage::UPLOADS;
    $fileName = (string) $job['input_file'];
    $download = (string) $job['original_name'];
}

try {
    $path = Storage::resolve($dir, $fileName);
} catch (ValidationException $e) {
    Response::error($e->errorCode(), $e->getMessage(), $e->statusCode());
}

$mime = match (\strtolower(\pathinfo($path, PATHINFO_EXTENSION))) {
    'glb'  => 'model/gltf-binary',
    'gltf' => 'model/gltf+json',
    'obj'  => 'text/plain',
    'stl'  => 'model/stl',
    'ply'  => 'application/octet-stream',
    default => 'application/octet-stream',
};

Logger::info('Download servido', ['job_id' => $jobId, 'source' => $source]);

// Sanitiza o nome exposto no header
$safeDownload = \preg_replace('/[^A-Za-z0-9._-]/', '_', $download) ?? 'model';

\header_remove('Cache-Control');
\header('Content-Type: ' . $mime);
\header('Content-Length: ' . \filesize($path));
\header('Content-Disposition: attachment; filename="' . $safeDownload . '"');
\header('X-Content-Type-Options: nosniff');
\header('Cache-Control: private, max-age=3600');

// Descarrega buffers para não estourar memória em arquivos grandes
while (\ob_get_level() > 0) {
    \ob_end_clean();
}

\readfile($path);
exit;
