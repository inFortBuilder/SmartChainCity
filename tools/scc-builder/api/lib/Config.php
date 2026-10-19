<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Carrega e expõe a configuração da aplicação.
 *
 * Ordem de precedência (o último vence):
 *   1. defaults desta classe
 *   2. api/config.local.php  (array retornado)
 *   3. variáveis de ambiente SCC_BUILDER_*
 *
 * Nada de segredo deve viver neste arquivo — ele é versionado.
 */
final class Config
{
    private static ?array $data = null;

    /** @return array<string,mixed> */
    private static function defaults(): array
    {
        $base = \dirname(__DIR__, 2);

        return [
            'version' => '0.1.0',

            // ── Armazenamento ────────────────────────────────────────────
            // Recomendação forte: aponte storage_dir para FORA do webroot.
            // Ex.: 'C:/wamp64/scc-builder-storage' ou '/var/lib/scc-builder'
            'storage_dir'          => $base . '/storage',
            'max_file_size'        => 524288000,   // 500 MB
            'retention_days'       => 30,          // limpeza automática

            // ── Segurança ────────────────────────────────────────────────
            // JWT HS256 emitido pelo gateway SCC (login SIWE): sub = account_id,
            // exp obrigatório. VAZIO = só API key. O segredo vive no
            // config.local.php ou em SCC_BUILDER_JWT_SECRET, nunca aqui.
            'jwt_secret'           => '',
            'jwt_issuer'           => '',          // confere iss quando preenchido
            'jwt_audience'         => '',          // confere aud quando preenchido
            'jwt_leeway'           => 30,          // tolerância de relógio, em segundos
            // API keys para chamadas servidor a servidor (opcional).
            'api_keys'             => [],
            // Origens permitidas para CORS. '*' só é aceito se allow_public=true.
            'cors_origins'         => ['http://localhost', 'http://localhost:5173'],
            'allow_public'         => false,       // true dispensa credencial (só em desenvolvimento)
            'rate_limit_requests'  => 60,          // requisições por janela
            'rate_limit_window'    => 60,          // janela em segundos

            // ── Conversão ────────────────────────────────────────────────
            'node_bin'             => 'node',      // caminho absoluto em produção
            'convert_timeout'      => 600,         // segundos
            'async_threshold'      => 16777216,    // 16 MB → acima disso, vai para a fila
            'queue_enabled'        => true,

            // ── Formatos ─────────────────────────────────────────────────
            // Apenas o que o pipeline realmente sabe processar.
            'input_formats'        => ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae'],
            'output_formats'       => ['glb', 'gltf'],

            // ── Publicação no S3 ─────────────────────────────────────────
            // Quando ligado, o GLB convertido também vai para o bucket SCC em
            //   <s3_prefix>/<account_id>/<model_id>/v<n>/modelo.glb
            // A configuração é toda daqui (ou SCC_BUILDER_S3_*): o SCC Builder
            // não lê arquivo de nenhuma outra aplicação.
            //
            // O arquivo continua em storage/converted/ de qualquer forma: o
            // download.php serve dali, e falha de rede não pode perder a
            // conversão que o usuário acabou de esperar.
            's3_enabled'           => false,
            's3_bucket'            => '',
            's3_region'            => 'sa-east-1',
            's3_key'               => '',          // vazio = credencial do ambiente (IAM role)
            's3_secret'            => '',
            's3_endpoint'          => '',          // S3 compatível (MinIO, R2…)
            's3_path_style'        => false,
            's3_prefix'            => 'builder',
            's3_url_base'          => '',          // CDN pública, se houver
            's3_acl'               => '',
            's3_cache_control'     => 'public, max-age=31536000, immutable',
            's3_retries'           => 3,

            // ── Regras do lote (validate-lot.php) ────────────────────────
            // Os limites do lote (polígono, recuo, gabarito, coeficiente) vêm
            // na requisição; aqui ficam as regras da cidade (doc 13 §4).
            'lot_max_triangles'    => 300000,
            'lot_floor_height_m'   => 3.2,         // pé-direito para sugerir andares
            'lot_gfa_efficiency'   => 0.85,        // área útil por andar sobre a projeção
            'lot_outorga_scity_m2' => 2.5,         // outorga onerosa por m² excedente
            'lot_min_height_m'     => 2,           // escala plausível
            'lot_max_height_m'     => 400,

            // ── Diagnóstico ──────────────────────────────────────────────
            'debug'                => false,
            'log_level'            => 'info',      // debug|info|warning|error
        ];
    }

    /** @return array<string,mixed> */
    public static function all(): array
    {
        if (self::$data !== null) {
            return self::$data;
        }

        $config = self::defaults();

        $localFile = \dirname(__DIR__) . '/config.local.php';
        if (\is_file($localFile)) {
            /** @var mixed $local */
            $local = require $localFile;
            if (\is_array($local)) {
                $config = \array_replace($config, $local);
            }
        }

        // Sobrescrita por ambiente: SCC_BUILDER_API_KEYS, SCC_BUILDER_STORAGE_DIR, ...
        foreach (\array_keys($config) as $key) {
            $env = \getenv('SCC_BUILDER_' . \strtoupper($key));
            if ($env === false || $env === '') {
                continue;
            }
            $config[$key] = match (true) {
                \is_bool($config[$key])  => \filter_var($env, FILTER_VALIDATE_BOOLEAN),
                \is_int($config[$key])   => (int) $env,
                \is_float($config[$key]) => (float) $env,
                \is_array($config[$key]) => \array_values(\array_filter(\array_map('trim', \explode(',', $env)))),
                default                  => $env,
            };
        }

        $config['storage_dir'] = \rtrim(\str_replace('\\', '/', (string) $config['storage_dir']), '/');

        return self::$data = $config;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::all()[$key] ?? $default;
    }

    public static function isConfigured(): bool
    {
        return self::get('allow_public') === true
            || (string) self::get('jwt_secret', '') !== ''
            || \count((array) self::get('api_keys')) > 0;
    }

    /** Apenas para testes. */
    public static function reset(): void
    {
        self::$data = null;
    }

    /**
     * Sobrescreve chaves já carregadas. Apenas para testes.
     *
     * @param array<string,mixed> $valores
     */
    public static function override(array $valores): void
    {
        self::$data = \array_replace(self::all(), $valores);
    }
}
