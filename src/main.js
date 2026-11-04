import { parseCSV } from './csv.js';
import { crearStore } from './store.js';
import { mount } from './ui.js';
import RAW from './data.generated.js'; // generado por scripts/build.mjs desde /data/*.csv

const base = {
  colaboradores: parseCSV(RAW.colaboradores),
  hitos: parseCSV(RAW.hitos),
  usuarios: parseCSV(RAW.usuarios),
  catalogo: parseCSV(RAW.catalogo),
};
mount(document.getElementById('app'), crearStore(base));
