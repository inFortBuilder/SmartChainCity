<?php

declare(strict_types=1);

namespace SccBuilder;

/**
 * SDK PHP do SCC Builder — v2.
 *
 * Diferenças em relação à v1:
 *  - autenticação por API key (servidor a servidor, opcionalmente em nome
 *    de um jogador via X-Account-Id) ou pelo JWT do gateway SCC;
 *  - envelope de resposta novo ({status, data, error});
 *  - suporte a jobs assíncronos com polling (waitForJob);
 *  - retry com backoff exponencial em falhas transitórias;
 *  - timeout configurável e separado para upload e para consulta;
 *  - exceções tipadas em vez de \RuntimeException genérica;
 *  - download do arquivo convertido direto para disco.
 *
 * Requer as extensões: curl, json.
 *
 * Exemplo:
 *
 *   $client = new SccBuilderClient('http://localhost/scc-builder/api', 'SUA-CHAVE');
 *   $job    = $client->convertAndWait('C:/modelos/casa.obj', ['optimize' => 'aggressive']);
 *   $client->downloadTo($job['id'], 'C:/saida/casa.glb');
 */
class SccBuilderClient
{
    public const OPTIMIZE_NONE       = 'none';
    public const OPTIMIZE_BALANCED   = 'balanced';
    public const OPTIMIZE_AGGRESSIVE = 'aggressive';

    private string $apiUrl;
    private string $apiKey;
    private string $token;
    private string $accountId;
    private int $timeout;
    private int $uploadTimeout;
    private int $maxRetries;
    private bool $verifySsl;

    /** @var callable|null */
    private $logger = null;

    public function __construct(
        string $apiUrl = 'http://localhost/scc-builder/api',
        string $apiKey = '',
        array $options = []
    ) {
        if (!\extension_loaded('curl')) {
            throw new SccBuilderException('missing_extension', 'A extensão cURL do PHP é obrigatória.');
        }

        $this->apiUrl        = \rtrim($apiUrl, '/');
        $this->apiKey        = $apiKey;
        $this->timeout       = (int) ($options['timeout'] ?? 30);
        $this->uploadTimeout = (int) ($options['upload_timeout'] ?? 900);
        $this->maxRetries    = (int) ($options['max_retries'] ?? 2);
        $this->verifySsl     = (bool) ($options['verify_ssl'] ?? true);
        // 'token': JWT do jogador (Authorization: Bearer); vence a API key.
        // 'account_id': com API key, age em nome desse jogador (X-Account-Id).
        $this->token         = (string) ($options['token'] ?? '');
        $this->accountId     = (string) ($options['account_id'] ?? '');
    }

    /** Registra um callable(string $mensagem, array $contexto) para diagnóstico. */
    public function setLogger(callable $logger): void
    {
        $this->logger = $logger;
    }

    // ── Endpoints ────────────────────────────────────────────────────────

    /**
     * Diagnóstico da instalação (Node presente, storage gravável, limites do PHP).
     *
     * @return array<string,mixed>
     */
    public function health(): array
    {
        return $this->request('GET', '/health.php');
    }

