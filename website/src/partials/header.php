<?php
$page = current_page();
$menu = [
    ['label' => 'Home',        'href' => url('index.php'),        'key' => 'index'],
    ['label' => 'Whitepaper',  'href' => cfg('links.whitepaper'), 'key' => 'whitepaper', 'external' => true],
    ['label' => 'Roadmap',     'href' => url('index.php#roadmap'), 'key' => 'roadmap'],
    ['label' => 'Equipe',      'href' => url('index.php#equipe'), 'key' => 'team'],
    ['label' => 'Parceiros',   'href' => url('index.php#parceiros'), 'key' => 'partners'],
    ['label' => 'Marketplace', 'href' => url('marketplace.php'),  'key' => 'marketplace'],
    ['label' => 'Tutorial',    'href' => url('tutorial.php'),     'key' => 'tutorial'],
];
?>
<header class="site-header">
  <nav class="stone-bar" aria-label="Principal">
    <a class="brand" href="<?= e(url('index.php')) ?>">
      <img src="<?= e(asset('img/brand/logo-white.png')) ?>" alt="<?= e(cfg('app.name')) ?>" width="120" height="70">
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="menu-principal" aria-label="Abrir menu">
      <?= icon('menu') ?>
    </button>
    <ul class="nav-links" id="menu-principal">
      <?php foreach ($menu as $item): ?>
        <li>
          <a href="<?= e($item['href']) ?>"<?= $page === $item['key'] ? ' aria-current="page"' : '' ?><?= !empty($item['external']) ? ' target="_blank" rel="noopener"' : '' ?>><?= e($item['label']) ?></a>
        </li>
      <?php endforeach; ?>
    </ul>
    <a class="coin-pill" href="<?= e(url('account.php')) ?>" title="Sua carteira">
      <img src="<?= e(asset('img/brand/coin-3d.png')) ?>" alt="" width="44" height="44">
      <span data-wallet-balance>Conectar</span>
    </a>
  </nav>
</header>
<main id="conteudo">
