import { AppError, forwardRequestId } from '@scc/shared';

import type { BuilderClient, BuilderValidateInput, BuilderValidation } from '../domain/buildings.js';

/**
 * `POST /api/validate-lot.php` do SCC Builder (tools/scc-builder). O token é o
 * do próprio jogador: o Builder aceita o JWT do gateway e só valida jobs dele.
 */
export class HttpBuilderClient implements BuilderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async validate(input: BuilderValidateInput, authorization: string, requestId?: string): Promise<BuilderValidation> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/api/validate-lot.php`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization, ...forwardRequestId(requestId) },
        body: JSON.stringify({ job_id: input.jobId, lot: input.lot, transform: input.transform }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new AppError('builder_unavailable', 'O SCC Builder não respondeu.', 503);
    }
    const body = (await response.json().catch(() => null)) as
      | { data?: BuilderValidation; error?: { code?: string; message?: string } }
      | null;
    if (response.ok && body?.data) return body.data;

    // Erros do Builder que o jogador pode resolver passam adiante com o mesmo código.
    const code = body?.error?.code ?? 'builder_error';
    if (response.status === 404) throw new AppError('model_not_found', 'Modelo não encontrado no SCC Builder.', 404);
    if (response.status === 401 || response.status === 403) {
      throw new AppError('builder_forbidden', 'O SCC Builder recusou o token.', 403);
    }
    if (response.status === 409 || response.status === 400) {
      throw new AppError(code, body?.error?.message ?? 'O SCC Builder recusou o modelo.', 409);
    }
    throw new AppError('builder_unavailable', 'O SCC Builder falhou ao validar.', 503);
  }
}
