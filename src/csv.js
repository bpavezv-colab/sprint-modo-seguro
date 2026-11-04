// Parser CSV mínimo (RFC 4180): comillas, comas y saltos de línea dentro de comillas.
// Celdas vacías se devuelven como null: según el diccionario, un vacío es "dato faltante",
// nunca '', 0, 'No', 'Pendiente' ni 'No iniciado'.

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(c => c.trim() !== ''));
  if (!clean.length) return [];
  const header = clean[0].map(h => h.trim());
  return clean.slice(1).map(r => {
    const o = {};
    header.forEach((h, j) => {
      const v = (r[j] ?? '').trim();
      o[h] = v === '' ? null : v;
    });
    return o;
  });
}

export function toCSV(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const q = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n') + '\n';
}
