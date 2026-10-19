<?php

declare(strict_types=1);

/**
 * POST /api/convert.php
 *
 * Recebe um arquivo 3D e devolve um job de conversão.
 *
 * Headers:
 *   Authorization: Bearer <JWT SCC>   (jogador; escopo = account_id)
 *   ou X-API-Key: <chave> [+ X-Account-Id: <account_id>]   (servidor a servidor)
 *
 * Campos (multipart/form-data):
 *   file            (obrigatório) arquivo 3D
 *   target_format   glb | gltf                       (default: glb)
 *   optimize        none | balanced | aggressive     (default: balanced)
 *   flip_axis       true | false                     (default: false)
 *   scale           float                            (default: 1.0)
 *   preset          scc | none — scc: Y-up, metros, meshopt, LODs e
 *                   modelo.meta.json para o validate-lot (default: scc)
 *   model_id        id do modelo do jogador; reenvio do mesmo id gera v2, v3…
 *                   (default: um mdl_ novo)
 *   external_ref    identificador do seu sistema (ex.: id do lote no World)
 *   async           true | false — força fila mesmo em arquivos pequenos
 *
 * Respostas:
 *   201 { data: { job:{...} } }  → concluído de forma síncrona
 *   202 { data: { job:{...} } }  → enfileirado; consulte jobs.php
 */

require_once __DIR__ . '/config.php';

use SccBuilder\Api\Config;
use SccBuilder\Api\ConversionRunner;
use SccBuilder\Api\FileValidator;
use SccBuilder\Api\JobRepository;
use SccBuilder\Api\Logger;
use SccBuilder\Api\Response;
use SccBuilder\Api\S3Publisher;
use SccBuilder\Api\Security;
use SccBuilder\Api\Storage;
use SccBuilder\Api\ValidationException;

Security::guard();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    Response::error('method_not_allowed', 'Use POST para este endpoint.', 405);
}

// ── 1. Upload ────────────────────────────────────────────────────────────
if (!isset($_FILES['file'])) {
    $postMax = \ini_get('post_max_size');
    Response::error(
        'no_file',
        'Nenhum arquivo recebido no campo "file". Se o arquivo for grande, verifique '
            . "upload_max_filesize e post_max_size no php.ini (post_max_size atual: {$postMax}).",
        400
    );
}

$upload = $_FILES['file'];

if (($upload['error'] ?? \UPLOAD_ERR_NO_FILE) !== \UPLOAD_ERR_OK) {
    Response::error('upload_error', uploadErrorMessage((int) $upload['error']), 400, [
        'php_error_code'      => $upload['error'],
        'upload_max_filesize' => \ini_get('upload_max_filesize'),
        'post_max_size'       => \ini_get('post_max_size'),
    ]);
}

if (!\is_uploaded_file($upload['tmp_name'])) {
    Response::error('invalid_upload', 'O arquivo informado não é um upload HTTP válido.', 400);
}

// ── 2. Parâmetros ────────────────────────────────────────────────────────
$targetFormat = \strtolower(\trim((string) ($_POST['target_format'] ?? 'glb')));
if (!\in_array($targetFormat, (array) Config::get('output_formats'), true)) {
    Response::error(
        'invalid_target_format',
        'Formato de saída inválido. Aceitos: ' . \implode(', ', (array) Config::get('output_formats')) . '.',
        400
    );
}

$optimizeLevel = \strtolower(\trim((string) ($_POST['optimize'] ?? 'balanced')));
if (!\in_array($optimizeLevel, ['none', 'balanced', 'aggressive'], true)) {
    Response::error('invalid_optimize', 'optimize deve ser none, balanced ou aggressive.', 400);
}

$flipAxis = \filter_var($_POST['flip_axis'] ?? false, \FILTER_VALIDATE_BOOLEAN);
$scale    = (float) ($_POST['scale'] ?? 1.0);

if ($scale <= 0 || $scale > 10000 || !\is_finite($scale)) {
    Response::error('invalid_scale', 'scale deve ser um número entre 0 (exclusivo) e 10000.', 400);
}

$externalRef = \substr(\trim((string) ($_POST['external_ref'] ?? '')), 0, 128) ?: null;

$preset = \strtolower(\trim((string) ($_POST['preset'] ?? 'scc')));
if (!\in_array($preset, ['scc', 'none'], true)) {
    Response::error('invalid_preset', 'preset deve ser scc ou none.', 400);
}
if ($preset === 'scc' && $targetFormat !== 'glb') {
    Response::error('invalid_target_format', 'O preset scc gera apenas GLB.', 400);
}

$modelId = \trim((string) ($_POST['model_id'] ?? ''));
if ($modelId !== '' && \preg_match('/^[A-Za-z0-9_-]{1,64}$/', $modelId) !== 1) {
    Response::error('invalid_model_id', 'model_id aceita letras, números, "_" e "-" (até 64).', 400);
}

