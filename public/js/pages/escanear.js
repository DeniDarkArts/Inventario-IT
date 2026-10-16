// Escáner QR: BarcodeDetector nativo (Chrome Android) con respaldo html5-qrcode.
// La cámara solo funciona con HTTPS (o en http://localhost).
(async () => {
  await nav();
  const estado = document.querySelector('#estado');
  const irA = (texto) => { location.href = `/equipo.html?qr=${encodeURIComponent(texto)}`; };

  document.querySelector('#manual').onsubmit = (e) => { e.preventDefault(); irA(document.querySelector('#codigo').value.trim()); };

  if (!window.isSecureContext) {
    estado.textContent = 'La cámara necesita HTTPS. Usa el campo manual o abre la app por HTTPS.';
    document.querySelector('#scanner').hidden = true;
    return;
  }

  // 1) BarcodeDetector nativo
  if ('BarcodeDetector' in window) {
    try {
      const formatos = await BarcodeDetector.getSupportedFormats();
      if (formatos.includes('qr_code')) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const video = document.querySelector('#video');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await video.play();
        const bucle = async () => {
          try {
            const [c] = await detector.detect(video);
            if (c?.rawValue) {
              stream.getTracks().forEach((t) => t.stop());
              if (navigator.vibrate) navigator.vibrate(80);
              return irA(c.rawValue);
            }
          } catch { /* fotograma no válido */ }
          requestAnimationFrame(bucle);
        };
        bucle();
        return;
      }
    } catch (err) {
      estado.textContent = `No se pudo abrir la cámara: ${err.message}`;
    }
  }

  // 2) Respaldo: html5-qrcode desde CDN
  document.querySelector('#scanner').hidden = true;
  const cont = document.querySelector('#fallback');
  cont.hidden = false;
  cont.id = 'lector';
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  s.onload = () => {
    const lector = new Html5Qrcode('lector');
    lector.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 },
      (texto) => { lector.stop().finally(() => irA(texto)); },
      () => {}).catch((e) => { estado.textContent = `No se pudo abrir la cámara: ${e}`; });
  };
  s.onerror = () => { estado.textContent = 'Escáner no disponible. Usa el campo manual.'; };
  document.body.appendChild(s);
})();
