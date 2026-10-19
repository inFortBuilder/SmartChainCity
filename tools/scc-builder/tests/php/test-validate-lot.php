<?php

declare(strict_types=1);

use SccBuilder\Api\LotValidator;

/**
 * Meta de um prédio-caixa: base de $lado × $lado metros centrada na origem,
 * altura $altura — como o bin/lib/footprint.js grava no modelo.meta.json.
 */
function metaCaixa(float $lado = 20.0, float $altura = 80.8, int $triangulos = 84320): array
{
    $m = $lado / 2;
    $pontos = [];
    for ($i = 0; $i <= 10; $i++) {
        $t = -$m + $lado * $i / 10;
        \array_push($pontos, [$t, -$m], [$t, $m], [-$m, $t], [$m, $t]);
    }

    return [
        'bbox'      => ['min' => [-$m, 0, -$m], 'max' => [$m, $altura, $m]],
        'triangles' => $triangulos,
        'footprint' => ['points' => $pontos],
    ];
}

/** Lote quadrado de 50 × 50 m com canto na origem (2.500 m²). */
function loteQuadrado(array $extra = []): array
{
    return $extra + [
        'polygon'      => [[0, 0], [50, 0], [50, 50], [0, 50]],
        'setback_m'    => 3,
        'max_height_m' => 160,
        'far'          => 6.0,
    ];
}

function check(array $r, string $codigo): array
{
    foreach ($r['checks'] as $c) {
        if ($c['code'] === $codigo) {
            return $c;
        }
    }
    throw new FalhaDeTeste("check {$codigo} ausente");
}

caso('validate-lot: prédio que cabe passa em tudo, no formato do doc 13 §5.3', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado());

    igual(true, $r['valid']);
    igual(['scale', 'fits_setback', 'height', 'far', 'triangles'], \array_column($r['checks'], 'code'));
    foreach ($r['checks'] as $c) {
        igual(true, $c['ok'], $c['code'] . ':');
    }
    igual(80.8, check($r, 'height')['value']);
    igual(84320, check($r, 'triangles')['value']);
    igual(300000, check($r, 'triangles')['max']);
    igual(400, $r['footprint']['area_m2']);
    igual(4, \count($r['footprint']['hull']));
    igual(25, $r['suggested_floors']);           // floor(80,8 / 3,2)
    igual([25.0, 25.0], $r['placement']['position']); // centroide do lote
});

caso('validate-lot: o contorno é convexo e sai no lugar do lote', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado());
    $xs = \array_column($r['footprint']['hull'], 0);
    perto(15.0, \min($xs));
    perto(35.0, \max($xs));
});

caso('validate-lot: largo demais para o recuo não cabe', function (): void {
    // 46 m de base: sobra 2 m de cada lado, menos que os 3 m de recuo.
    $r = LotValidator::validate(metaCaixa(46), loteQuadrado());
    $c = check($r, 'fits_setback');

    igual(false, $c['ok']);
    verdade($c['outside'] > 0 && $c['outside'] <= $c['points']);
    igual(false, $r['valid']);

    // Sem recuo, os mesmos 46 m cabem.
    igual(true, check(LotValidator::validate(metaCaixa(46), loteQuadrado(['setback_m' => 0])), 'fits_setback')['ok']);
});

caso('validate-lot: rotação conta — 40 m cabe reto e não cabe a 45°', function (): void {
    // Reto: 40 m em 44 m edificáveis. A 45°, a diagonal (56,6 m) passa dos 44 m.
    igual(true, check(LotValidator::validate(metaCaixa(40), loteQuadrado()), 'fits_setback')['ok']);
    $girado = LotValidator::validate(metaCaixa(40), loteQuadrado(), ['rotation_deg' => 45]);
    igual(false, check($girado, 'fits_setback')['ok']);
    igual(45.0, $girado['placement']['rotation_deg']);
});

caso('validate-lot: position desloca o prédio para fora do lote', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado(), ['position' => [5, 25]]);
    igual(false, check($r, 'fits_setback')['ok']);
});

