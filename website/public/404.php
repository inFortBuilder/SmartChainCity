<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
http_response_code(404);
partial('head', ['title' => 'Página não encontrada', 'bodyClass' => 'page-404']);
partial('header');
?>
<section class="section sky sky--short">
  <div class="container narrow center">
    <div class="stone-panel">
      <h1>Rua sem saída!</h1>
      <p>Esta página não existe ou mudou de endereço.</p>
      <a class="btn btn--green" href="<?= e(url('index.php')) ?>"><?= icon('home') ?> Voltar para a cidade</a>
    </div>
  </div>
</section>
<?php partial('footer'); ?>
