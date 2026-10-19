<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Confere um modelo convertido contra o polígono e as regras de um lote
 * (doc 13 §4, passo 3, e §5.3).
 *
 * Parte do protótipo da cidade (docs/proposta-cidade-realista/main.js:
 * footprintPoints, convexHull, validate), com uma diferença de propósito:
 * o recuo. O protótipo encolhe o polígono em direção ao centroide, o que
 * erra o recuo em lote comprido ou com reentrância. Aqui um ponto está na
 * área edificável quando está dentro do lote E a pelo menos `setback_m` de
 * todas as divisas — a definição exata do polígono reduzido, que vale para
 * qualquer lote simples, convexo ou não.
 *
 * Sem I/O: recebe a meta do modelo (modelo.meta.json) e devolve o
 * resultado. É o que os testes exercitam.
 */
final class LotValidator
{
    /** Fator de cada unidade de origem para metros. */
    public const UNITS = [
        'm'  => 1.0,
        'cm' => 0.01,
        'mm' => 0.001,
        'in' => 0.0254,
        'ft' => 0.3048,
    ];

    /**
     * @param array<string,mixed> $meta      conteúdo do modelo.meta.json
     * @param array<string,mixed> $lot       polygon [[x,z]…], setback_m, max_height_m, far
     * @param array<string,mixed> $transform rotation_deg, units, position [x,z] (opcional)
     * @param array<string,mixed> $regras    max_triangles, floor_height_m, gfa_efficiency,
     *                                       outorga_scity_m2, min_height_m, max_height_m
     *
     * @return array<string,mixed> valid, checks, footprint, suggested_floors, placement
     *
     * @throws ValidationException entrada malformada
     */
    public static function validate(array $meta, array $lot, array $transform = [], array $regras = []): array
    {
        $poligono = self::poligono($lot['polygon'] ?? null);
        $recuo    = self::numero($lot, 'setback_m', 0.0, 0.0, 1000.0);
        $gabarito = self::numero($lot, 'max_height_m', \INF, 0.0, 10000.0);
        $far      = self::numero($lot, 'far', \INF, 0.0, 100.0);

        $unidade = (string) ($transform['units'] ?? 'm');
        if (!isset(self::UNITS[$unidade])) {
            throw new ValidationException(
                'invalid_units',
                'transform.units deve ser um de: ' . \implode(', ', \array_keys(self::UNITS)) . '.',
                400
            );
        }
        $escala  = self::UNITS[$unidade];
        $rotacao = \deg2rad(self::numero($transform, 'rotation_deg', 0.0, -360.0, 360.0));

        $maxTri     = (int) ($regras['max_triangles'] ?? 300000);
        $peDireito  = (float) ($regras['floor_height_m'] ?? 3.2);
        $eficiencia = (float) ($regras['gfa_efficiency'] ?? 0.85);
        $taxa       = (float) ($regras['outorga_scity_m2'] ?? 2.5);
        $minAltura  = (float) ($regras['min_height_m'] ?? 2.0);
        $maxAltura  = (float) ($regras['max_height_m'] ?? 400.0);

        $bbox = $meta['bbox'] ?? null;
        $base = $meta['footprint']['points'] ?? null;
        if (!\is_array($bbox) || !\is_array($base) || $base === []) {
            throw new ValidationException(
                'meta_missing',
                'O modelo não tem a base calculada. Converta com o preset scc.',
                409
            );
        }

        // ── Posicionamento, como no protótipo: centraliza em XZ, apoia no
        // chão, gira em torno de Y e leva ao ponto escolhido (padrão: o
        // centroide do lote).
        $min = \array_map('floatval', (array) $bbox['min']);
        $max = \array_map('floatval', (array) $bbox['max']);
        $cx  = ($min[0] + $max[0]) / 2;
        $cz  = ($min[2] + $max[2]) / 2;

        $altura = ($max[1] - $min[1]) * $escala;

        $destino = $transform['position'] ?? null;
        if (\is_array($destino) && \count($destino) === 2 && \is_numeric($destino[0]) && \is_numeric($destino[1])) {
            $destino = [(float) $destino[0], (float) $destino[1]];
        } else {
            $destino = self::centroide($poligono);
        }

        $cos = \cos($rotacao);
        $sin = \sin($rotacao);

        $pontos = [];
        foreach ($base as $p) {
            if (!\is_array($p) || \count($p) < 2) {
                continue;
            }
            $x = ((float) $p[0] - $cx) * $escala;
            $z = ((float) $p[1] - $cz) * $escala;
            // Mesma rotação do Object3D.rotation.y do Three.js
            $pontos[] = [
                $destino[0] + $x * $cos + $z * $sin,
                $destino[1] - $x * $sin + $z * $cos,
            ];
        }

        // ── Checagens
        $fora = 0;
        foreach ($pontos as $p) {
            if (!self::dentroComRecuo($p, $poligono, $recuo)) {
                $fora++;
            }
        }

        $contorno   = self::convexHull($pontos);
        $areaBase   = self::area($contorno);
        $areaLote   = self::area($poligono);
        $andares    = \max(1, (int) \floor($altura / \max(0.1, $peDireito)));
        $gfa        = $areaBase * $eficiencia * $andares;
        $maxGfa     = \is_finite($far) ? $areaLote * $far : \INF;
        $outorga    = \is_finite($maxGfa) ? (int) \max(0, \round(($gfa - $maxGfa) * $taxa)) : 0;
        $triangulos = (int) ($meta['triangles'] ?? 0);

        $checks = [
            [
                'code'  => 'scale',
                'ok'    => $altura > $minAltura && $altura < $maxAltura,
                'value' => \round($altura, 2),
                'min'   => $minAltura,
                'max'   => $maxAltura,
            ],
            [
                'code'      => 'fits_setback',
                'ok'        => $fora === 0,
                'setback_m' => $recuo,
                'outside'   => $fora,
                'points'    => \count($pontos),
            ],
            [
                'code'  => 'height',
                'ok'    => $altura <= $gabarito,
                'value' => \round($altura, 2),
                'max'   => \is_finite($gabarito) ? $gabarito : null,
            ],
            $gfa <= $maxGfa
                ? ['code' => 'far', 'ok' => true, 'gfa_m2' => (int) \round($gfa), 'max_m2' => \is_finite($maxGfa) ? (int) \round($maxGfa) : null]
                : [
                    // Passar do coeficiente não reprova: exige outorga onerosa (§4.1).
                    'code'          => 'far',
                    'ok'            => false,
                    'severity'      => 'fee',
                    'gfa_m2'        => (int) \round($gfa),
                    'max_m2'        => (int) \round($maxGfa),
                    'outorga_scity' => $outorga,
                ],
            [
                'code'  => 'triangles',
                'ok'    => $triangulos <= $maxTri,
                'value' => $triangulos,
                'max'   => $maxTri,
            ],
        ];

        $valido = true;
        foreach ($checks as $c) {
            if (!$c['ok'] && ($c['severity'] ?? null) !== 'fee') {
                $valido = false;
            }
        }

        return [
            'valid'  => $valido,
            'checks' => $checks,
            'footprint' => [
                'hull'    => \array_map(static fn (array $p): array => [\round($p[0], 3), \round($p[1], 3)], $contorno),
                'area_m2' => (int) \round($areaBase),
            ],
            'suggested_floors' => $andares,
            'placement' => [
                'position'     => [\round($destino[0], 3), \round($destino[1], 3)],
                'rotation_deg' => \round(\rad2deg($rotacao), 3),
                'scale'        => $escala,
            ],
        ];
    }

