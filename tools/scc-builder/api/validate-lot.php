<?php

declare(strict_types=1);

/**
 * POST /api/validate-lot.php   (Authorization: Bearer <JWT SCC>)
 *
 * Confere um modelo já convertido (preset scc) contra o lote — doc 13 §5.3.
 *
 * Corpo (application/json):
 *   {
 *     "job_id": "job_a1b2…",
 *     "lot": { "id": "A1-078", "polygon": [[x,z], …], "setback_m": 3,
 *              "max_height_m": 160, "far": 6.0 },
 *     "transform": { "rotation_deg": 0, "units": "m", "position": [x,z] }
 *   }
 *
 * "position" é opcional: sem ele o modelo vai para o centroide do lote.
 *
 * 200 { data: { valid, checks[], footprint{hull, area_m2}, suggested_floors,
 *               placement, artifacts{glb, lod1, lod2, meta} } }
 *
 * O resultado não fica gravado: quem guarda a validação aprovada é o
 * serviço World, que chama este endpoint.
 */

require_once __DIR__ . '/config.php';

use SccBuilder\Api\Config;
use SccBuilder\Api\JobRepository;
use SccBuilder\Api\LotValidator;
use SccBuilder\Api\Response;
use SccBuilder\Api\S3Publisher;
use SccBuilder\Api\Security;
use SccBuilder\Api\Storage;
use SccBuilder\Api\ValidationException;

Security::guard();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    Response::error('method_not_allowed', 'Use POST para este endpoint.', 405);
}

$bruto = (string) \file_get_contents('php://input', false, null, 0, 1048576);
$corpo = \json_decode($bruto, true);

if (!\is_array($corpo)) {
    Response::error('invalid_json', 'Envie um corpo JSON (Content-Type: application/json).', 400);
}

$jobId = \trim((string) ($corpo['job_id'] ?? ''));
if ($jobId === '') {
    Response::error('missing_job_id', 'Informe job_id.', 400);
}

$job = JobRepository::find($jobId);
if ($job === null || $job['owner'] !== Security::owner()) {
    Response::error('not_found', 'Job não encontrado.', 404);
}

if ($job['status'] !== JobRepository::COMPLETED) {
    Response::error('job_not_completed', 'O job ainda não terminou (status: ' . $job['status'] . ').', 409);
}

$lot = $corpo['lot'] ?? null;
if (!\is_array($lot)) {
    Response::error('missing_lot', 'Informe lot { polygon, setback_m, max_height_m, far }.', 400);
}

$transform = \is_array($corpo['transform'] ?? null) ? $corpo['transform'] : [];

$artefatos = JobRepository::artifacts($job);

$meta = null;
if (isset($artefatos['modelo.meta.json'])) {
    $arquivo = Storage::resolve(Storage::CONVERTED, $artefatos['modelo.meta.json']);
    $meta    = \json_decode((string) \file_get_contents($arquivo), true);
}

if (!\is_array($meta)) {
    Response::error(
        'meta_missing',
        'O modelo não tem a base calculada (modelo.meta.json). Converta com preset=scc.',
        409
    );
}

// A contagem do banco é a do GLB que foi de fato gravado.
if ($job['triangles_after'] !== null) {
    $meta['triangles'] = $job['triangles_after'];
}

try {
    $resultado = LotValidator::validate($meta, $lot, $transform, [
        'max_triangles'    => (int) Config::get('lot_max_triangles', 300000),
        'floor_height_m'   => (float) Config::get('lot_floor_height_m', 3.2),
        'gfa_efficiency'   => (float) Config::get('lot_gfa_efficiency', 0.85),
        'outorga_scity_m2' => (float) Config::get('lot_outorga_scity_m2', 2.5),
        'min_height_m'     => (float) Config::get('lot_min_height_m', 2),
        'max_height_m'     => (float) Config::get('lot_max_height_m', 400),
    ]);
} catch (ValidationException $e) {
    Response::error($e->errorCode(), $e->getMessage(), $e->statusCode());
}

// Chaves no layout do bucket: builder/<account_id>/<model_id>/v<n>/…
$nomes = [
    'glb'  => 'modelo.glb',
    'lod1' => 'modelo-lod1.glb',
    'lod2' => 'modelo-lod2.glb',
    'meta' => 'modelo.meta.json',
];
$chaves = [];
foreach ($nomes as $campo => $nome) {
    $chaves[$campo] = isset($artefatos[$nome])
        ? S3Publisher::chave((string) $job['owner'], (string) $job['model_id'], (int) $job['version'], $nome)
        : null;
}
$chaves['thumb'] = null; // miniatura renderizada no servidor: ainda não implementada

Response::success([
    'lot_id'    => isset($lot['id']) ? \substr((string) $lot['id'], 0, 64) : null,
    'job_id'    => $jobId,
    'model_id'  => $job['model_id'],
    'version'   => $job['version'],
] + $resultado + [
    'artifacts' => $chaves,
    'published' => S3Publisher::ativo(),
]);