caso('validate-lot: recuo exato em lote em L (onde encolher pelo centroide erra)', function (): void {
    $l = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];
    verdade(LotValidator::dentroComRecuo([5, 25], $l, 3), '(5,25) está a 5 m das divisas');
    verdade(!LotValidator::dentroComRecuo([8, 25], $l, 3), '(8,25) está a 2 m da divisa x=10');
    verdade(!LotValidator::dentroComRecuo([25, 25], $l, 3), '(25,25) está fora do L');
    verdade(LotValidator::dentroComRecuo([25, 5], $l, 3), '(25,5) está no braço horizontal');
});

caso('validate-lot: acima do gabarito reprova', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado(['max_height_m' => 60]));
    $c = check($r, 'height');
    igual(false, $c['ok']);
    igual(60.0, $c['max']);
    igual(false, $r['valid']);
});

caso('validate-lot: passar do coeficiente cobra outorga, mas não reprova', function (): void {
    // 400 m² × 0,85 × 25 andares = 8.500 m²; lote 2.500 m² × 3 = 7.500 m².
    $r = LotValidator::validate(metaCaixa(), loteQuadrado(['far' => 3]));
    $c = check($r, 'far');

    igual(false, $c['ok']);
    igual('fee', $c['severity']);
    igual(8500, $c['gfa_m2']);
    igual(7500, $c['max_m2']);
    igual(2500, $c['outorga_scity']); // 1.000 m² × 2,5 SCITY
    igual(true, $r['valid']);
});

caso('validate-lot: taxa de outorga e pé-direito vêm das regras da cidade', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado(['far' => 3]), [], ['outorga_scity_m2' => 4, 'floor_height_m' => 4.0]);
    igual(20, $r['suggested_floors']);
    // 400 × 0,85 × 20 = 6.800 m², dentro dos 7.500 m²
    igual(true, check($r, 'far')['ok']);
});

caso('validate-lot: acima de 300 mil triângulos reprova', function (): void {
    $r = LotValidator::validate(metaCaixa(20, 80.8, 300001), loteQuadrado());
    igual(false, check($r, 'triangles')['ok']);
    igual(false, $r['valid']);
});

caso('validate-lot: escala implausível (modelo em mm lido como m)', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado(), ['units' => 'mm']);
    igual(false, check($r, 'scale')['ok']);
    igual(false, $r['valid']);

    // O mesmo prédio desenhado em centímetros e declarado como cm cabe.
    $cm = LotValidator::validate(metaCaixa(2000, 8080), loteQuadrado(), ['units' => 'cm']);
    igual(true, $cm['valid']);
    igual(80.8, check($cm, 'height')['value']);
});

caso('validate-lot: anel fechado (GeoJSON) é aceito', function (): void {
    $r = LotValidator::validate(metaCaixa(), loteQuadrado(['polygon' => [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]]));
    igual(true, $r['valid']);
});

caso('validate-lot: entrada malformada vira 400/409, não 500', function (): void {
    lanca('invalid_polygon', fn () => LotValidator::validate(metaCaixa(), ['polygon' => [[0, 0], [1, 1]]]));
    lanca('invalid_polygon', fn () => LotValidator::validate(metaCaixa(), ['polygon' => [[0, 0], [1, 'x'], [2, 2]]]));
    lanca('invalid_polygon', fn () => LotValidator::validate(metaCaixa(), ['polygon' => [[0, 0], [1, 1], [2, 2]]]));
    lanca('invalid_setback_m', fn () => LotValidator::validate(metaCaixa(), loteQuadrado(['setback_m' => -1])));
    lanca('invalid_units', fn () => LotValidator::validate(metaCaixa(), loteQuadrado(), ['units' => 'pol']));
    lanca('meta_missing', fn () => LotValidator::validate(['bbox' => null], loteQuadrado()));
});

caso('geometria: contorno convexo descarta pontos internos e colineares', function (): void {
    $h = LotValidator::convexHull([[0, 0], [2, 0], [1, 0], [2, 2], [0, 2], [1, 1], [1, 2]]);
    igual(4, \count($h));
    perto(4.0, LotValidator::area($h));
    igual([1.0, 1.0], \array_map('floatval', LotValidator::centroide([[0, 0], [2, 0], [2, 2], [0, 2]])));
});
