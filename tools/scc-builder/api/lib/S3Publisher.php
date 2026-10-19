<?php

declare(strict_types=1);

namespace SccBuilder\Api;

/**
 * Publicação dos modelos convertidos no bucket da Smart Chain City.
 *
 * Layout no bucket (doc 13 §5.1):
 *
 *     <s3_prefix>/<account_id>/<model_id>/v<n>/modelo.glb
 *                                             /modelo-lod1.glb
 *                                             /modelo-lod2.glb
 *                                             /modelo.meta.json
 *
 * A configuração é toda do SCC Builder (s3_* em Config). O envio usa uma
 * assinatura AWS SigV4 própria sobre cURL — S3, MinIO e R2 aceitam —, sem
 * SDK nem vendor/ de outra aplicação.
 *
 * O envio é OPCIONAL: só acontece com 's3_enabled' verdadeiro e bucket
 * definido. Falha no envio não derruba a conversão — o arquivo continua no
 * disco e o job segue completo.
 */
final class S3Publisher
{
    /** Cliente injetado (testes): precisa de putObject(array $args). */
    private static ?object $cliente = null;

    public static function ativo(): bool
    {
        return Config::get('s3_enabled') === true && (string) Config::get('s3_bucket', '') !== '';
    }

    /**
     * Chave de um arquivo do modelo: <prefixo>/<account_id>/<model_id>/v<n>/<arquivo>.
     */
    public static function chave(string $accountId, string $modelId, int $versao, string $arquivo = 'modelo.glb'): string
    {
        $prefixo = \trim((string) Config::get('s3_prefix', 'builder'), '/');

        return ($prefixo === '' ? '' : $prefixo . '/')
            . self::higienizar($accountId) . '/'
            . self::higienizar($modelId) . '/'
            . 'v' . \max(1, $versao) . '/'
            . self::higienizar($arquivo);
    }

    /**
     * Envia os arquivos de um job para o bucket.
     *
     * @param array<string,mixed>  $job      linha do JobRepository (owner, model_id, version)
     * @param array<string,string> $arquivos nome no bucket => caminho local
     *
     * @return array<string,string> nome no bucket => chave gravada (só os que subiram)
     */
    public static function publicarJob(array $job, array $arquivos): array
    {
        if (!self::ativo()) {
            return [];
        }

        $gravadas = [];
        foreach ($arquivos as $nome => $caminho) {
            $chave = self::publicar(
                $caminho,
                (string) $job['owner'],
                (string) ($job['model_id'] ?? $job['id']),
                (int) ($job['version'] ?? 1),
                $nome
            );
            if ($chave !== null) {
                $gravadas[$nome] = $chave;
            }
        }

        return $gravadas;
    }

    /**
     * @return string|null a chave gravada, ou null se a publicação está
     *                     desligada ou falhou
     */
    public static function publicar(
        string $caminhoLocal,
        string $accountId,
        string $modelId,
        int $versao,
        string $arquivo = 'modelo.glb'
    ): ?string {
        if (!self::ativo()) {
            return null;
        }

        if (!\is_file($caminhoLocal)) {
            Logger::warning('S3: arquivo do modelo não encontrado', ['caminho' => $caminhoLocal]);

            return null;
        }

        $chave = self::chave($accountId, $modelId, $versao, $arquivo);

        $args = [
            'Bucket'      => (string) Config::get('s3_bucket'),
            'Key'         => $chave,
            'SourceFile'  => $caminhoLocal,
            'ContentType' => self::tipoConteudo($arquivo),
        ];

        if ((string) Config::get('s3_cache_control', '') !== '') {
            $args['CacheControl'] = (string) Config::get('s3_cache_control');
        }

        if ((string) Config::get('s3_acl', '') !== '') {
            $args['ACL'] = (string) Config::get('s3_acl');
        }

        $tentativas = \max(1, (int) Config::get('s3_retries', 3));

        for ($i = 1; $i <= $tentativas; $i++) {
            try {
                if (self::$cliente !== null) {
                    self::$cliente->putObject($args);
                } else {
                    self::putObject($args);
                }

                Logger::info('S3: modelo publicado', ['chave' => $chave]);

                return $chave;
            } catch (\Throwable $e) {
                // Não propaga: a conversão já deu certo e o arquivo está em disco.
                Logger::error('S3: falha ao publicar modelo', [
                    'chave'     => $chave,
                    'tentativa' => $i,
                    'erro'      => $e->getMessage(),
                ]);
            }
        }

        return null;
    }

    /**
     * URL pública de um objeto já publicado (CDN), quando configurada.
     */
    public static function url(string $chave): ?string
    {
        $base = \rtrim((string) Config::get('s3_url_base', ''), '/');

        return $base === '' ? null : $base . '/' . \ltrim($chave, '/');
    }

    /**
     * Reduz um pedaço de caminho ao que é seguro numa chave de objeto.
     */
    public static function higienizar(string $texto): string
    {
        $texto = \preg_replace('/[^A-Za-z0-9._-]+/', '-', $texto) ?? '';
        $texto = \trim(\preg_replace('/-+/', '-', $texto) ?? '', '-.');

        return $texto === '' ? 'sem-nome' : $texto;
    }

    /**
     * Injeta um cliente pronto (testes / SDK oficial, se preferir).
     */
    public static function definirCliente(?object $cliente): void
    {
        self::$cliente = $cliente;
    }