    /**
     * Contorno convexo (monotone chain de Andrew), anti-horário.
     *
     * @param array<int,array{0:float,1:float}> $pontos
     * @return array<int,array{0:float,1:float}>
     */
    public static function convexHull(array $pontos): array
    {
        \usort($pontos, static fn (array $a, array $b): int => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
        if (\count($pontos) < 3) {
            return $pontos;
        }

        $cruz = static fn (array $o, array $a, array $b): float
            => ($a[0] - $o[0]) * ($b[1] - $o[1]) - ($a[1] - $o[1]) * ($b[0] - $o[0]);

        $baixo = [];
        foreach ($pontos as $p) {
            while (\count($baixo) >= 2 && $cruz($baixo[\count($baixo) - 2], $baixo[\count($baixo) - 1], $p) <= 0) {
                \array_pop($baixo);
            }
            $baixo[] = $p;
        }

        $cima = [];
        for ($i = \count($pontos) - 1; $i >= 0; $i--) {
            $p = $pontos[$i];
            while (\count($cima) >= 2 && $cruz($cima[\count($cima) - 2], $cima[\count($cima) - 1], $p) <= 0) {
                \array_pop($cima);
            }
            $cima[] = $p;
        }

        \array_pop($baixo);
        \array_pop($cima);

        return \array_merge($baixo, $cima);
    }

    /**
     * Área de polígono simples (fórmula do laço).
     *
     * @param array<int,array{0:float,1:float}> $pontos
     */
    public static function area(array $pontos): float
    {
        $s = 0.0;
        $n = \count($pontos);
        for ($i = 0; $i < $n; $i++) {
            $a = $pontos[$i];
            $b = $pontos[($i + 1) % $n];
            $s += $a[0] * $b[1] - $b[0] * $a[1];
        }

        return \abs($s) / 2;
    }

    /**
     * Ponto dentro do polígono (ray casting).
     *
     * @param array{0:float,1:float}            $p
     * @param array<int,array{0:float,1:float}> $poligono
     */
    public static function dentro(array $p, array $poligono): bool
    {
        $dentro = false;
        $n      = \count($poligono);
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            $a = $poligono[$i];
            $b = $poligono[$j];
            if (($a[1] > $p[1]) !== ($b[1] > $p[1])
                && $p[0] < ($b[0] - $a[0]) * ($p[1] - $a[1]) / ($b[1] - $a[1]) + $a[0]) {
                $dentro = !$dentro;
            }
        }

        return $dentro;
    }

