// Ficha de equipo: se abre por ?id= o por ?qr= (tras escanear). Muestra acciones según rol.
(async () => {
  const u = await nav();
  const it = esIT(u);
  const params = new URLSearchParams(location.search);
  const cont = document.querySelector('#contenido');
  const $ = (s) => document.querySelector(s);

  // Cerrar diálogos
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

  let eq;
  try {
    eq = params.get('id') ? await API.get(`/equipos/${params.get('id')}`)
                          : await API.get(`/equipos/qr/${encodeURIComponent(params.get('qr') || '')}`);
  } catch (err) {
    if (err.status === 404 && err.data?.puede_dar_alta) return alta(err.data.codigo);
    cont.innerHTML = `<div class="card"><h1>${esc(err.message)}</h1>
      ${err.data?.codigo ? `<p>Código: <strong>${esc(err.data.codigo)}</strong></p>` : ''}
      <a class="btn" href="/escanear.html">Escanear otro</a></div>`;
    return;
  }
  pintar();

  function pintar() {
    const uns = eq.unidades.map((x) => `${esc(x.codigo)}${x.principal ? ' (principal)' : ''}`).join(', ') || '—';
    const m = eq.master_actual;
    const acciones = [];
    if (it && ['en_stock', 'reservado', 'pendiente_master'].includes(eq.estado) && !eq.incidencias_abiertas.length) acciones.push('<button class="primary" id="b-asignar">Asignar</button>');
    if (it && eq.asignacion_id) acciones.push('<button id="b-devolver">Devolver</button>');
    if (it && eq.estado === 'en_revision') acciones.push('<button id="b-stock">Revisado: a stock</button>');
    if (it && ['en_stock', 'en_revision'].includes(eq.estado)) acciones.push('<button id="b-master">Solicitar master</button>');
    acciones.push('<button class="danger" id="b-incidencia">Reportar incidencia</button>');

    cont.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap">
          <div><h1 style="margin:0">${esc(eq.codigo_interno)}</h1>
            <div class="muted">${esc(eq.tipo)} · ${esc([eq.marca, eq.modelo].filter(Boolean).join(' ') || 'sin modelo')}</div></div>
          ${badge(eq.estado)}
        </div>
        <dl class="kv" style="margin-top:16px">
          <dt>Asignado a</dt><dd>${esc(eq.asignado_a || '—')}</dd>
          <dt>Proyecto</dt><dd>${esc(eq.proyecto_codigo ? `${eq.proyecto_codigo} · ${eq.proyecto}` : '—')}</dd>
          <dt>Ubicación</dt><dd>${esc(eq.ubicacion || '—')}</dd>
          <dt>Unidades de negocio</dt><dd>${uns}</dd>
          <dt>Nº de serie</dt><dd>${esc(eq.num_serie || '—')}</dd>
          <dt>Hostname</dt><dd>${esc(eq.hostname || '—')}</dd>
          <dt>Masterización</dt><dd>${m ? `${esc(m.tipo)} · ${esc(m.dominio || '')} (${esc(m.fecha_completada?.slice(0, 10))})` : '—'}</dd>
          <dt>Garantía hasta</dt><dd>${esc(eq.garantia_hasta || '—')}</dd>
          ${eq.accesorios.length ? `<dt>Accesorios</dt><dd>${eq.accesorios.map((a) => `${esc(a.tipo)} ${esc(a.codigo_interno)}`).join(', ')}</dd>` : ''}
        </dl>
        ${eq.incidencias_abiertas.length ? `<p style="color:var(--bad)">${eq.incidencias_abiertas.length} incidencia(s) abierta(s)</p>` : ''}
        <div class="actions">${acciones.join('')}</div>
      </div>
      ${it ? '<h2>Historial</h2><div id="historial" class="muted">Cargando…</div>' : ''}`;

    $('#b-incidencia').onclick = () => $('#dlg-incidencia').showModal();
    $('#b-asignar')?.addEventListener('click', abrirAsignar);
    $('#b-devolver')?.addEventListener('click', () => { $('#dlg-devolver').showModal(); firmaDev.ajustar(); });
    $('#b-stock')?.addEventListener('click', async () => {
      await API.post(`/equipos/${eq.id}/estado`, { estado: 'en_stock', motivo: 'Revisado' });
      toast('Equipo en stock'); recargar();
    });
    $('#b-master')?.addEventListener('click', async () => {
      const tipo = confirm('¿Masterización en el dominio de un cliente?\nAceptar = cliente · Cancelar = interna') ? 'cliente' : 'interna';
      await API.post('/masterizaciones', { equipo_id: eq.id, tipo });
      toast('Masterización solicitada'); recargar();
    });
    if (it) historial();
  }

  async function historial() {
    const h = await API.get(`/equipos/${eq.id}/historial`);
    const filas = [
      ...h.asignaciones.map((a) => [a.fecha_inicio, `Asignado a ${a.empleado || 'puesto'}${a.proyecto ? ` (${a.proyecto})` : ''}${a.fecha_devolucion ? ` · devuelto ${a.fecha_devolucion}` : ''}`]),
      ...h.masterizaciones.map((m) => [m.fecha_solicitud?.slice(0, 10), `Master ${m.tipo} · ${m.estado}${m.dominio ? ` · ${m.dominio}` : ''}`]),
      ...h.incidencias.map((i) => [i.fecha_apertura?.slice(0, 10), `Incidencia ${i.categoria} · ${i.estado}`]),
    ].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    $('#historial').innerHTML = filas.length
      ? `<table><tbody>${filas.map(([f, t]) => `<tr><td style="width:120px">${esc(f)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>`
      : 'Sin movimientos';
  }

  const recargar = () => (location.href = `/equipo.html?id=${eq.id}`);

  // ---- Asignar ----
  const firmaAsig = Firma($('#a-firma'));
  $('#a-borrar').onclick = () => firmaAsig.borrar();
  async function abrirAsignar() {
    const [emps, proys, ubis] = await Promise.all([
      API.get('/empleados?limit=200'), API.get('/catalogos/proyectos'), API.get('/catalogos/ubicaciones')]);
    $('#a-empleado').innerHTML = emps.items.filter((e) => e.estado !== 'baja')
      .map((e) => `<option value="${e.id}" data-proy="${e.proyecto_actual_id || ''}" data-ubic="${e.ubicacion_id || ''}">${esc(e.apellidos)}, ${esc(e.nombre)} · ${esc(e.un)}</option>`).join('');
    $('#a-proyecto').innerHTML = '<option value="">—</option>' + proys.items.filter((p) => p.activo).map((p) => `<option value="${p.id}">${esc(p.codigo)} · ${esc(p.nombre)}</option>`).join('');
    $('#a-ubicacion').innerHTML = '<option value="">—</option>' + ubis.items.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('');
    const sync = () => { const o = $('#a-empleado').selectedOptions[0]; if (o) { $('#a-proyecto').value = o.dataset.proy; $('#a-ubicacion').value = o.dataset.ubic; } };
    $('#a-empleado').onchange = sync; sync();
    $('#dlg-asignar').showModal();
    firmaAsig.ajustar();
  }
  $('#f-asignar').onsubmit = async (e) => {
    e.preventDefault();
    const tipo = $('#a-tipo').value;
    try {
      const r = await API.post('/asignaciones', {
        equipo_id: eq.id, tipo,
        empleado_id: tipo === 'puesto' ? null : Number($('#a-empleado').value),
        proyecto_id: Number($('#a-proyecto').value) || null,
        ubicacion_id: Number($('#a-ubicacion').value) || null,
        fecha_fin_prevista: $('#a-fin').value || null,
        firma: firmaAsig.valor(),
      });
      toast(r.avisos?.length ? `Asignado. Aviso: ${r.avisos.join('; ')}` : 'Equipo asignado');
      setTimeout(recargar, 800);
    } catch (err) { toast(err.message, 'error'); }
  };

  // ---- Devolver ----
  const firmaDev = Firma($('#d-firma'));
  $('#f-devolver').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await API.post(`/asignaciones/${eq.asignacion_id}/devolver`, {
        estado_devolucion: $('#d-estado').value, notas: $('#d-notas').value, firma: firmaDev.valor() });
      toast('Devolución registrada'); setTimeout(recargar, 800);
    } catch (err) { toast(err.message, 'error'); }
  };

  // ---- Incidencia ----
  $('#f-incidencia').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('equipo_id', eq.id);
    fd.append('categoria', $('#i-categoria').value);
    fd.append('descripcion', $('#i-desc').value);
    [...$('#i-fotos').files].slice(0, 5).forEach((f) => fd.append('fotos', f));
    try {
      await API.post('/incidencias', fd);
      $('#dlg-incidencia').close(); toast('Incidencia enviada a IT');
      setTimeout(recargar, 800);
    } catch (err) { toast(err.message, 'error'); }
  };

  // ---- Alta de equipo nuevo (QR desconocido) ----
  async function alta(codigo) {
    cont.innerHTML = `<div class="card"><h1>Equipo nuevo</h1><p>El código <strong>${esc(codigo)}</strong> no está registrado.</p>
      <div class="actions"><button class="primary" id="b-alta">Dar de alta</button><a class="btn" href="/escanear.html">Escanear otro</a></div></div>`;
    const [tipos, modelos, uns] = await Promise.all([API.get('/catalogos/tipos'), API.get('/catalogos/modelos'), API.get('/catalogos/unidades')]);
    $('#n-qr').textContent = codigo;
    $('#n-tipo').innerHTML = tipos.items.filter((t) => t.lleva_qr).map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('');
    const filtrarModelos = () => {
      $('#n-modelo').innerHTML = '<option value="">—</option>' + modelos.items.filter((m) => String(m.tipo_id) === $('#n-tipo').value)
        .map((m) => `<option value="${m.id}">${esc(m.marca)} ${esc(m.modelo)}</option>`).join('');
    };
    $('#n-tipo').onchange = filtrarModelos; filtrarModelos();
    $('#n-un').innerHTML = uns.items.map((x) => `<option value="${x.id}">${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join('');
    $('#b-alta').onclick = () => $('#dlg-alta').showModal();
    $('#f-alta').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await API.post('/equipos', {
          codigo_qr: codigo, tipo_id: Number($('#n-tipo').value), modelo_id: Number($('#n-modelo').value) || null,
          num_serie: $('#n-serie').value || null, fecha_compra: $('#n-compra').value || null,
          garantia_hasta: $('#n-garantia').value || null, proveedor: $('#n-proveedor').value || null,
          unidades: [{ un_id: Number($('#n-un').value), principal: true }],
        });
        location.href = `/equipo.html?id=${r.id}`;
      } catch (err) { toast(err.message, 'error'); }
    };
  }
})();
