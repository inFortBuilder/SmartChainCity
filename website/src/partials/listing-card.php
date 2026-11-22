<?php
/** Card de anúncio no estilo do inventário do jogo (INVENTÁRIO 03). @var array $it */
$rarityLabel = ['common' => 'Comum', 'rare' => 'Raro', 'epic' => 'Épico', 'legendary' => 'Lendário'][$it['rarity']] ?? '';
?>
<article class="listing listing--<?= e($it['rarity']) ?>"
         data-id="<?= e($it['id']) ?>" data-name="<?= e($it['name']) ?>"
         data-price="<?= (float) $it['price'] ?>" data-rarity="<?= e($it['rarity']) ?>"<?php if (!empty($it['chain'])): ?> data-listing-id="<?= e($it['listing_id']) ?>" data-price-wei="<?= e($it['price_wei']) ?>"<?php endif; ?>>
  <div class="listing-thumb">
    <span class="listing-badge"><?= e($it['badge']) ?></span>
    <img class="plastic" src="<?= e(asset('img/hud/' . ['property' => 'casa', 'land' => 'arvore', 'avatar' => 'profissao', 'item' => 'roupas'][$it['category']] . '.png')) ?>" alt="" width="96" height="96" loading="lazy">
  </div>
  <div class="listing-info">
    <h3><?= e($it['name']) ?> <small><?= e($rarityLabel) ?></small></h3>
    <?php if (!empty($it['chain'])): ?>
    <dl class="listing-stats">
      <div><dt>Vendedor</dt><dd><code><?= e(substr($it['seller'], 0, 6) . '…' . substr($it['seller'], -4)) ?></code></dd></div>
      <div><dt>Expira</dt><dd><?= e($it['expires_at'] ? date('d/m/Y', (int) strtotime($it['expires_at'])) : '—') ?></dd></div>
      <div><dt>Anúncio</dt><dd>#<?= e($it['listing_id']) ?></dd></div>
    </dl>
    <?php else: ?>
    <dl class="listing-stats">
      <div class="lvl"><dt>Nível</dt><dd><?= (int) $it['level'] ?></dd></div>
      <div><dt>Rendimento</dt><dd><?= e($it['income']) ?></dd></div>
      <div><dt>Desgaste</dt><dd><?= (int) $it['wear'] ?></dd></div>
      <div><dt>Local</dt><dd><?= e($it['location']) ?></dd></div>
      <?php if ($it['roi'] > 0): ?><div class="roi"><dt>ROI</dt><dd><?= (int) $it['roi'] ?>%</dd></div><?php endif; ?>
    </dl>
    <?php endif; ?>
    <div class="listing-buy">
      <span class="price"><img src="<?= e(asset('img/brand/coin-96.webp')) ?>" alt="" width="22" height="22"> <?= num($it['price'], $it['price'] < 100 ? 2 : 0) ?></span>
      <button class="btn btn--green btn--sm" type="button" data-buy>Comprar</button>
    </div>
  </div>
</article>
