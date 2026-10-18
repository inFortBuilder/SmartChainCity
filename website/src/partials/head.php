<?php
/** @var string $title  @var string $description  @var string $bodyClass */
$pageTitle = isset($title) && $title !== '' ? $title . ' — ' . cfg('app.name') : cfg('app.name') . ' — ' . cfg('app.tagline');
$desc = $description ?? 'Smart Chain City: cidade virtual 3D no navegador, com lotes e imóveis NFT, profissões e economia Play-to-Earn na BNB Smart Chain.';
?><!doctype html>
<html lang="<?= e(cfg('app.lang')) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= e($pageTitle) ?></title>
  <meta name="description" content="<?= e($desc) ?>">
  <meta name="theme-color" content="#0b4f7a">
  <meta property="og:title" content="<?= e($pageTitle) ?>">
  <meta property="og:description" content="<?= e($desc) ?>">
  <meta property="og:image" content="<?= e(asset('img/brand/logo-3d-1000.png')) ?>">
  <link rel="icon" href="<?= e(asset('img/brand/coin-96.webp')) ?>" type="image/webp">
  <link rel="apple-touch-icon" href="<?= e(asset('img/brand/coin-512.png')) ?>">
  <link rel="preload" href="<?= e(url('assets/fonts/LondrinaSolid-Black.ttf')) ?>" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="<?= e(asset('css/style.css')) ?>">
  <script>window.SCC = <?= json_encode(public_js_config(), JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
  <script src="<?= e(asset('js/main.js')) ?>" defer></script>
  <script src="<?= e(asset('js/wallet.js')) ?>" defer></script>
<?php foreach ($scripts ?? [] as $s): ?>
  <script src="<?= e(asset('js/' . $s)) ?>" defer></script>
<?php endforeach; ?>
</head>
<body class="<?= e($bodyClass ?? '') ?>">
<a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
<!-- Filtros de "plástico brilhante": iluminação especular sobre a forma da imagem (usados via CSS filter: url(#…)). -->
<svg class="svg-defs" width="0" height="0" aria-hidden="true" focusable="false">
  <!-- Imagens e ícones: a luminância vira relevo, então cada área de cor ganha um brilho próprio, como plástico injetado -->
  <filter id="scc-plastic" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lum"/>
    <feComposite in="lum" in2="SourceAlpha" operator="in" result="height"/>
    <feGaussianBlur in="height" stdDeviation="2.2" result="relief"/>
    <feSpecularLighting in="relief" surfaceScale="5" specularConstant="1.05" specularExponent="26" lighting-color="#ffffff" result="spec">
      <feDistantLight azimuth="235" elevation="52"/>
    </feSpecularLighting>
    <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss"/>
    <feComposite in="SourceGraphic" in2="gloss" operator="arithmetic" k1="0" k2="1" k3=".8" k4="0"/>
  </filter>
  <!-- Ilustrações grandes (skyline, grama, moldura): relevo mais suave e brilho menor -->
  <filter id="scc-plastic-soft" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lum"/>
    <feComposite in="lum" in2="SourceAlpha" operator="in" result="height"/>
    <feGaussianBlur in="height" stdDeviation="3.5" result="relief"/>
    <feSpecularLighting in="relief" surfaceScale="4" specularConstant=".75" specularExponent="34" lighting-color="#ffffff" result="spec">
      <feDistantLight azimuth="240" elevation="58"/>
    </feSpecularLighting>
    <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss"/>
    <feComposite in="SourceGraphic" in2="gloss" operator="arithmetic" k1="0" k2="1" k3=".55" k4="0"/>
  </filter>
</svg>