    /**
     * Dentro do lote e a pelo menos $recuo metros de todas as divisas.
     *
     * @param array{0:float,1:float}            $p
     * @param array<int,array{0:float,1:float}> $poligono
     */
    public static function dentroComRecuo(array $p, array $poligono, float $recuo): bool
    {
        if (!self::dentro($p, $poligono)) {
            return false;
        }
        if ($recuo <= 0) {
            return true;
        }

        $n = \count($poligono);
        for ($i = 0; $i < $n; $i++) {
            if (self::distanciaSegmento($p, $poligono[$i], $poligono[($i + 1) % $n]) < $recuo) {
                return false;
            }
        }

        return true;
    }

    /**
     * Centroide de área do polígono (cai na média dos vértices se degenerado).
     *
     * @param array<int,array{0:float,1:float}> $poligono
     * @return array{0:float,1:float}
     */
    public static function centroide(array $poligono): array
    {
        $a = 0.0;
        $x = 0.0;
        $z = 0.0;
        $n = \count($poligono);
        for ($i = 0; $i < $n; $i++) {
            $p = $poligono[$i];
            $q = $poligono[($i + 1) % $n];
            $c = $p[0] * $q[1] - $q[0] * $p[1];
            $a += $c;
            $x += ($p[0] + $q[0]) * $c;
            $z += ($p[1] + $q[1]) * $c;
        }

        if (\abs($a) < 1e-9) {
            $sx = 0.0;
            $sz = 0.0;
            foreach ($poligono as $p) {
                $sx += $p[0];
                $sz += $p[1];
            }

            return [$sx / $n, $sz / $n];
        }

        return [$x / (3 * $a), $z / (3 * $a)];
    }

    // ── interno ──────────────────────────────────────────────────────────

    /**
     * @param array{0:float,1:float} $p
     * @param array{0:float,1:float} $a
     * @param array{0:float,1:float} $b
     */
    private static function distanciaSegmento(array $p, array $a, array $b): float
    {
        $dx = $b[0] - $a[0];
        $dz = $b[1] - $a[1];
        $l2 = $dx * $dx + $dz * $dz;
        $t  = $l2 > 0 ? \max(0.0, \min(1.0, (($p[0] - $a[0]) * $dx + ($p[1] - $a[1]) * $dz) / $l2)) : 0.0;

        return \hypot($p[0] - ($a[0] + $t * $dx), $p[1] - ($a[1] + $t * $dz));
    }

    /**
     * @return array<int,array{0:float,1:float}>
     *
     * @throws ValidationException
     */
    private static function poligono(mixed $bruto): array
    {
        if (!\is_array($bruto) || \count($bruto) < 3 || \count($bruto) > 1000) {
            throw new ValidationException('invalid_polygon', 'lot.polygon deve ter de 3 a 1000 vértices [[x,z]…].', 400);
        }

        $pontos = [];
        foreach ($bruto as $p) {
            if (!\is_array($p) || \count($p) !== 2 || !\is_numeric($p[0] ?? null) || !\is_numeric($p[1] ?? null)) {
                throw new ValidationException('invalid_polygon', 'Cada vértice de lot.polygon é [x, z] numérico.', 400);
            }
            $pontos[] = [(float) $p[0], (float) $p[1]];
        }

        // O GeoJSON fecha o anel repetindo o primeiro vértice: descarta.
        if ($pontos[0] === $pontos[\count($pontos) - 1]) {
            \array_pop($pontos);
        }

        if (\count($pontos) < 3 || self::area($pontos) <= 0) {
            throw new ValidationException('invalid_polygon', 'lot.polygon não tem área.', 400);
        }

        return $pontos;
    }

    /**
     * @param array<string,mixed> $dados
     *
     * @throws ValidationException
     */
    private static function numero(array $dados, string $campo, float $padrao, float $min, float $max): float
    {
        if (!\array_key_exists($campo, $dados) || $dados[$campo] === null) {
            return $padrao;
        }
        if (!\is_numeric($dados[$campo])) {
            throw new ValidationException('invalid_' . $campo, "{$campo} deve ser numérico.", 400);
        }

        $v = (float) $dados[$campo];
        if ($v < $min || $v > $max) {
            throw new ValidationException('invalid_' . $campo, "{$campo} fora do intervalo [{$min}, {$max}].", 400);
        }

        return $v;
    }
}
