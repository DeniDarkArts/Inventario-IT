// Panel de firma en canvas (ratón, dedo o lápiz). Devuelve data:image/png;base64 o null si está vacío.
function Firma(canvas) {
  const ctx = canvas.getContext('2d');
  let dibujando = false, vacio = true;

  function ajustar() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
    vacio = true;
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => { dibujando = true; vacio = false; ctx.beginPath(); ctx.moveTo(...pos(e)); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (dibujando) { ctx.lineTo(...pos(e)); ctx.stroke(); } });
  ['pointerup', 'pointercancel'].forEach((ev) => canvas.addEventListener(ev, () => { dibujando = false; }));

  return {
    ajustar,
    borrar: ajustar,
    valor: () => (vacio ? null : canvas.toDataURL('image/png')),
  };
}
