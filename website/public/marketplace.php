<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

$categories = [
    'all'      => ['label' => 'Tudo',     'icon' => 'home'],
    'property' => ['label' => 'Imóveis',  'icon' => 'home'],
    'land'     => ['label' => 'Lotes',    'icon' => 'pin'],
    'avatar'   => ['label' => 'Avatares', 'icon' => 'user'],
    'item'     => ['label' => 'Itens',    'icon' => 'cart'],
];
$active = isset($_GET['c']) && isset($categories[$_GET['c']]) ? $_GET['c'] : 'all';
$items  = GameData::listings($active);

partial('head', [
    'title'       => 'Marketplace',
    'description' => 'Compra e venda de imóveis, lotes, avatares e itens NFT da Smart Chain City.',
    'bodyClass'   => 'page-market',
    'scripts'     => ['marketplace.js'],
]);
partial('header');
?>
<section class="section market sky sky--short">
  <div class="container">
    <div class="game-window">
      <div class="window-tabs" role="tablist" aria-label="Categorias">
        <?php foreach ($categories as $key => $c): ?>
          <a class="window-tab<?= $key === $active ? ' is-active' : '' ?>" role="tab"
             aria-selected="<?= $key === $active ? 'true' : 'false' ?>"
             href="?c=<?= e($key) ?>" data-category="<?= e($key) ?>"><?= e($c['label']) ?></a>
        <?php endforeach; ?>
      </div>
      <div class="window-body">
        <div class="window-title"><span class="window-title__icon"><?= icon('cart') ?></span>
          <h1>Marketplace da cidade</h1>
        </div>

        <div class="market-tools">
          <label>Ordenar
            <select data-sort>
              <option value="price-asc">Menor preço</option>
              <option value="price-desc">Maior preço</option>
              <option value="rarity">Raridade</option>
            </select>
          </label>
          <label>Buscar <input type="search" placeholder="Ex.: T1, Médico, A1" data-search></label>
        </div>

        <div class="listing-grid" data-listings data-category="<?= e($active) ?>">
          <?php foreach ($items as $it): ?>
            <?php partial('listing-card', ['it' => $it]); ?>
          <?php endforeach; ?>
        </div>
        <p class="empty-state" data-empty hidden>Nenhum anúncio encontrado.</p>
        <p class="panel-note">Anúncios de demonstração. A compra exige carteira conectada e acontece no contrato do Marketplace (ver docs/07).</p>
      </div>
    </div>
  </div>
</section>

<dialog class="modal" data-buy-modal>
  <form method="dialog" class="modal-body stone-panel">
    <h2 data-buy-title>Comprar</h2>
    <p data-buy-desc></p>
    <p class="modal-price"><img src="<?= e(asset('img/brand/coin-3d.png')) ?>" alt="" width="32" height="32"> <strong data-buy-price></strong> SCITY</p>
    <p class="form-status" data-buy-status></p>
    <div class="modal-actions">
      <button class="btn btn--ghost" value="cancel">Cancelar</button>
      <button class="btn btn--green" type="button" data-buy-confirm>Confirmar compra</button>
    </div>
  </form>
</dialog>
<?php partial('footer'); ?>
