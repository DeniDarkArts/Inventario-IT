// Lista de equipos asignados al usuario actual
(async () => {
  const u = await nav();
  const lista = document.querySelector('#lista');
  if (!u.empleado_id) { lista.innerHTML = '<p class="muted">Tu usuario no está vinculado a un empleado.</p>'; return; }
  const { items } = await API.get(`/empleados/${u.empleado_id}/equipos`);
  lista.innerHTML = items.length ? items.map((e) => `
    <a class="card" href="/equipo.html?id=${e.id}" style="display:block;color:inherit;text-decoration:none">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <strong>${esc(e.tipo)} · ${esc(e.codigo_interno)}</strong>
        <span class="muted">${esc(e.proyecto || '')}</span>
      </div>
      <div class="muted">${esc([e.marca, e.modelo].filter(Boolean).join(' '))}${e.fecha_fin_prevista ? ` · devolver antes del ${esc(e.fecha_fin_prevista)}` : ''}</div>
    </a>`).join('') : '<p class="muted">No tienes equipos asignados.</p>';
})();