    /**
     * Envia um arquivo para conversão.
     *
     * @param string $filePath Caminho absoluto local
     * @param array{
     *     target_format?: string,
     *     optimize?: string,
     *     flip_axis?: bool,
     *     scale?: float,
     *     preset?: string,
     *     model_id?: string,
     *     external_ref?: string,
     *     async?: bool
     * } $options
     * @return array<string,mixed> O job criado
     */
    public function convert(string $filePath, array $options = []): array
    {
        if (!\is_file($filePath)) {
            throw new SccBuilderException('file_not_found', "Arquivo não encontrado: {$filePath}");
        }

        if (!\is_readable($filePath)) {
            throw new SccBuilderException('file_unreadable', "Sem permissão de leitura: {$filePath}");
        }

        $fields = [
            'file'          => new \CURLFile($filePath, 'application/octet-stream', \basename($filePath)),
            'target_format' => $options['target_format'] ?? 'glb',
            'optimize'      => $options['optimize'] ?? self::OPTIMIZE_BALANCED,
            'flip_axis'     => !empty($options['flip_axis']) ? 'true' : 'false',
            'scale'         => (string) ($options['scale'] ?? 1.0),
            'preset'        => (string) ($options['preset'] ?? 'scc'),
        ];

        if (!empty($options['model_id'])) {
            $fields['model_id'] = (string) $options['model_id'];
        }

        if (!empty($options['external_ref'])) {
            $fields['external_ref'] = (string) $options['external_ref'];
        }
        if (!empty($options['async'])) {
            $fields['async'] = 'true';
        }

        $this->log('Enviando arquivo para conversão', [
            'file' => \basename($filePath),
            'size' => \filesize($filePath),
        ]);

        $data = $this->request('POST', '/convert.php', $fields, $this->uploadTimeout);

        return $data['job'] ?? [];
    }

    /**
     * Converte e aguarda a conclusão, mesmo que o job caia na fila.
     *
     * @param array<string,mixed> $options
     * @param callable|null $onProgress function(array $job): void
     * @return array<string,mixed> Job concluído
     */
    public function convertAndWait(
        string $filePath,
        array $options = [],
        ?callable $onProgress = null,
        int $maxWaitSeconds = 1800
    ): array {
        $job = $this->convert($filePath, $options);

        if (($job['status'] ?? '') === 'completed') {
            return $job;
        }

        if (($job['status'] ?? '') === 'failed') {
            throw new SccBuilderException(
                (string) ($job['error_code'] ?? 'conversion_failed'),
                (string) ($job['error_message'] ?? 'A conversão falhou.')
            );
        }

        return $this->waitForJob((string) $job['id'], $onProgress, $maxWaitSeconds);
    }

    /**
     * Consulta um job.
     *
     * @return array<string,mixed>
     */
    public function getJob(string $jobId): array
    {
        $data = $this->request('GET', '/jobs.php?job_id=' . \rawurlencode($jobId));

        return $data['job'] ?? [];
    }

    /**
     * Aguarda um job terminar, com polling de intervalo crescente.
     *
     * @param callable|null $onProgress function(array $job): void
     * @return array<string,mixed>
     */
    public function waitForJob(
        string $jobId,
        ?callable $onProgress = null,
        int $maxWaitSeconds = 1800
    ): array {
        $deadline = \time() + $maxWaitSeconds;
        $interval = 1;

        while (\time() < $deadline) {
            $job = $this->getJob($jobId);

            if ($onProgress !== null) {
                $onProgress($job);
            }

            $status = (string) ($job['status'] ?? '');

            if ($status === 'completed') {
                $this->log('Job concluído', ['job_id' => $jobId]);

                return $job;
            }

            if ($status === 'failed') {
                throw new SccBuilderException(
                    (string) ($job['error_code'] ?? 'conversion_failed'),
                    (string) ($job['error_message'] ?? 'A conversão falhou.'),
                    422,
                    $job
                );
            }

            \sleep($interval);
            $interval = \min(8, $interval + 1); // backoff suave
        }

        throw new SccBuilderException(
            'timeout',
            "O job {$jobId} não terminou em {$maxWaitSeconds}s. Verifique se o worker está rodando "
                . '(php bin/worker.php).'
        );
    }

    /**
     * Confere um job convertido contra o lote (doc 13 §5.3).
     *
     * @param array<string,mixed> $lot       polygon [[x,z]…], setback_m, max_height_m, far
     * @param array<string,mixed> $transform rotation_deg, units, position
     * @return array<string,mixed> valid, checks, footprint, suggested_floors, artifacts
     */
    public function validateLot(string $jobId, array $lot, array $transform = []): array
    {
        return $this->request('POST', '/validate-lot.php', (string) \json_encode([
            'job_id'    => $jobId,
            'lot'       => $lot,
            'transform' => (object) $transform,
        ]));
    }

