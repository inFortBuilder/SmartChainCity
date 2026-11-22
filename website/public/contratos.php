<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

$c = OfficialContracts::all();
$explorer = rtrim((string) cfg('chain.explorer'), '/');
$link = static fn (string $a): string => $explorer && $c['chain_id'] !== 31337 ? $explorer . '/address/' . $a : '';

partial('head', [
    'title'       => 'Contratos oficiais',
    'description' => 'Os endereços oficiais do Smart Chain City na BNB Smart Chain: token, cofre, mercado, NFTs, vesting e LP travado.',
    'bodyClass'   => 'page-contracts',
]);
partial('header');

$row = static function (array $r) use ($link): void { ?>
  <tr>
    <th scope="row"><?= e($r['label']) ?><small><?= e($r['what']) ?></small></th>
    <td>
      <code><?= e($r['address']) ?></code>
      <span class="contract-actions">
        <button class="btn btn--ghost btn--small" type="button" data-copy="<?= e($r['address']) ?>"><?= icon('copy') ?> Copiar</button>
        <?php if ($link($r['address'])): ?><a class="btn btn--ghost btn--small" href="<?= e($link($r['address'])) ?>" target="_blank" rel="noopener">BscScan</a><?php endif; ?>
      </span>
    </td>
  </tr>
<?php };
?>
<section class="section field">
  <div class="container">
    <h1 class="section-title section-title--light">Contratos oficiais</h1>
    <p class="section-sub section-sub--light">Só confie nestes endereços. A equipe nunca pede sua seed, chave privada ou senha.</p>

    <div class="stone-panel contracts-panel">
      <p class="contracts-chain">Rede: <strong><?= e((string) cfg('chain.chain_name')) ?></strong> (chain id <?= (int) $c['chain_id'] ?>)</p>

      <?php if (!$c['published']): ?>
        <p class="contracts-empty">Os contratos ainda não foram publicados nesta rede. Quando forem, os endereços aparecem aqui, junto com o relatório da auditoria. <strong>Qualquer token "SCITY" antes disso é falso.</strong></p>
      <?php else: ?>
        <table class="contract-table">
          <caption>Jogo e token</caption>
          <tbody><?php foreach ($c['core'] as $r) { $row($r); } ?></tbody>
        </table>

        <?php if ($c['tge']): ?>
          <table class="contract-table">
            <caption>Distribuição do token (vesting)</caption>
            <tbody><?php foreach ($c['tge'] as $r) { $row($r); } ?></tbody>
          </table>
        <?php endif; ?>

        <?php if ($c['lock']): ?>
          <table class="contract-table">
            <caption>Liquidez travada</caption>
            <tbody><?php $row([
                'label' => 'Trava do LP (TokenLock)',
                'what'  => 'Liberação em ' . date('d/m/Y', $c['lock']['release']) . ' (mínimo de 12 meses, só pode ser estendida)',
                'address' => $c['lock']['address'],
            ]); ?></tbody>
          </table>
        <?php endif; ?>
      <?php endif; ?>

      <p class="panel-note">Os endereços vêm direto dos arquivos de deploy publicados no repositório do projeto.
        <?php if (cfg('links.audit')): ?><a href="<?= e(cfg('links.audit')) ?>" target="_blank" rel="noopener">Relatório de auditoria</a>.<?php endif; ?></p>
    </div>
  </div>
</section>
<?php partial('footer'); ?>
