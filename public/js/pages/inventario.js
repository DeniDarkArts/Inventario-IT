(async () => {
  const u = await nav();
  if (!veTodo(u)) { location.href = '/mis-equipos.html'; return; }

  // Filtros
  const estado = document.querySelector('#estado');
  Object.entries(ETIQUETA_ESTADO).forEach(([k, v]) => estado.add(new Option(v, k)));
  const [tipos, uns] = await Promise.all([API.get('/catalogos/tipos'), API.get('/catalogos/unidades')]);
  tipos.items.forEach((t) => document.querySelector('#tipo').add(new Option(t.nombre, t.id)));
  uns.items.forEach((x) => document.querySelector('#un').add(new Option(nombreBU(x), x.codigo)));

  // KPIs
  API.get('/dashboard/resumen').then((r) => {
    const d = r.disponibilidad, e = r.equipos_por_estado;
    const total = Object.values(e).reduce((a, b) => a + b, 0);
    const incid = Object.values(r.incidencias_abiertas).reduce((a, b) => a + b, 0);
    const k = [['Equipos', total], ['Libres ahora', d.libre || 0], ['Tras preparación', d.libre_tras_preparacion || 0],
      ['Asignados', e.asignado || 0], ['Incidencias abiertas', incid], ['Masters pendientes', r.masterizaciones_pendientes]];
    document.querySelector('#kpis').innerHTML = k.map(([t, n]) =>
      `<div class="card"><div class="muted">${t}</div><div class="kpi-n">${n}</div></div>`).join('');
  }).catch(() => {});

  const tabla = tablaInteractiva(document.querySelector('#filas').closest('table'), { clave: 'inventario' });
  let timer;
  async function cargar() {
    const p = new URLSearchParams();
    if (q.value) p.set('q', q.value);
    if (estado.value) p.set('estado', estado.value);
    if (tipo.value) p.set('tipo_id', tipo.value);
    if (un.value) p.set('bu', un.value);
    p.set('limit', 200);
    const r = await API.get(`/equipos?${p}`);
    document.querySelector('#filas').innerHTML = r.items.map((e) => `
      <tr data-href="/equipo.html?id=${e.id}">
        <td><strong>${esc(e.codigo_interno)}</strong></td><td>${esc(e.tipo)}</td>
        <td>${esc([e.marca, e.modelo].filter(Boolean).join(' '))}</td><td>${badge(e.estado)}</td>
        <td>${esc(textoAsignado(e))}</td><td class="hide-mobile">${esc(e.proyecto_codigo || '—')}</td>
        <td class="hide-mobile">${esc(textoUbicacion(e) || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Sin resultados</td></tr>';
    document.querySelector('#total').textContent = r.total > r.items.length
      ? `${r.total} equipos (se muestran ${r.items.length}; usa la búsqueda para acotar)` : `${r.total} equipos`;
    tabla.actualizar();
  }
  document.querySelector('#filas').onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.href = tr.dataset.href; };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(cargar, 250); };
  [estado, tipo, un].forEach((s) => (s.onchange = cargar));
  cargar();
})();