    /**
     * Lista os modelos convertidos.
     *
     * @return array{models: array<int,array<string,mixed>>, pagination: array<string,mixed>}
     */
    public function listModels(int $page = 1, int $perPage = 20): array
    {
        $data = $this->request(
            'GET',
            \sprintf('/models.php?action=list&page=%d&per_page=%d', $page, $perPage)
        );

        return [
            'models'     => $data['models'] ?? [],
            'pagination' => $data['pagination'] ?? [],
        ];
    }

    public function deleteModel(string $jobId): bool
    {
        $data = $this->request('DELETE', '/models.php?job_id=' . \rawurlencode($jobId));

        return !empty($data['deleted']);
    }

    /**
     * Baixa o arquivo convertido para o disco local.
     *
     * @param string $jobId
     * @param string $destination Caminho de destino
     * @param string $source 'converted' ou 'original'
     * @return int bytes gravados
     */
    public function downloadTo(string $jobId, string $destination, string $source = 'converted'): int
    {
        $dir = \dirname($destination);
        if (!\is_dir($dir) && !@\mkdir($dir, 0o755, true) && !\is_dir($dir)) {
            throw new SccBuilderException('io_error', "Não foi possível criar o diretório: {$dir}");
        }

        $handle = @\fopen($destination, 'wb');
        if ($handle === false) {
            throw new SccBuilderException('io_error', "Não foi possível gravar em: {$destination}");
        }

        $url = $this->apiUrl . '/download.php?job_id=' . \rawurlencode($jobId)
            . '&source=' . \rawurlencode($source);

        $ch = \curl_init($url);
        \curl_setopt_array($ch, [
            \CURLOPT_FILE           => $handle,
            \CURLOPT_FOLLOWLOCATION => true,
            \CURLOPT_MAXREDIRS      => 3,
            \CURLOPT_TIMEOUT        => $this->uploadTimeout,
            \CURLOPT_HTTPHEADER     => $this->headers(),
            \CURLOPT_SSL_VERIFYPEER => $this->verifySsl,
        ]);

        $ok       = \curl_exec($ch);
        $status   = (int) \curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        $curlErr  = \curl_error($ch);
        \curl_close($ch);
        \fclose($handle);

        if ($ok === false || $status >= 400) {
            @\unlink($destination);
            throw new SccBuilderException(
                'download_failed',
                $curlErr !== '' ? $curlErr : "O servidor respondeu HTTP {$status} ao baixar o arquivo.",
                $status
            );
        }

        return (int) \filesize($destination);
    }

    // ── Transporte ───────────────────────────────────────────────────────