// ── 3. Persistir e validar o arquivo ─────────────────────────────────────
$originalName = (string) $upload['name'];
$ext          = FileValidator::extensionOf($originalName);
$baseName     = FileValidator::sanitizeBaseName($originalName);
$token        = \bin2hex(\random_bytes(8));

$storedName = "{$token}_{$baseName}.{$ext}";
$storedPath = Storage::dir(Storage::UPLOADS) . '/' . $storedName;

if (!\move_uploaded_file($upload['tmp_name'], $storedPath)) {
    Response::error('storage_failed', 'Falha ao gravar o arquivo no servidor.', 500);
}

try {
    FileValidator::validate($storedPath, $ext);
} catch (ValidationException $e) {
    @\unlink($storedPath);
    Logger::warning('Upload rejeitado na validação', [
        'arquivo' => $originalName,
        'motivo'  => $e->errorCode(),
    ]);
    Response::error($e->errorCode(), $e->getMessage(), $e->statusCode());
}

// ── 4. Criar o job ───────────────────────────────────────────────────────
$inputSize = (int) \filesize($storedPath);

$jobId = JobRepository::create([
    'owner'          => Security::owner(),
    'builder_company_id' => Security::builderCompanyId(),
    'model_id'       => $modelId,
    'preset'         => $preset === 'none' ? null : $preset,
    'external_ref'   => $externalRef,
    'original_name'  => $originalName,
    'input_format'   => $ext,
    'target_format'  => $targetFormat,
    'optimize_level' => $optimizeLevel,
    'flip_axis'      => $flipAxis,
    'scale'          => $scale,
    'input_file'     => $storedName,
    'input_size'     => $inputSize,
]);

// ── 5. Síncrono ou enfileirado? ──────────────────────────────────────────
$forceAsync = \filter_var($_POST['async'] ?? false, \FILTER_VALIDATE_BOOLEAN);
$threshold  = (int) Config::get('async_threshold', 16777216);
$useQueue   = Config::get('queue_enabled') === true && ($forceAsync || $inputSize > $threshold);

if ($useQueue) {
    Response::success([
        'job'  => JobRepository::find($jobId),
        'mode' => 'async',
        'hint' => 'Consulte GET jobs.php?job_id=' . $jobId . ' para acompanhar o progresso.',
    ], 202);
}

// Execução síncrona
JobRepository::markProcessing($jobId);
$outputName = "{$token}_{$baseName}.{$targetFormat}";
$outputPath = Storage::dir(Storage::CONVERTED) . '/' . $outputName;

$run = ConversionRunner::run(
    $storedPath,
    $outputPath,
    $targetFormat,
    $optimizeLevel,
    $flipAxis,
    $scale,
    $preset === 'none' ? null : $preset
);

if (!$run['ok']) {
    JobRepository::markFailed($jobId, $run['code'], $run['message']);
    Response::error($run['code'], $run['message'], 422, [
        'job'  => JobRepository::find($jobId),
        'log'  => Config::get('debug') === true ? $run['log'] : null,
    ]);
}

JobRepository::markCompleted($jobId, $run['result'] + ['output_file' => $outputName]);

// ── 6. Publicar no bucket SCC (opcional) ─────────────────────────────────
// builder/<account_id>/<model_id>/v<n>/modelo.glb, mais LODs e meta.
$job     = (array) JobRepository::find($jobId);
$locais  = \array_map(
    static fn (string $nome): string => Storage::dir(Storage::CONVERTED) . '/' . $nome,
    JobRepository::artifacts($job)
);
$chaves = S3Publisher::publicarJob($job, $locais);

Response::success([
    'job'     => $job,
    'mode'    => 'sync',
    's3_keys' => $chaves,
    's3_url'  => isset($chaves['modelo.glb']) ? S3Publisher::url($chaves['modelo.glb']) : null,
], 201);

// ── Helpers ──────────────────────────────────────────────────────────────

function uploadErrorMessage(int $code): string
{
    return match ($code) {
        \UPLOAD_ERR_INI_SIZE   => 'Arquivo maior que upload_max_filesize do php.ini.',
        \UPLOAD_ERR_FORM_SIZE  => 'Arquivo maior que MAX_FILE_SIZE do formulário.',
        \UPLOAD_ERR_PARTIAL    => 'O upload foi interrompido antes de terminar.',
        \UPLOAD_ERR_NO_FILE    => 'Nenhum arquivo foi enviado.',
        \UPLOAD_ERR_NO_TMP_DIR => 'Diretório temporário do PHP ausente.',
        \UPLOAD_ERR_CANT_WRITE => 'Falha de escrita em disco no servidor.',
        \UPLOAD_ERR_EXTENSION  => 'Uma extensão do PHP interrompeu o upload.',
        default                => 'Erro desconhecido no upload.',
    };
}
