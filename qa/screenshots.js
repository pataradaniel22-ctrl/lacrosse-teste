#!/usr/bin/env node
/**
 * Tira prints do app publicado (ou local), em celular e computador.
 *
 * Uso:
 *   node qa/screenshots.js [pasta_saida] [rota1 rota2 ...]
 *
 * Variáveis de ambiente:
 *   QA_SITE_URL        (padrão: https://lacrosse-teste-virid.vercel.app)
 *   QA_STAFF_EMAIL / QA_STAFF_PASSWORD      login da equipe (padrão: conta demo)
 *   QA_ATHLETE_EMAIL / QA_ATHLETE_PASSWORD  login de atleta (padrão: conta demo)
 *
 * Rotas que começam com /staff usam o login da equipe; /athlete usam o de atleta;
 * as demais são abertas sem login. Erros de console e de rede são gravados em
 * <pasta_saida>/report.json para o relatório de testes.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = (process.env.QA_SITE_URL || 'https://lacrosse-teste-virid.vercel.app').replace(/\/$/, '');
const CREDS = {
  staff: {
    email: process.env.QA_STAFF_EMAIL || 'cristina.velez@brasillacrosse.com',
    password: process.env.QA_STAFF_PASSWORD || '123456',
  },
  athlete: {
    email: process.env.QA_ATHLETE_EMAIL || 'lucas.silva@email.com',
    password: process.env.QA_ATHLETE_PASSWORD || 'demo123',
  },
};
const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

const outDir = process.argv[2] || 'qa-shots';
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ['/login', '/staff', '/athlete'];

function roleFor(route) {
  if (route.startsWith('/staff')) return 'staff';
  if (route.startsWith('/athlete')) return 'athlete';
  return null;
}

async function login(page, role) {
  const { email, password } = CREDS[role];
  await page.goto(`${SITE}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.fill('[data-testid="login-email-input"]', email);
  await page.fill('[data-testid="login-password-input"]', password);
  await page.click('[data-testid="login-submit-btn"]');
  // The free backend can take ~1 min to wake up.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120000 });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = { site: SITE, startedAt: new Date().toISOString(), shots: [], errors: [] };

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const contexts = {};
    for (const route of routes) {
      const role = roleFor(route);
      const key = role || 'public';
      if (!contexts[key]) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
        const page = await context.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error') report.errors.push({ viewport: vpName, route: page.url(), type: 'console', text: m.text() });
        });
        page.on('pageerror', (e) => report.errors.push({ viewport: vpName, route: page.url(), type: 'pageerror', text: String(e) }));
        page.on('response', (r) => {
          if (r.status() >= 500 || (r.status() >= 400 && r.url().includes('/api/'))) {
            report.errors.push({ viewport: vpName, route: page.url(), type: 'http', status: r.status(), url: r.url() });
          }
        });
        if (role) {
          try {
            await login(page, role);
          } catch (e) {
            report.errors.push({ viewport: vpName, route: '/login', type: 'login', role, text: String(e) });
          }
        }
        contexts[key] = page;
      }
      const page = contexts[key];
      const file = path.join(outDir, `${vpName}${route.replace(/[^a-z0-9]+/gi, '_')}.png`);
      try {
        await page.goto(`${SITE}${route}`, { waitUntil: 'networkidle', timeout: 120000 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: file, fullPage: true });
        report.shots.push({ viewport: vpName, route, file, finalUrl: page.url() });
      } catch (e) {
        report.errors.push({ viewport: vpName, route, type: 'navigation', text: String(e) });
      }
    }
  }

  await browser.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.shots.length} prints, ${report.errors.length} erros -> ${outDir}`);
})();