    // ── interno ──────────────────────────────────────────────────────────

    /**
     * PUT Object assinado com AWS Signature V4.
     *
     * @param array<string,string> $args
     */
    private static function putObject(array $args): void
    {
        $chaveAcesso = (string) Config::get('s3_key', '') ?: (string) \getenv('AWS_ACCESS_KEY_ID');
        $segredo     = (string) Config::get('s3_secret', '') ?: (string) \getenv('AWS_SECRET_ACCESS_KEY');
        $sessao      = (string) \getenv('AWS_SESSION_TOKEN');
        $regiao      = (string) Config::get('s3_region', 'sa-east-1');

        if ($chaveAcesso === '' || $segredo === '') {
            throw new \RuntimeException('Credenciais do bucket ausentes (s3_key/s3_secret ou AWS_ACCESS_KEY_ID).');
        }

        [$url, $host, $caminho] = self::endereco($args['Bucket'], $args['Key']);

        $corpo     = (string) \file_get_contents($args['SourceFile']);
        $hashCorpo = \hash('sha256', $corpo);
        $agora     = \gmdate('Ymd\THis\Z');
        $dia       = \substr($agora, 0, 8);

        $headers = [
            'content-type'         => $args['ContentType'],
            'host'                 => $host,
            'x-amz-content-sha256' => $hashCorpo,
            'x-amz-date'           => $agora,
        ];
        if (isset($args['CacheControl'])) {
            $headers['cache-control'] = $args['CacheControl'];
        }
        if (isset($args['ACL'])) {
            $headers['x-amz-acl'] = $args['ACL'];
        }
        if ($sessao !== '') {
            $headers['x-amz-security-token'] = $sessao;
        }
        \ksort($headers);

        $canonHeaders = '';
        foreach ($headers as $nome => $valor) {
            $canonHeaders .= $nome . ':' . \trim($valor) . "\n";
        }
        $assinados = \implode(';', \array_keys($headers));

        $requisicao = "PUT\n{$caminho}\n\n{$canonHeaders}\n{$assinados}\n{$hashCorpo}";
        $escopo     = "{$dia}/{$regiao}/s3/aws4_request";
        $paraAssinar = "AWS4-HMAC-SHA256\n{$agora}\n{$escopo}\n" . \hash('sha256', $requisicao);

        $k = \hash_hmac('sha256', $dia, 'AWS4' . $segredo, true);
        $k = \hash_hmac('sha256', $regiao, $k, true);
        $k = \hash_hmac('sha256', 's3', $k, true);
        $k = \hash_hmac('sha256', 'aws4_request', $k, true);
        $assinatura = \hash_hmac('sha256', $paraAssinar, $k);

        $linhas = [];
        foreach ($headers as $nome => $valor) {
            if ($nome !== 'host') {
                $linhas[] = $nome . ': ' . $valor;
            }
        }
        $linhas[] = "Authorization: AWS4-HMAC-SHA256 Credential={$chaveAcesso}/{$escopo}, "
            . "SignedHeaders={$assinados}, Signature={$assinatura}";

        $ch = \curl_init($url);
        \curl_setopt_array($ch, [
            \CURLOPT_CUSTOMREQUEST  => 'PUT',
            \CURLOPT_POSTFIELDS     => $corpo,
            \CURLOPT_HTTPHEADER     => $linhas,
            \CURLOPT_RETURNTRANSFER => true,
            \CURLOPT_TIMEOUT        => 120,
        ]);
        $resposta = \curl_exec($ch);
        $status   = (int) \curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        $erro     = \curl_error($ch);
        \curl_close($ch);

        if ($resposta === false || $status < 200 || $status >= 300) {
            throw new \RuntimeException("PUT {$caminho} respondeu {$status}. {$erro} " . \substr((string) $resposta, 0, 300));
        }
    }

    /**
     * URL, host e caminho canônico do objeto.
     *
     * @return array{0:string,1:string,2:string}
     */
    public static function endereco(string $bucket, string $chave): array
    {
        $chaveCodificada = \implode('/', \array_map('rawurlencode', \explode('/', $chave)));
        $endpoint        = \rtrim((string) Config::get('s3_endpoint', ''), '/');
        $regiao          = (string) Config::get('s3_region', 'sa-east-1');

        if ($endpoint === '') {
            $endpoint = "https://s3.{$regiao}.amazonaws.com";
        }

        $partes = \parse_url($endpoint) ?: [];
        $esquema = $partes['scheme'] ?? 'https';
        $host    = ($partes['host'] ?? '') . (isset($partes['port']) ? ':' . $partes['port'] : '');

        if (Config::get('s3_path_style') === true) {
            $caminho = '/' . \rawurlencode($bucket) . '/' . $chaveCodificada;
        } else {
            $host    = $bucket . '.' . $host;
            $caminho = '/' . $chaveCodificada;
        }

        return ["{$esquema}://{$host}{$caminho}", $host, $caminho];
    }

    private static function tipoConteudo(string $arquivo): string
    {
        return match (\strtolower(\pathinfo($arquivo, \PATHINFO_EXTENSION))) {
            'glb'   => 'model/gltf-binary',
            'gltf'  => 'model/gltf+json',
            'json'  => 'application/json',
            'bin'   => 'application/octet-stream',
            'png'   => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'ktx2'  => 'image/ktx2',
            default => 'application/octet-stream',
        };
    }
}
