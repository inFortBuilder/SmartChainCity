<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

$sale    = cfg('sale');
$percent = $sale['hard_cap_usd'] > 0 ? min(100, $sale['raised_usd'] / $sale['hard_cap_usd'] * 100) : 0;

partial('head', [
    'title'       => 'Venda privada SCITY',
    'description' => 'Informações da venda privada do token SCITY: preço, limites e hard cap.',
    'bodyClass'   => 'page-sale',
    'scripts'     => ['sale.js'],
]);
partial('header');
?>
<section class="section sale sky sky--short">
  <div class="container narrow">
    <div class="stone-panel sale-panel">
      <img class="sale-coin plastic" src="<?= e(asset('img/brand/coin-240.webp')) ?>" alt="" width="120" height="120">
      <h1>Venda privada <?= e(cfg('chain.token_symbol')) ?></h1>
      <p class="sale-state <?= $sale['open'] ? 'is-open' : 'is-closed' ?>"><?= $sale['open'] ? 'Venda aberta' : 'Venda ainda não aberta' ?></p>

      <dl class="sale-facts">
        <div><dt>Preço do token</dt><dd>US$ <?= num($sale['price_usd'], 4) ?></dd></div>
        <div><dt>Compra mínima</dt><dd>US$ <?= num($sale['min_usd']) ?></dd></div>
        <div><dt>Compra máxima</dt><dd>US$ <?= num($sale['max_usd']) ?></dd></div>
        <div><dt>Pagamento</dt><dd><?= e($sale['pay_token']) ?> (BNB Smart Chain)</dd></div>
      </dl>

      <div class="hardcap">
        <div class="hardcap-label"><span>Arrecadado</span><span>Hard cap US$ <?= num($sale['hard_cap_usd']) ?></span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= round($percent) ?>">
          <span class="progress-badge"><?= round($percent) ?>%</span>
          <span class="progress-fill" style="width: <?= max(4, $percent) ?>%"></span>
          <span class="progress-text">US$ <?= num($sale['raised_usd']) ?></span>
        </div>
      </div>

      <form class="sale-form" data-sale-form>
        <label>Valor em US$
          <input type="number" name="usd" min="<?= e($sale['min_usd']) ?>" max="<?= e($sale['max_usd']) ?>" step="1" value="<?= e($sale['min_usd']) ?>" required>
        </label>
        <p class="sale-calc">Você recebe aprox. <strong data-sale-tokens>—</strong> <?= e(cfg('chain.token_symbol')) ?></p>
        <button class="btn btn--green btn--big" type="submit" <?= $sale['open'] ? '' : 'disabled' ?>><?= icon('wallet') ?> Conectar carteira e comprar</button>
        <p class="form-status" data-sale-status aria-live="polite"></p>
      </form>

      <p class="disclaimer">Antes de participar, leia o whitepaper e os termos. Criptoativos têm alto risco e podem perder todo o valor.
        Nenhuma informação aqui é promessa de rentabilidade. A venda pode não estar disponível em algumas jurisdições.</p>
    </div>
  </div>
</section>
<?php partial('footer'); ?>
