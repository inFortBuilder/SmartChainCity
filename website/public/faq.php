<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

$groups = require __DIR__ . '/../src/data/faq.php';

partial('head', [
    'title'       => 'Perguntas frequentes',
    'description' => 'Como funciona o Smart Chain City: jogo, lotes, carteira, segurança, token e riscos.',
    'bodyClass'   => 'page-faq',
]);
partial('header');
?>
<section class="section field">
  <div class="container">
    <h1 class="section-title section-title--light">Perguntas frequentes</h1>
    <p class="section-sub section-sub--light">Não achou? Pergunte no <a href="<?= e(cfg('links.discord')) ?>" target="_blank" rel="noopener">Discord</a> ou leia o <a href="<?= e(cfg('links.whitepaper')) ?>" target="_blank" rel="noopener">whitepaper</a>.</p>

    <?php foreach ($groups as $title => $items): ?>
      <div class="stone-panel faq-group">
        <h2><?= e($title) ?></h2>
        <?php foreach ($items as [$q, $a]): ?>
          <details class="faq-item">
            <summary><?= e($q) ?></summary>
            <p><?= e($a) ?></p>
          </details>
        <?php endforeach; ?>
      </div>
    <?php endforeach; ?>

    <p class="center"><a class="btn btn--wood" href="<?= e(url('contratos.php')) ?>">Ver os contratos oficiais</a></p>
  </div>
</section>
<?php partial('footer'); ?>
