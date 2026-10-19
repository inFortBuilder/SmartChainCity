import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E (item 41 da auditoria).
 *
 * Rodam contra o build de produção, não contra o dev server: é o artefato
 * que o usuário realmente recebe, com code-splitting e worker empacotados.
 *
 * Primeiro uso:
 *   npx playwright install chromium
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173/scc-builder/',
    // Os specs conferem textos em português; sem isto o editor seguiria o
    // idioma do navegador de teste (src/i18n).
    locale: 'pt-BR',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // WebGL em headless exige o SwiftShader; sem isso o viewer não sobe.
        launchOptions: {
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
        },
      },
    },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/scc-builder/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
