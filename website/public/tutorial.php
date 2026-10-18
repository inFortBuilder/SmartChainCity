<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

$steps = require __DIR__ . '/../src/data/tutorial.php';

partial('head', [
    'title'       => 'Tutorial — como comprar SCITY',
    'description' => 'Passo a passo para criar sua carteira, adicionar a BNB Smart Chain e comprar SCITY.',
    'bodyClass'   => 'page-tutorial',
]);
partial('header');
?>
<section class="hero sky hero--tutorial">
  <div class="clouds" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="container center">
    <img class="hero-logo hero-logo--big" src="<?= e(asset('img/brand/logo-color.svg')) ?>" alt="<?= e(cfg('app.name')) ?>" width="460" height="242">
    <h1 class="headline">Na cidade que nunca dorme, todos são bem-vindos.</h1>
    <p class="headline-sub">E ainda podem sair ganhando.</p>

    <div class="wood-frame wood-frame--vines">
      <?php if (cfg('links.trailer')): ?>
        <button class="video-cover" type="button" data-video="<?= e(cfg('links.trailer')) ?>" aria-label="Assistir ao vídeo tutorial">
          <img src="<?= e(asset('img/legacy/video-frame.webp')) ?>" alt="" loading="lazy">
        </button>
      <?php else: ?>
        <div class="video-cover is-placeholder">
          <img src="<?= e(asset('img/legacy/video-frame.webp')) ?>" alt="Cena da cidade" loading="lazy">

          <span class="soon">Vídeo tutorial em breve</span>
        </div>
      <?php endif; ?>
    </div>

    <a class="btn btn--wood btn--big" href="<?= e(cfg('links.trade')) ?>" target="_blank" rel="noopener">Comprar token agora <b>Trade Now</b></a>
  </div>
</section>

<section class="section field">
  <div class="container">
    <h2 class="section-title section-title--light">Veja como comprar</h2>
    <ol class="signpost-grid">
      <?php foreach ($steps as $i => $s): ?>
        <li class="signpost" data-reveal>
          <div class="signpost-board">
            <span class="signpost-num"><?= $i + 1 ?></span>
            <h3><?= e($s['title']) ?></h3>
            <p><?= e($s['text']) ?></p>
          </div>
          <span class="signpost-pole" aria-hidden="true"></span>
        </li>
      <?php endforeach; ?>
    </ol>

    <div class="pix-cta">
      <h2>Compre também com PIX</h2>
      <a class="btn btn--wood" href="<?= e(url('index.php#contato-form')) ?>"><img src="<?= e(asset('img/legacy/pix.svg')) ?>" alt="PIX" width="110" height="44"></a>
    </div>
  </div>
</section>
<?php partial('footer'); ?>
