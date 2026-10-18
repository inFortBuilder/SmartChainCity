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
  <meta property="og:image" content="<?= e(asset('img/brand/coin-3d.png')) ?>">
  <link rel="icon" href="<?= e(asset('img/brand/coin-3d.png')) ?>">
  <link rel="preload" href="<?= e(asset('fonts/LondrinaSolid-Black.ttf')) ?>" as="font" type="font/ttf" crossorigin>
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
