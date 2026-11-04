import { parseCSV } from './csv.js';
import { crearStore } from './store.js';
import { mount } from './ui.js';
import RAW from './data.generated.js'; // generado por scripts/build.mjs desde /data/*.csv

const app = document.getElementById('app');
try {
  const base = {
    colaboradores: parseCSV(RAW.colaboradores),
    hitos: parseCSV(RAW.hitos),
    usuarios: parseCSV(RAW.usuarios),
    catalogo: parseCSV(RAW.catalogo),
  };
  mount(app, crearStore(base));
} catch (err) {
  console.error(err);
  app.innerHTML = '<main class="wrap"><section class="card"><h1>No se pudo iniciar Sprint</h1><p>Los datos de base no se pudieron leer. Vuelve a generar la página con <code>npm run build</code>.</p></section></main>';
}
