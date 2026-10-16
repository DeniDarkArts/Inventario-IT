// Equipos libres ahora, tras preparación y próximamente
(async () => {
  await nav();
  const $ = (s) => document.querySelector(s);
  const [tipos, uns] = await Promise.all([API.get('/catalogos/tipos'), API.get('/catalogos/unidades')]);
  tipos.items.forEach((t) => $('#tipo').add(new Option(t.nombre, t.nombre)));
  uns.items.forEach((x) => $('#un').add(new Option(nombreBU(x), x.codigo)));

  const TITULOS = {
    libre: 'Libres ahora',
    libre_tras_preparacion: 'Libres tras preparación (revisión o master)',
    libre_proximamente: 'Quedarán libres próximamente',
  };

  async function cargar() {
    const p = new URLSearchParams();
    if ($('#tipo').value) p.set('tipo', $('#tipo').value);
    if ($('#un').value) p.set('bu', $('#un').value);
    if ($('#ram').value) p.set('ram_min', $('#ram').value);
    const r = await API.get(`/disponibilidad?${p}`);
    const MOTIVO = { baja: 'Baja en ING039', fin_previsto: 'Fin previsto' };
    $('#grupos').innerHTML = Object.entries(TITULOS).map(([k, titulo]) => {
      const prox = k === 'libre_proximamente';
      const cols = prox ? ['Asignado a', 'Motivo', 'Libre desde'] : ['Ubicación'];
      return `
      <h2>${titulo} <span class="muted">(${r[k].length})</span></h2>
      <div class="table-wrap"><table data-grupo="${k}">
        <thead><tr><th>Código</th><th>Tipo</th><th>Modelo</th><th>Estado</th><th>BU</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${r[k].map((e) => `
          <tr data-href="/equipo.html?id=${e.id}">
            <td><strong>${esc(e.codigo_interno)}</strong></td><td>${esc(e.tipo)}</td>
            <td>${esc([e.marca, e.modelo].filter(Boolean).join(' '))}</td><td>${badge(e.estado)}</td>
            <td>${esc(e.unidades || '—')}</td>
            ${prox
              ? `<td>${esc(e.asignado_a || '—')}</td><td>${esc(MOTIVO[e.motivo] || '—')}</td><td>${esc(e.libre_desde || '—')}</td>`
              : `<td>${esc(textoUbicacion(e) || '—')}</td>`}
          </tr>`).join('') || `<tr><td colspan="${5 + cols.length}" class="muted">Ninguno</td></tr>`}</tbody>
      </table></div>`;
    }).join('');
    $('#grupos').querySelectorAll('table[data-grupo]').forEach((t) => tablaInteractiva(t, { clave: `disponibilidad-${t.dataset.grupo}` }));
  }
  $('#grupos').onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.href = tr.dataset.href; };
  ['#tipo', '#un', '#ram'].forEach((s) => ($(s).onchange = cargar));
  cargar();
})();
