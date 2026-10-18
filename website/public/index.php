<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

$stats    = GameData::stats();
$roadmap  = require __DIR__ . '/../src/data/roadmap.php';
$team     = require __DIR__ . '/../src/data/team.php';
$partners = require __DIR__ . '/../src/data/partners.php';
$token    = cfg('chain.token_address');

partial('head', ['title' => '', 'bodyClass' => 'page-home']);
partial('header');
?>

<!-- 1. HERO — layout "PLAY NOW" do kit de marca -->
<section class="hero sky">
  <div class="clouds" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="container hero-grid">
    <div class="hero-left">
      <img class="hero-logo" src="<?= e(asset('img/brand/logo-color.svg')) ?>" alt="<?= e(cfg('app.name')) ?>" width="420" height="221">
      <p class="eyebrow">Bem-vindo à</p>
      <h1>Smart Chain City</h1>
      <p class="lead">Muito mais que construir cidades: um jogo NFT 3D com economia sustentável, profissões, lotes e imóveis virtuais — e recompensas baseadas na sua estratégia.</p>
      <p class="lead small">Na versão Beta, entre com sua carteira MetaMask e receba SCITY de teste para jogar.</p>
      <p class="follow">Acompanhe o <a href="#roadmap">Roadmap</a> para ver as próximas funcionalidades.</p>
      <ul class="social-row">
        <?php foreach (['discord' => 'Discord', 'instagram' => 'Instagram', 'telegram' => 'Telegram', 'twitter' => 'X (Twitter)'] as $k => $l): ?>
          <li><a href="<?= e(cfg('links.' . $k)) ?>" target="_blank" rel="noopener" aria-label="<?= e($l) ?>"><?= icon($k) ?></a></li>
        <?php endforeach; ?>
      </ul>
      <div class="platforms" aria-label="Plataformas">
        <span class="platform is-active" title="Disponível no PC (navegador)"><img src="<?= e(asset('img/legacy/btn-app-win.svg')) ?>" alt="PC — disponível" width="150" height="50"></span>
        <span class="platform" title="Em breve"><img src="<?= e(asset('img/legacy/btn-app-android.svg')) ?>" alt="Android — em breve" width="142" height="50"></span>
        <span class="platform" title="Em breve"><img src="<?= e(asset('img/legacy/btn-app-apple.svg')) ?>" alt="iOS — em breve" width="146" height="50"></span>
      </div>
    </div>

    <div class="hero-right">
      <div class="round-actions">
        <a class="round-btn round-btn--play" href="<?= e(cfg('links.play')) ?>">
          <span>Play<br>Now</span>
          <i class="round-btn__dot"><?= icon('play') ?></i>
        </a>
        <a class="round-btn" href="<?= e(url('account.php')) ?>"><?= icon('user') ?><span>Conta</span></a>
        <a class="round-btn" href="<?= e(url('account.php#deposito')) ?>"><?= icon('download') ?><span>Depósito</span></a>
      </div>

      <div class="stone-panel stats-panel" data-stats>
        <?php
        $rows = [
            ['icon' => 'users', 'key' => 'avatars',        'label' => 'Avatares'],
            ['icon' => 'tree',  'key' => 'lands',          'label' => 'Lotes'],
            ['icon' => 'tax',   'key' => 'taxes',          'label' => 'Impostos'],
            ['icon' => 'alert', 'key' => 'work_accidents', 'label' => 'Acidentes de trabalho'],
        ];
        foreach ($rows as $r): ?>
          <div class="stat-row">
            <span class="stat-icon"><?= icon($r['icon']) ?></span>
            <strong data-count="<?= (int) $stats[$r['key']] ?>" data-stat="<?= e($r['key']) ?>"><?= num($stats[$r['key']]) ?></strong>
            <span class="stat-label"><?= e($r['label']) ?></span>
          </div>
        <?php endforeach; ?>
        <?php if ($stats['source'] === 'sample'): ?><p class="panel-note">Dados de demonstração</p><?php endif; ?>
      </div>
    </div>
  </div>
  <div class="skyline" aria-hidden="true"></div>
</section>

<!-- Contrato + Trade Now -->
<section class="contract-strip">
  <div class="container contract-inner">
    <div class="contract-box">
      <span class="contract-label">Contrato <?= e(cfg('chain.token_symbol')) ?></span>
      <?php if ($token): ?>
        <code data-copy-source><?= e($token) ?></code>
        <button class="btn btn--ghost" type="button" data-copy="<?= e($token) ?>"><?= icon('copy') ?> Copiar</button>
      <?php else: ?>
        <code>Endereço publicado no lançamento do token</code>
      <?php endif; ?>
    </div>
    <a class="btn btn--wood" href="<?= e(cfg('links.trade')) ?>" target="_blank" rel="noopener">Comprar token agora <b>Trade Now</b></a>
  </div>
</section>

<!-- 2. ROADMAP -->
<section class="section roadmap" id="roadmap">
  <div class="container">
    <h2 class="section-title">Roadmap</h2>
    <p class="section-sub">A evolução do desenvolvimento da cidade, etapa por etapa.</p>
    <ol class="road">
      <?php foreach ($roadmap as $i => $stage): ?>
        <li class="road-stop road-stop--<?= e($stage['status']) ?>" data-reveal>
          <div class="road-sign"><span><?= e($stage['code']) ?></span></div>
          <div class="road-card">
            <h3><?= e($stage['title']) ?>
              <?php if ($stage['status'] === 'current'): ?><em class="tag">Em andamento</em><?php elseif ($stage['status'] === 'done'): ?><em class="tag tag--done">Concluído</em><?php endif; ?>
            </h3>
            <ul><?php foreach ($stage['items'] as $it): ?><li><?= e($it) ?></li><?php endforeach; ?></ul>
          </div>
        </li>
      <?php endforeach; ?>
    </ol>
  </div>
