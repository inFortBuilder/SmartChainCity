<?php

declare(strict_types=1);

/**
 * SCC Builder — configuração LOCAL.
 *
 * 1. Copie este arquivo para  api/config.local.php
 * 2. Gere segredos fortes:    php -r "echo bin2hex(random_bytes(32));"
 * 3. NUNCA versione config.local.php (já está no .gitignore)
 *
 * Cada chave também aceita variável de ambiente SCC_BUILDER_<CHAVE>
 * (ex.: SCC_BUILDER_JWT_SECRET), que vence este arquivo — é o caminho do
 * contêiner.
 */

return [
    // ── Autenticação ─────────────────────────────────────────────────────
    // Segredo HS256 compartilhado com o gateway SCC, que emite o JWT no
    // login SIWE. Claims exigidos: sub (account_id) e exp.
    'jwt_secret'   => 'TROQUE-ME-o-mesmo-segredo-do-gateway',
    'jwt_issuer'   => '',   // ex.: 'scc-gateway' — vazio não confere
    'jwt_audience' => '',   // ex.: 'scc-builder' — vazio não confere

    // API keys para chamadas servidor a servidor (opcional). O índice
    // identifica o consumidor nos logs. Com o header X-Account-Id a chave age
    // em nome daquele jogador; sem ele, os jobs ficam no escopo da chave.
    'api_keys' => [
        'world' => 'TROQUE-ME-cole-aqui-uma-chave-de-64-hex',
    ],

    // Origens autorizadas a chamar a API pelo browser.
    'cors_origins' => [
        'http://localhost',
        'http://localhost:5173',
    ],

    // true = sem exigência de credencial. Use APENAS em desenvolvimento local.
    'allow_public' => false,

    'rate_limit_requests' => 60,
    'rate_limit_window'   => 60,

    // ── Armazenamento ────────────────────────────────────────────────────
    // FORTEMENTE recomendado: um caminho FORA do webroot
    'storage_dir'    => 'C:/scc-builder-storage',
    'max_file_size'  => 524288000, // 500 MB
    'retention_days' => 30,

    // ── Publicação no bucket SCC ─────────────────────────────────────────
    // Layout: <s3_prefix>/<account_id>/<model_id>/v<n>/modelo.glb
    's3_enabled'  => false,
    's3_bucket'   => 'scc-builder',
    's3_region'   => 'sa-east-1',
    's3_key'      => '',
    's3_secret'   => '',
    's3_endpoint' => '',     // MinIO/R2: 'http://localhost:9000'
    's3_path_style' => false,
    's3_url_base' => '',     // CDN pública, se houver

    // ── Conversão ────────────────────────────────────────────────────────
    // Caminho ABSOLUTO do Node. O Apache normalmente não herda o PATH do usuário.
    'node_bin'         => 'C:/Program Files/nodejs/node.exe',
    'convert_timeout'  => 600,
    'async_threshold'  => 16777216, // 16 MB
    'queue_enabled'    => true,

    // ── Diagnóstico ──────────────────────────────────────────────────────
    'debug'     => false,
    'log_level' => 'info',
];
