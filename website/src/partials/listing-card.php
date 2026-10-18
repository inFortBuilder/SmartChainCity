<?php
/** Card de anúncio no estilo do inventário do jogo (INVENTÁRIO 03). @var array $it */
$rarityLabel = ['common' => 'Comum', 'rare' => 'Raro', 'epic' => 'Épico', 'legendary' => 'Lendário'][$it['rarity']] ?? '';
?>
<article class="listing listing--<?= e($it['rarity']) ?>"
         data-id="<?= e($it['id']) ?>" data-name="<?= e($it['name']) ?>"
         data-price="<?= (float) $it['price'] ?>" data-rarity="<?= e($it['rarity']) ?>">
  <div class="listing-thumb">
    <span class="listing-badge"><?= e($it['badge']) ?></span>
    <img src="<?= e(asset('img/hud/' . ['property' => 'casa', 'land' => 'arvore', 'avatar' => 'profissao', 'item' => 'roupas'][$it['category']] . '.png')) ?>" alt="" width="96" height="96" loading="lazy">
  </div>
  <div class="listing-info">
    <h3><?= e($it['name']) ?> <small><?= e($rarityLabel) ?></small></h3>
    <dl class="listing-stats">
      <div class="lvl"><dt>Nível</dt><dd><?= (int) $it['level'] ?></dd></div>
      <div><dt>Rendimento</dt><dd><?= e($it['income']) ?></dd></div>
      <div><dt>Desgaste</dt><dd><?= (int) $it['wear'] ?></dd></div>
      <div><dt>Local</dt><dd><?= e($it['location']) ?></dd></div>
      <?php if ($it['roi'] > 0): ?><div class="roi"><dt>ROI</dt><dd><?= (int) $it['roi'] ?>%</dd></div><?php endif; ?>
    </dl>
    <div class="listing-buy">
      <span class="price"><img src="<?= e(asset('img/brand/coin-3d.png')) ?>" alt="" width="22" height="22"> <?= num($it['price']) ?></span>
      <button class="btn btn--green btn--sm" type="button" data-buy>Comprar</button>
    </div>
  </div>
</article>