</section>

<!-- 3. TRAILER -->
<section class="section trailer" id="trailer">
  <div class="container">
    <h2 class="section-title section-title--light">Trailer oficial</h2>
    <div class="wood-frame">
      <?php if (cfg('links.trailer')): ?>
        <button class="video-cover" type="button" data-video="<?= e(cfg('links.trailer')) ?>" aria-label="Assistir ao trailer">
          <img src="<?= e(asset('img/legacy/video-frame.webp')) ?>" alt="" loading="lazy">
        </button>
      <?php else: ?>
        <div class="video-cover is-placeholder">
          <img src="<?= e(asset('img/legacy/video-frame.webp')) ?>" alt="Cena da cidade" loading="lazy">

          <span class="soon">Trailer em breve</span>
        </div>
      <?php endif; ?>
    </div>
  </div>
</section>

<!-- Como funciona (HUD do jogo) -->
<section class="section features">
  <div class="container">
    <h2 class="section-title">Viva a cidade</h2>
    <div class="feature-grid">
      <article class="feature" data-reveal>
        <img src="<?= e(asset('img/hud/profissao.png')) ?>" alt="" width="72" height="72" loading="lazy">
        <h3>Smartcityanos</h3>
        <p>Abra uma Lucky Box, receba seu avatar NFT e escolha entre 44 profissões em quatro raridades.</p>
      </article>
      <article class="feature" data-reveal>
        <img src="<?= e(asset('img/hud/casa.png')) ?>" alt="" width="72" height="72" loading="lazy">
        <h3>Lotes e imóveis</h3>
        <p>Compre lotes na região central A1, construa casas T1–T3 e edifícios, alugue e colete renda.</p>
      </article>
      <article class="feature" data-reveal>
        <img src="<?= e(asset('img/hud/almentacao.png')) ?>" alt="" width="72" height="72" loading="lazy">
        <h3>Vida real simulada</h3>
        <p>Energia, saúde, felicidade e alimentação definem quanto seu avatar rende em cada turno.</p>
      </article>
      <article class="feature" data-reveal>
        <img src="<?= e(asset('img/hud/arvore.png')) ?>" alt="" width="72" height="72" loading="lazy">
        <h3>Fazendas e negócios</h3>
        <p>Plante, crie animais, abra mercados, oficinas e hotéis numa economia entre jogadores.</p>
      </article>
    </div>
    <figure class="hud-showcase" data-reveal>
      <img src="<?= e(asset('img/hud/card-imovel-t1.png')) ?>" alt="Card de imóvel T1 no jogo: nível, rendimento, desgaste, localização, ROI e botão Claim" loading="lazy" width="960" height="540">
    </figure>
  </div>
</section>

<!-- 4. EQUIPE -->
<section class="section team" id="equipe">
  <div class="container">
    <h2 class="section-title">Equipe</h2>
    <div class="team-grid">
      <?php foreach ($team as $m): ?>
        <article class="player-card player-card--<?= e($m['rarity']) ?>" data-reveal>
          <div class="player-photo">
            <?php if ($m['photo']): ?>
              <img src="<?= e(asset('img/team/' . $m['photo'])) ?>" alt="<?= e($m['name']) ?>" loading="lazy">
            <?php else: ?>
              <?= icon('user', 'icon placeholder-avatar') ?>
            <?php endif; ?>
          </div>
          <h3><?= e($m['name']) ?></h3>
          <p><?= e($m['role']) ?></p>
        </article>
      <?php endforeach; ?>
    </div>
  </div>
</section>

<!-- 5. PARCEIROS -->
<section class="section partners" id="parceiros">
  <div class="container">
    <h2 class="section-title">Parceiros e apoiadores</h2>
    <ul class="partner-row">
      <?php foreach ($partners as $p): ?>
        <li><a href="<?= e($p['url']) ?>" target="_blank" rel="noopener"><img src="<?= e(asset($p['logo'])) ?>" alt="<?= e($p['name']) ?>" loading="lazy"></a></li>
      <?php endforeach; ?>
    </ul>
  </div>
</section>

<!-- Contato -->
<section class="section contact" id="contato-form">
  <div class="container narrow">
    <h2 class="section-title">Fale com a gente</h2>
    <form class="stone-panel contact-form" method="post" action="<?= e(url('api/contact.php')) ?>" data-ajax-form novalidate>
      <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
      <div class="hp" aria-hidden="true"><label>Não preencha <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
      <label>Nome <input type="text" name="name" required maxlength="120" autocomplete="name"></label>
      <label>E-mail <input type="email" name="email" required maxlength="160" autocomplete="email"></label>
      <label>Assunto
        <select name="topic">
          <option value="suporte">Suporte</option>
          <option value="parceria">Parceria comercial</option>
          <option value="guilda">Guilda</option>
          <option value="criador">Criador de conteúdo</option>
          <option value="imprensa">Imprensa</option>
        </select>
      </label>
      <label class="full">Mensagem <textarea name="message" rows="4" required maxlength="2000"></textarea></label>
      <button class="btn btn--green full" type="submit">Enviar mensagem</button>
      <p class="form-status full" aria-live="polite"></p>
    </form>
  </div>
</section>

<?php partial('footer'); ?>
