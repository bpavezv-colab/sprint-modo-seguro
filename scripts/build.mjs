// Build: CSV -> src/data.generated.js -> bundle IIFE (esbuild) -> HTML autocontenido.
// Salidas:
//   dist/index.html     página completa (abrir con doble clic, sin servidor)
//   dist/artifact.html  mismo contenido sin <html>/<head>/<body> (para publicar como artifact)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../src/csv.js';
import { validarCampos } from '../src/privacy.js';

const r = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const raw = {
  colaboradores: r('data/colaboradores.csv'),
  hitos: r('data/hitos_onboarding.csv'),
  usuarios: r('data/usuarios_roles.csv'),
  catalogo: r('data/catalogo_hitos.csv'),
};
if (!validarCampos(Object.fromEntries(Object.entries(raw).map(([k, csv]) => [k, parseCSV(csv)])))) {
  throw new Error('Build rechazado: los CSV deben usar únicamente los campos del kit sintético.');
}
writeFileSync(new URL('../src/data.generated.js', import.meta.url), `// Archivo generado. No editar: cambia /data/*.csv y corre npm run build.\nexport default ${JSON.stringify(raw)};\n`);

const res = await build({ entryPoints: [fileURLToPath(new URL('../src/main.js', import.meta.url))], bundle: true, format: 'iife', minify: false, write: false, target: 'es2020' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = r('src/styles.css');
// Sin fuentes, analítica ni conexiones externas. El HTML funciona offline.
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
const head = `${csp}\n<title>Sprint Onboarding Seguro</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>${css}</style>`;
const bodyHtml = `<div id="app"></div>\n<script>${js}</script>`;

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/artifact.html', import.meta.url), `${head}\n${bodyHtml}\n`);
writeFileSync(new URL('../dist/index.html', import.meta.url), `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}</head>\n<body>${bodyHtml}</body></html>\n`);
console.log('dist/index.html y dist/artifact.html listos');
