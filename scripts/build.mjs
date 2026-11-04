// Build: CSV -> src/data.generated.js -> bundle IIFE (esbuild) -> HTML autocontenido.
// Salidas:
//   dist/index.html     página completa (abrir con doble clic, sin servidor)
//   dist/artifact.html  mismo contenido sin <html>/<head>/<body> (para publicar como artifact)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const r = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const raw = {
  colaboradores: r('data/colaboradores.csv'),
  hitos: r('data/hitos_onboarding.csv'),
  usuarios: r('data/usuarios_roles.csv'),
  catalogo: r('data/catalogo_hitos.csv'),
};
writeFileSync(new URL('../src/data.generated.js', import.meta.url), `// Archivo generado. No editar: cambia /data/*.csv y corre npm run build.\nexport default ${JSON.stringify(raw)};\n`);

const res = await build({ entryPoints: [new URL('../src/main.js', import.meta.url).pathname], bundle: true, format: 'iife', minify: false, write: false, target: 'es2020' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = r('src/styles.css');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=JetBrains+Mono:wght@400;600&display=swap">';
const head = `<title>Sprint Onboarding Seguro</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>${css}</style>`;
const bodyHtml = `<div id="app"></div>\n<script>${js}</script>`;

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/artifact.html', import.meta.url), `${head}\n${bodyHtml}\n`);
writeFileSync(new URL('../dist/index.html', import.meta.url), `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}</head>\n<body>${bodyHtml}</body></html>\n`);
console.log('dist/index.html y dist/artifact.html listos');
