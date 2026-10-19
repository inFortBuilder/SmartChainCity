/**
 * Erros com código estável, consumidos pelo ConversionRunner do PHP.
 */
export class ConversionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Dependência npm ausente — mensagem acionável em vez de stack trace.
 * @param {string} pkg
 * @param {string} purpose
 */
export function missingDependency(pkg, purpose) {
  return new ConversionError(
    'missing_dependency',
    `O pacote "${pkg}" é necessário para ${purpose}, mas não está instalado. ` +
      `Execute: npm install ${pkg}`,
    { package: pkg }
  );
}

/**
 * Importa um módulo opcional, convertendo a falha em erro acionável.
 * @param {string} specifier
 * @param {string} purpose
 */
export async function importOptional(specifier, purpose) {
  try {
    return await import(specifier);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND')
    ) {
      throw missingDependency(specifier, purpose);
    }
    throw error;
  }
}
