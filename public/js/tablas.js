// Ordenación y filtros por columna, al estilo de Excel, para cualquier <table> con <thead>.
// Cada cabecera tiene un botón (flecha; embudo si hay filtro) que abre un panel con: ordenar A→Z / Z→A, buscar y marcar los valores a mostrar.
// Pulsar el texto de la cabecera también ordena.
// Uso: const t = tablaInteractiva(tabla, { clave: 'inventario' }); y tras pintar las filas, t.actualizar().
// Trabaja sobre las filas ya cargadas; la clave conserva filtros y orden si la tabla se vuelve a crear.
const _estadoTablas = new Map();
const _cmp = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const _norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const VACIAS = '(Vacías)';
const MAX_VALORES = 300;  // valores mostrados en la lista del panel (la búsqueda acota el resto)

const ICONO_FLECHA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONO_EMBUDO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" fill="currentColor"/></svg>';
let _panelAbierto = null;  // { panel, boton, cerrar }

function tablaInteractiva(tabla, { clave } = {}) {
  const ths = [...tabla.tHead.rows[0].cells];
  // filtros: índice de columna → Set de valores permitidos (sin entrada = sin filtro)
  const estado = (clave && _estadoTablas.get(clave)) || { col: null, dir: 1, filtros: {} };
  if (clave) _estadoTablas.set(clave, estado);
  for (const [i, v] of Object.entries(estado.filtros)) if (!(v instanceof Set)) delete estado.filtros[i];

  const filas = () => [...tabla.tBodies[0].rows].filter((tr) => !(tr.cells.length === 1 && tr.cells[0].colSpan > 1));
  const valor = (tr, i) => {
    const t = tr.cells[i]?.dataset.orden ?? tr.cells[i]?.textContent.trim() ?? '';
    return t === '' || t === '—' ? VACIAS : t;
  };

  // Cabeceras: texto que ordena + botón de filtro
  const botones = ths.map((th, i) => {
    const nombre = th.textContent.trim();
    th.classList.add('ordenable');
    th.innerHTML = `<span class="th-celda"><span class="th-texto" tabindex="0">${esc(nombre)}</span>`
      + `<button type="button" class="filtro-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Filtrar y ordenar ${esc(nombre)}">${ICONO_FLECHA}</button></span>`;
    const texto = th.querySelector('.th-texto');
    const ordenar = () => { estado.dir = estado.col === i ? -estado.dir : 1; estado.col = i; aplicar(); };
    texto.onclick = ordenar;
    texto.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ordenar(); } };
    const btn = th.querySelector('.filtro-btn');
    btn.onclick = (e) => { e.stopPropagation(); abrirPanel(i, nombre, btn); };
    return btn;
  });

  // Pie con el recuento
  const pie = document.createElement('p');
  pie.className = 'muted recuento-tabla';
  (tabla.closest('.table-wrap') || tabla).after(pie);

  /** Panel de filtro de la columna i (como el desplegable de Excel). */
  function abrirPanel(i, nombre, boton) {
    const yaAbierto = _panelAbierto?.boton === boton;
    _panelAbierto?.cerrar();
    if (yaAbierto) return;

    // Valores disponibles: los de las filas que pasan los filtros de las OTRAS columnas
    const base = filas().filter((tr) => cumple(tr, i));
    const valores = [...new Set(base.map((tr) => valor(tr, i)))]
      .sort((a, b) => (a === VACIAS) - (b === VACIAS) || _cmp.compare(a, b));
    const actual = estado.filtros[i];
    const marcados = new Set(actual ? valores.filter((v) => actual.has(v)) : valores);

    const panel = document.createElement('div');
    panel.className = 'filtro-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Filtro de ${nombre}`);
    panel.innerHTML = `
      <button type="button" class="fp-orden" data-dir="1">Ordenar A → Z</button>
      <button type="button" class="fp-orden" data-dir="-1">Ordenar Z → A</button>
      <hr>
      <input type="search" class="fp-buscar" placeholder="Buscar" aria-label="Buscar valores de ${esc(nombre)}">
      <div class="fp-lista" role="group" aria-label="Valores"></div>
      <div class="fp-acciones"><button type="button" class="fp-borrar">Borrar filtro</button><button type="button" class="primary fp-aceptar">Aceptar</button></div>`;
    document.body.appendChild(panel);
    const lista = panel.querySelector('.fp-lista');
    const buscar = panel.querySelector('.fp-buscar');

    function pintarLista() {
      const q = _norm(buscar.value);
      const vis = valores.filter((v) => !q || _norm(v).includes(q));
      const todos = vis.length > 0 && vis.every((v) => marcados.has(v));
      lista.innerHTML = `<label class="fp-item fp-todos"><input type="checkbox" ${todos ? 'checked' : ''}> (Seleccionar todo)</label>`
        + vis.slice(0, MAX_VALORES).map((v, k) => `<label class="fp-item"><input type="checkbox" data-k="${k}" ${marcados.has(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('')
        + (vis.length > MAX_VALORES ? `<p class="muted fp-mas">${vis.length - MAX_VALORES} valores más: usa la búsqueda</p>` : '')
        + (vis.length ? '' : '<p class="muted fp-mas">Sin coincidencias</p>');
      lista.querySelector('.fp-todos input').onchange = (e) => { vis.forEach((v) => (e.target.checked ? marcados.add(v) : marcados.delete(v))); pintarLista(); };
      lista.querySelectorAll('input[data-k]').forEach((c) => {
        c.onchange = () => { const v = vis[Number(c.dataset.k)]; c.checked ? marcados.add(v) : marcados.delete(v); pintarLista(); };
      });
    }
    pintarLista();
    buscar.oninput = pintarLista;

    const cerrar = () => {
      panel.remove();
      boton.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', fuera, true);
      document.removeEventListener('keydown', teclas, true);
      window.removeEventListener('resize', cerrar);
      if (_panelAbierto?.panel === panel) _panelAbierto = null;
    };
    const aceptar = () => {
      // Como en Excel: con texto de búsqueda, solo cuentan los valores marcados que coinciden
      const q = _norm(buscar.value);
      const elegidos = valores.filter((v) => marcados.has(v) && (!q || _norm(v).includes(q)));
      if (elegidos.length === valores.length) delete estado.filtros[i];
      else estado.filtros[i] = new Set(elegidos);
      cerrar(); aplicar(); boton.focus();
    };
    const fuera = (e) => { if (!panel.contains(e.target) && e.target !== boton) cerrar(); };
    const teclas = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cerrar(); boton.focus(); }
      if (e.key === 'Enter' && e.target.closest('.filtro-panel') && e.target.type !== 'checkbox' && !e.target.matches('button')) { e.preventDefault(); aceptar(); }
    };
    panel.querySelectorAll('.fp-orden').forEach((b) => (b.onclick = () => { estado.col = i; estado.dir = Number(b.dataset.dir); cerrar(); aplicar(); boton.focus(); }));
    panel.querySelector('.fp-borrar').onclick = () => { delete estado.filtros[i]; cerrar(); aplicar(); boton.focus(); };
    panel.querySelector('.fp-aceptar').onclick = aceptar;
    document.addEventListener('mousedown', fuera, true);
    document.addEventListener('keydown', teclas, true);
    window.addEventListener('resize', cerrar);

    // Posición: bajo la cabecera, alineado con el borde izquierdo de la columna y sin salirse de la pantalla
    const r = boton.getBoundingClientRect();
    const col = boton.closest('th').getBoundingClientRect();
    const ancho = panel.offsetWidth;
    const izq = Math.min(Math.max(8, col.left), document.documentElement.clientWidth - ancho - 8);
    panel.style.left = `${izq + window.scrollX}px`;
    panel.style.top = `${r.bottom + 4 + window.scrollY}px`;
    boton.setAttribute('aria-expanded', 'true');
    _panelAbierto = { panel, boton, cerrar };
    buscar.focus();
  }

  /** ¿Pasa la fila los filtros de todas las columnas salvo `excepto`? */
  function cumple(tr, excepto = -1) {
    return Object.entries(estado.filtros).every(([i, set]) => Number(i) === excepto || set.has(valor(tr, Number(i))));
  }

  /** Aplica filtros y orden sobre las filas cargadas. */
  function aplicar() {
    const todas = filas();
    let visibles = 0;
    for (const tr of todas) { const ok = cumple(tr); tr.hidden = !ok; if (ok) visibles++; }
    if (estado.col !== null) {
      const tbody = tabla.tBodies[0];
      todas.sort((a, b) => {
        const x = valor(a, estado.col), y = valor(b, estado.col);
        if (x === VACIAS) return 1;   // vacías siempre al final
        if (y === VACIAS) return -1;
        return _cmp.compare(x, y) * estado.dir;
      }).forEach((tr) => tbody.appendChild(tr));
    }
    ths.forEach((th, i) => {
      th.setAttribute('aria-sort', estado.col === i ? (estado.dir > 0 ? 'ascending' : 'descending') : 'none');
      botones[i].classList.toggle('activo', !!estado.filtros[i]);
      botones[i].innerHTML = estado.filtros[i] ? ICONO_EMBUDO : ICONO_FLECHA;
      botones[i].title = estado.filtros[i] ? 'Filtro activo' : 'Filtrar y ordenar';
    });
    const nFiltros = Object.keys(estado.filtros).length;
    pie.textContent = todas.length && nFiltros ? `${visibles} de ${todas.length} filas · ${nFiltros} filtro(s)` : '';
    pie.hidden = !pie.textContent;
  }

  const api = {
    /** Llamar después de pintar o recargar las filas. */
    actualizar() { aplicar(); },
    limpiar() { estado.filtros = {}; aplicar(); },
  };
  api.actualizar();
  return api;
}
