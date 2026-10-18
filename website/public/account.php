<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

partial('head', [
    'title'       => 'Minha conta',
    'description' => 'Conecte sua carteira para ver seus saldos e entrar no jogo.',
    'bodyClass'   => 'page-account',
    'scripts'     => ['account.js'],
]);
partial('header');
?>
<section class="section account sky sky--short">
  <div class="container">
    <div class="account-grid">
      <!-- Card do jogador, no estilo do HUD superior -->
      <div class="hud-card" data-account-card>
        <div class="hud-avatar">
          <?= icon('user', 'icon placeholder-avatar') ?>
          <span class="hud-level" data-account-level>—</span>
          <span class="hud-name" data-account-name>Visitante</span>
        </div>
        <div class="hud-bars">
          <?php foreach ([['health', 'Saúde', 'is-green'], ['happiness', 'Felicidade', 'is-red'], ['food', 'Alimentação', 'is-orange'], ['energy', 'Energia', 'is-yellow']] as [$k, $l, $c]): ?>
            <div class="hud-bar">
              <span class="hud-bar__label"><?= e($l) ?></span>
              <span class="hud-bar__track"><span class="hud-bar__fill <?= $c ?>" data-attr="<?= $k ?>" style="width:0%"></span></span>
            </div>
          <?php endforeach; ?>
        </div>
      </div>

      <div class="stone-panel wallet-panel">
        <h1>Minha conta</h1>
        <div data-wallet-disconnected>
          <p>Conecte sua carteira MetaMask (ou compatível) na rede <strong><?= e(cfg('chain.chain_name')) ?></strong> para ver seus saldos.</p>
          <button class="btn btn--green btn--big" type="button" data-wallet-connect><?= icon('wallet') ?> Conectar carteira</button>
          <p class="hint">Não tem carteira? Veja o <a href="<?= e(url('tutorial.php')) ?>">tutorial</a>.</p>
        </div>

        <div data-wallet-connected hidden>
          <dl class="wallet-facts">
            <div><dt>Carteira</dt><dd><code data-wallet-address>—</code></dd></div>
            <div><dt>Rede</dt><dd data-wallet-network>—</dd></div>
            <div><dt><?= e(cfg('chain.token_symbol')) ?></dt><dd data-wallet-token>—</dd></div>
            <div><dt>BNB</dt><dd data-wallet-bnb>—</dd></div>
          </dl>
          <div class="wallet-actions">
            <a class="btn btn--green" href="<?= e(cfg('links.play')) ?>"><?= icon('play') ?> Jogar agora</a>
            <button class="btn btn--blue" type="button" data-wallet-add-token><?= icon('wallet') ?> Adicionar SCITY à carteira</button>
            <button class="btn btn--ghost" type="button" data-wallet-sign>Verificar posse (assinar)</button>
            <button class="btn btn--ghost" type="button" data-wallet-disconnect>Desconectar</button>
          </div>
          <p class="form-status" data-wallet-status aria-live="polite"></p>
        </div>
      </div>
    </div>

    <div class="stone-panel deposit-panel" id="deposito">
      <h2>Depósito no jogo</h2>
      <p>Depósitos de SCITY → THALER acontecem pelo contrato <em>GameVault</em> e são creditados após as confirmações da rede.
        A função será liberada no lançamento da mainnet.</p>
      <button class="btn btn--blue" type="button" disabled><?= icon('download') ?> Depositar (em breve)</button>
    </div>
  </div>
</section>
<?php partial('footer'); ?>