    /**
     * @param array<string,mixed>|string|null $fields string = corpo JSON
     * @return array<string,mixed> conteúdo de "data"
     */
    private function request(string $method, string $path, array|string|null $fields = null, ?int $timeout = null): array
    {
        $url     = $this->apiUrl . $path;
        $timeout ??= $this->timeout;
        $attempt = 0;

        while (true) {
            $attempt++;

            $ch = \curl_init($url);
            $opts = [
                \CURLOPT_RETURNTRANSFER => true,
                \CURLOPT_TIMEOUT        => $timeout,
                \CURLOPT_CONNECTTIMEOUT => 10,
                \CURLOPT_HTTPHEADER     => \is_string($fields)
                    ? \array_merge($this->headers(), ['Content-Type: application/json'])
                    : $this->headers(),
                \CURLOPT_SSL_VERIFYPEER => $this->verifySsl,
                \CURLOPT_CUSTOMREQUEST  => $method,
            ];

            if ($fields !== null) {
                $opts[\CURLOPT_POST]       = $method === 'POST';
                $opts[\CURLOPT_POSTFIELDS] = $fields;
            }

            \curl_setopt_array($ch, $opts);

            $body     = \curl_exec($ch);
            $status   = (int) \curl_getinfo($ch, \CURLINFO_HTTP_CODE);
            $curlErr  = \curl_error($ch);
            \curl_close($ch);

            // Falha de rede ou erro do servidor: vale a pena tentar de novo.
            $transient = $body === false || $status === 429 || $status >= 500;

            if ($transient && $attempt <= $this->maxRetries) {
                $wait = 2 ** $attempt;
                $this->log('Falha transitória — nova tentativa', [
                    'tentativa' => $attempt,
                    'aguardar'  => $wait,
                    'status'    => $status,
                ]);
                \sleep($wait);
                continue;
            }

            if ($body === false) {
                throw new SccBuilderException(
                    'network_error',
                    "Falha de conexão com {$url}: {$curlErr}"
                );
            }

            /** @var array<string,mixed>|null $payload */
            $payload = \json_decode((string) $body, true);

            if (!\is_array($payload)) {
                throw new SccBuilderException(
                    'invalid_response',
                    "Resposta não-JSON da API (HTTP {$status}): " . \substr((string) $body, 0, 300),
                    $status
                );
            }

            if ($status >= 400 || ($payload['status'] ?? '') === 'error') {
                $error = $payload['error'] ?? [];
                throw new SccBuilderException(
                    (string) ($error['code'] ?? 'http_error'),
                    (string) ($error['message'] ?? "HTTP {$status}"),
                    $status,
                    (array) ($error['details'] ?? [])
                );
            }

            return (array) ($payload['data'] ?? []);
        }
    }

    /** @return string[] */
    private function headers(): array
    {
        $headers = ['Accept: application/json'];

        if ($this->token !== '') {
            $headers[] = 'Authorization: Bearer ' . $this->token;
        } elseif ($this->apiKey !== '') {
            $headers[] = 'X-API-Key: ' . $this->apiKey;
            if ($this->accountId !== '') {
                $headers[] = 'X-Account-Id: ' . $this->accountId;
            }
        }

        return $headers;
    }

    /** @param array<string,mixed> $context */
    private function log(string $message, array $context = []): void
    {
        if ($this->logger !== null) {
            ($this->logger)($message, $context);
        }
    }
}

/**
 * Exceção do SDK, com código estável para tratamento programático.
 */
class SccBuilderException extends \RuntimeException
{
    /** @param array<string,mixed> $details */
    public function __construct(
        private readonly string $errorCode,
        string $message,
        private readonly int $statusCode = 0,
        private readonly array $details = []
    ) {
        parent::__construct($message);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    /** @return array<string,mixed> */
    public function getDetails(): array
    {
        return $this->details;
    }

    /** Mensagem pronta para exibir ao usuário final. */
    public function getUserMessage(): string
    {
        return match ($this->errorCode) {
            'missing_api_key', 'invalid_api_key' =>
                'Chave de API do SCC Builder ausente ou inválida. Verifique a configuração.',
            'not_configured' =>
                'O servidor SCC Builder ainda não foi configurado (api/config.local.php).',
            'network_error' =>
                'Não foi possível conectar ao servidor SCC Builder. Verifique se ele está no ar.',
            'rate_limited' =>
                'Muitas requisições em pouco tempo. Aguarde alguns segundos e tente novamente.',
            'file_too_large' =>
                'O arquivo excede o tamanho máximo permitido pelo servidor.',
            'unsupported_format', 'content_mismatch' =>
                'Formato de arquivo não suportado ou arquivo corrompido.',
            'external_converter_missing' =>
                'O servidor não tem o conversor de FBX/DAE instalado. Exporte como OBJ ou GLB.',
            'timeout' =>
                'A conversão demorou mais que o esperado. Tente novamente ou use um arquivo menor.',
            default => $this->getMessage(),
        };
    }
}
