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
$market = GameData::market($active);
$items  = $market['items'];
$auctions = $market['source'] === 'chain' ? GameData::auctions() : [];

partial('head', [
    'title'       => 'Marketplace',
    'description' => 'Compra e venda de imóveis, lotes, avatares e itens NFT da Smart Chain City.',
    'bodyClass'   => 'page-market',
    'scripts'     => ['marketplace.js', 'market-sell.js'],
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
        <p class="empty-state" data-empty<?= $items ? ' hidden' : '' ?>>Nenhum anúncio encontrado.</p>
        <?php if ($market['source'] === 'chain'): ?>
          <p class="panel-note">Anúncios do contrato Marketplace na blockchain. A compra é feita pela sua carteira: aprova o SCITY e compra numa transação cada.</p>
        <?php else: ?>
          <p class="panel-note">Anúncios de demonstração. A compra exige carteira conectada e acontece no contrato do Marketplace (ver docs/07).</p>
        <?php endif; ?>
      </div>
    </div>
  </div>
</section>

<?php if ($market['source'] === 'chain'): ?>
<section class="section field market-extra">
  <div class="container">
    <div class="stone-panel market-panel" id="leiloes">
      <h2>Leilões</h2>
      <?php if (!$auctions): ?>
        <p>Nenhum leilão aberto agora.</p>
      <?php else: ?>
        <ul class="auction-list">
          <?php foreach ($auctions as $a): ?>
            <li class="auction" data-auction-id="<?= e($a['auction_id']) ?>" data-minimum-wei="<?= e($a['minimum_wei']) ?>">
              <div>
                <strong><?= e($a['name']) ?></strong>
                <small>Leilão #<?= e($a['auction_id']) ?> · <?= (int) $a['bids'] ?> lance<?= $a['bids'] === 1 ? '' : 's' ?> ·
                  <?= $a['ended'] ? 'terminou' : 'até ' . e(date('d/m H:i', (int) strtotime($a['ends_at']))) ?></small>
              </div>
              <div class="auction-price">
                <?php if ($a['highest'] !== null): ?><span>Maior lance <b><?= num($a['highest'], 2) ?></b></span><?php endif; ?>
                <span>Mínimo <b><?= num($a['minimum'], 2) ?></b> SCITY</span>
              </div>
              <?php if ($a['ended']): ?>
                <button class="btn btn--wood btn--sm" type="button" data-settle>Encerrar</button>
              <?php else: ?>
                <form class="bid-form" data-bid-form>
                  <input name="valor" inputmode="decimal" required value="<?= e(rtrim(rtrim(number_format($a['minimum'], 2, '.', ''), '0'), '.')) ?>" aria-label="Seu lance em SCITY">
                  <button class="btn btn--green btn--sm" type="submit">Dar lance</button>
                </form>
              <?php endif; ?>
            </li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
      <p class="form-status" data-auction-status aria-live="polite"></p>
      <p class="panel-note">Lances 5% acima do maior. O lance anterior volta na hora, e um lance nos últimos 10 minutos estende o leilão. Encerrar é aberto a qualquer um.</p>
    </div>

    <div class="stone-panel market-panel" id="vender" data-sell>
      <h2>Vender</h2>
      <p data-sell-hint>Conecte a carteira para ver seus lotes, imóveis e avatares.</p>
      <button class="btn btn--green" type="button" data-sell-connect><?= icon('wallet') ?> Conectar carteira</button>
      <form class="sell-form" data-sell-form hidden>
        <fieldset class="sell-items" data-sell-items><legend>Escolha até 5 (combo vende tudo junto)</legend></fieldset>
        <div class="sell-row">
          <label><input type="radio" name="modo" value="fixo" checked> Preço fixo</label>
          <label><input type="radio" name="modo" value="leilao"> Leilão</label>
        </div>
        <div class="sell-row">
          <label>Preço (SCITY) <input name="preco" inputmode="decimal" required placeholder="Ex.: 150"></label>
          <label data-mode="fixo">Vale por (dias) <input name="dias" type="number" min="1" max="60" value="7" required></label>
          <label data-mode="leilao" hidden>Duração (horas) <input name="horas" type="number" min="1" max="336" value="24" required disabled></label>
        </div>
        <button class="btn btn--blue" type="submit">Anunciar</button>
        <p class="hint">A carteira pede a permissão do mercado para a coleção (uma vez por coleção) e depois o anúncio. No preço fixo, o NFT fica com você até a venda; no leilão, fica guardado no contrato.</p>
      </form>
      <p class="form-status" data-sell-status aria-live="polite"></p>
    </div>
  </div>
</section>
<?php endif; ?>

<dialog class="modal" data-buy-modal>
  <form method="dialog" class="modal-body stone-panel">
    <h2 data-buy-title>Comprar</h2>
    <p data-buy-desc></p>
    <p class="modal-price"><img src="<?= e(asset('img/brand/coin-96.webp')) ?>" alt="" width="32" height="32" class="plastic"> <strong data-buy-price></strong> SCITY</p>
    <p class="form-status" data-buy-status></p>
    <div class="modal-actions">
      <button class="btn btn--ghost" value="cancel">Cancelar</button>
      <button class="btn btn--green" type="button" data-buy-confirm>Confirmar compra</button>
    </div>
  </form>
</dialog>
<?php partial('footer'); ?>
