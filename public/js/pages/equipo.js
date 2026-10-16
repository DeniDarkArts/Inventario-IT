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
          <dt>Asignado a</dt><dd>${esc(textoAsignado(eq))}</dd>
          <dt>Proyecto</dt><dd>${esc(eq.proyecto_codigo ? `${eq.proyecto_codigo} · ${eq.proyecto}` : '—')}</dd>
          <dt>Ubicación</dt><dd>${esc(textoUbicacion(eq) || '—')}</dd>
          <dt>BU</dt><dd>${uns}</dd>
          <dt>Nº de serie</dt><dd>${esc(eq.num_serie || '—')}</dd>
          <dt>Hostname</dt><dd>${esc(eq.hostname || '—')}</dd>
          <dt>Masterización</dt><dd>${m ? `${esc(m.tipo)} · ${esc(m.dominio || '')} (${esc(m.fecha_completada?.slice(0, 10))})` : '—'}</dd>
          <dt>Garantía hasta</dt><dd>${esc(eq.garantia_hasta || '—')}</dd>
          ${eq.orden_compra ? `<dt>Orden de compra</dt><dd>${esc(eq.orden_compra)}</dd>` : ''}
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
    if (!filas.length) { $('#historial').textContent = 'Sin movimientos'; return; }
    $('#historial').classList.remove('muted');
    $('#historial').innerHTML = `<div class="table-wrap"><table><thead><tr><th style="width:130px">Fecha</th><th>Evento</th></tr></thead>
      <tbody>${filas.map(([f, t]) => `<tr><td>${esc(f)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table></div>`;
    tablaInteractiva($('#historial table'), { clave: 'historial' }).actualizar();
  }

  const recargar = () => (location.href = `/equipo.html?id=${eq.id}`);

  // ---- Asignar ----
  const firmaAsig = Firma($('#a-firma'));
  $('#a-borrar').onclick = () => firmaAsig.borrar();
  // Personas: se buscan en ING039 al escribir (no hay lista completa en el inventario)
  let personasEncontradas = new Map();
  let tBuscar;
  async function buscarPersonas() {
    const q = $('#a-buscar').value.trim();
    if (q.length < 2) { $('#a-empleado').innerHTML = ''; $('#a-persona-info').textContent = ''; return; }
    const { items } = await API.get(`/personas?q=${encodeURIComponent(q)}&limit=30`);
    personasEncontradas = new Map(items.map((x) => [String(x.id), x]));
    $('#a-empleado').innerHTML = items.map((x) => `<option value="${x.id}">${esc(x.apellidos)}, ${esc(x.nombre)} · ${esc(x.bu || 'sin BU')}${x.num_equipos ? ` · ${x.num_equipos} equipo(s)` : ''}</option>`).join('');
    $('#a-persona-info').textContent = items.length ? (items.length === 30 ? 'Se muestran 30: afina la búsqueda' : '') : 'Sin resultados';
    if (items.length === 1) { $('#a-empleado').value = String(items[0].id); elegirPersona(); }
  }
  /** Al elegir persona: se propone su oficina (Site de ING039) si el equipo no tiene sitio. */
  function elegirPersona() {
    const x = personasEncontradas.get($('#a-empleado').value); if (!x) return;
    $('#a-persona-info').textContent = [x.email, x.resid && `nº ${x.resid}`, x.oficina].filter(Boolean).join(' · ');
    if (x.oficina && !$('#a-ubicacion').dataset.tocado) {
      $('#a-ubicacion').value = `o:${x.oficina}`;
      $('#a-edificio').value = ''; $('#a-puesto').value = '';
    }
  }
  async function abrirAsignar() {
    const [proys, ubis, ofis] = await Promise.all([
      API.get('/catalogos/proyectos'), API.get('/catalogos/ubicaciones'), API.get('/catalogos/oficinas')]);
    $('#a-proyecto').innerHTML = '<option value="">—</option>' + proys.items.filter((p) => p.activo).map((p) => `<option value="${p.id}">${esc(p.codigo)} · ${esc(p.nombre)}</option>`).join('');
    $('#a-ubicacion').innerHTML = opcionesUbicacion(ubis.items, ofis.items);
    // Al abrir: el sitio actual del equipo; al elegir persona se propone su oficina
    $('#a-ubicacion').value = valorUbicacion(eq);
    delete $('#a-ubicacion').dataset.tocado;
    $('#a-ubicacion').onchange = () => { $('#a-ubicacion').dataset.tocado = '1'; };
    $('#a-edificio').value = eq.edificio || ''; $('#a-puesto').value = eq.puesto || '';
    $('#a-buscar').value = ''; $('#a-empleado').innerHTML = ''; $('#a-persona-info').textContent = '';
    $('#a-buscar').oninput = () => { clearTimeout(tBuscar); tBuscar = setTimeout(() => buscarPersonas().catch((e) => toast(e.message, 'error')), 250); };
    $('#a-empleado').onchange = elegirPersona;
    $('#a-tipo').onchange = () => { $('#a-empleado').required = $('#a-tipo').value !== 'puesto'; };
    $('#dlg-asignar').showModal();
    firmaAsig.ajustar();
    $('#a-buscar').focus();
  }
  $('#f-asignar').onsubmit = async (e) => {
    e.preventDefault();
    const tipo = $('#a-tipo').value;
    try {
      const r = await API.post('/asignaciones', {
        equipo_id: eq.id, tipo,
        empleado_id: tipo === 'puesto' ? null : Number($('#a-empleado').value),
        proyecto_id: Number($('#a-proyecto').value) || null,
        ...leerUbicacion($('#a-ubicacion').value),
        edificio: $('#a-edificio').value.trim() || null, puesto: $('#a-puesto').value.trim() || null,
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
    const [tipos, modelos, uns, codigos, ubis, ofis] = await Promise.all([API.get('/catalogos/tipos'), API.get('/catalogos/modelos'),
      API.get('/catalogos/unidades'), API.get('/catalogos/codigos'), API.get('/catalogos/ubicaciones'), API.get('/catalogos/oficinas')]);
    $('#n-ubicacion').innerHTML = opcionesUbicacion(ubis.items, ofis.items, ['oficina', 'cliente', 'almacen']);
    $('#n-qr').textContent = codigo;
    $('#n-tipo').innerHTML = tipos.items.filter((t) => t.lleva_qr).map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('');
    const filtrarModelos = () => {
      $('#n-modelo').innerHTML = '<option value="">—</option>' + modelos.items.filter((m) => String(m.tipo_id) === $('#n-tipo').value)
        .map((m) => `<option value="${m.id}">${esc(m.marca)} ${esc(m.modelo)}</option>`).join('');
    };
    $('#n-tipo').onchange = filtrarModelos; filtrarModelos();
    $('#n-un').innerHTML = uns.items.map((x) => `<option value="${esc(x.codigo)}">${esc(nombreBU(x))}</option>`).join('');
    if (u.bu && uns.items.some((x) => x.codigo === u.bu)) $('#n-un').value = u.bu;  // por defecto, la BU de quien da de alta
    $('#b-alta').onclick = () => $('#dlg-alta').showModal();

    // Lectura opcional de la etiqueta del fabricante
    $('#n-leer-serie').onclick = async () => {
      const r = await LectorEtiquetas.abrir('serie');
      if (r?.serie) $('#n-serie').value = r.serie;
    };
    $('#n-leer-modelo').onclick = async () => {
      const r = await LectorEtiquetas.abrir('modelo');
      if (!r) return;
      if (r.serie && !$('#n-serie').value) $('#n-serie').value = r.serie;
      if (r.producto) $('#n-producto').value = r.producto;
      const props = LectorEtiquetas.proponerModelos(r, modelos.items, codigos.items);
      const aviso = $('#n-modelo-leido'); aviso.hidden = false;
      if (props.length) {
        const m = props[0].modelo;
        if (String(m.tipo_id) !== $('#n-tipo').value) { $('#n-tipo').value = m.tipo_id; filtrarModelos(); }
        $('#n-modelo').value = m.id;
        aviso.textContent = `Modelo propuesto: ${m.marca} ${m.modelo}. Compruébalo antes de dar de alta.`;
        return;
      }
      // No está en el catálogo: se muestra la línea más probable y el admin puede crearlo
      const linea = r.lineas.filter((l) => !/(S\/?N|SERIAL|PROD|P\/N)/i.test(l)).sort((a, b) => b.length - a.length)[0] || '';
      aviso.innerHTML = `Leído: <strong>${esc(linea || '(sin texto)')}</strong>. No coincide con ningún modelo del catálogo.`
        + (tieneRol(u, 'admin_it') && linea ? ' <button type="button" class="link" id="n-crear-modelo">Crear este modelo</button>' : '');
      const crear = $('#n-crear-modelo');
      if (crear) crear.onclick = async () => {
        const texto = prompt('Marca y modelo (la primera palabra es la marca):', linea.replace(/\s+/g, ' ').trim());
        if (!texto?.trim()) return;
        const [marca, ...resto] = texto.trim().split(' ');
        try {
          const nuevo = { tipo_id: Number($('#n-tipo').value), marca, modelo: resto.join(' ') || marca };
          const { id } = await API.post('/catalogos/modelos', nuevo);
          modelos.items.push({ id, ...nuevo });
          filtrarModelos(); $('#n-modelo').value = id;
          aviso.textContent = `Modelo creado: ${nuevo.marca} ${nuevo.modelo}.`;
        } catch (err) { toast(err.message, 'error'); }
      };
    };
    $('#f-alta').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await API.post('/equipos', {
          codigo_qr: codigo, tipo_id: Number($('#n-tipo').value), modelo_id: Number($('#n-modelo').value) || null,
          num_serie: $('#n-serie').value.trim() || null, codigo_producto: $('#n-producto').value.trim() || null, fecha_compra: $('#n-compra').value || null,
          garantia_hasta: $('#n-garantia').value || null, proveedor: $('#n-proveedor').value || null,
          orden_compra: $('#n-orden').value.trim() || null, ...leerUbicacion($('#n-ubicacion').value),
          edificio: $('#n-edificio').value.trim() || null, puesto: $('#n-puesto').value.trim() || null,
          unidades: [{ bu: $('#n-un').value, principal: true }],
        });
        location.href = `/equipo.html?id=${r.id}`;
      } catch (err) { toast(err.message, 'error'); }
    };
  }
})();
