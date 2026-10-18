</main>
<footer class="site-footer" id="contato">
  <div class="footer-grass" aria-hidden="true"></div>
  <div class="footer-inner">
    <div class="footer-brand">
      <?= logo_img('plastic', '180px', 180, true) ?>
      <ul class="footer-links">
        <li><a href="<?= e(url('index.php')) ?>">Home</a></li>
        <li><a href="<?= e(cfg('links.whitepaper')) ?>" target="_blank" rel="noopener">Whitepaper</a></li>
        <li><a href="<?= e(url('index.php#contato-form')) ?>">Contato</a></li>
        <li><a href="<?= e(cfg('links.support')) ?>">Suporte</a></li>
        <li><a href="<?= e(url('private-sale.php')) ?>">Venda privada</a></li>
        <li><a href="<?= e(url('account.php')) ?>">Minha conta</a></li>
        <?php if (cfg('links.audit')): ?><li><a href="<?= e(cfg('links.audit')) ?>" target="_blank" rel="noopener">Relatório de auditoria</a></li><?php endif; ?>
      </ul>
    </div>

    <div class="wood-sign social-sign">
      <?php foreach (['discord' => 'Discord', 'instagram' => 'Instagram', 'telegram' => 'Telegram', 'twitter' => 'X (Twitter)'] as $key => $label): ?>
        <a href="<?= e(cfg('links.' . $key)) ?>" target="_blank" rel="noopener" aria-label="<?= e($label) ?>"><?= icon($key) ?></a>
      <?php endforeach; ?>
    </div>

    <div class="footer-cols">
      <div>
        <h3>Parcerias</h3>
        <p>Parcerias comerciais, guildas e criadores de conteúdo: use o <a href="<?= e(url('index.php#contato-form')) ?>">formulário de contato</a>.</p>
      </div>
      <div>
        <h3>Suporte ao jogo</h3>
        <p><a href="<?= e(cfg('links.discord')) ?>" target="_blank" rel="noopener">Discord — suporte do jogo</a><br>
           <a href="<?= e(cfg('links.discord')) ?>" target="_blank" rel="noopener">Discord — suporte do marketplace</a></p>
      </div>
    </div>

    <p class="legal">
      © <?= date('Y') ?> <?= e(cfg('app.name')) ?>. Imóveis e lotes do jogo são ativos digitais e não conferem direito sobre imóveis reais.
      Criptoativos têm alto risco e podem perder valor; nada neste site é recomendação de investimento.
    </p>
  </div>
</footer>
<div class="toast" role="status" aria-live="polite" hidden></div>
</body>
</html>
