// Lector de etiquetas del fabricante para el alta de equipos (opcional).
//  - Nº de serie: códigos de barras (Code128, DataMatrix...) con zxing-wasm.
//  - Modelo: texto de la etiqueta por OCR (tesseract.js) en la zona que marca el usuario.
// Las librerías se sirven desde /vendor (sin CDN) y se cargan solo al abrir el lector.
const LectorEtiquetas = (() => {
  const cargado = {};
  function cargarScript(src) {
    if (!cargado[src]) {
      cargado[src] = new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = src; s.onload = ok; s.onerror = () => ko(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(s);
      });
    }
    return cargado[src];
  }

  async function zxing() {
    await cargarScript('/vendor/zxing/index.js');
    if (!zxing.listo) {
      ZXingWASM.prepareZXingModule({
        overrides: { locateFile: (ruta, prefijo) => (ruta.endsWith('.wasm') ? `/vendor/zxing/${ruta}` : prefijo + ruta) },
        fireImmediately: true,
      });
      zxing.listo = true;
    }
    return ZXingWASM;
  }

  let worker;
  async function ocr() {
    await cargarScript('/vendor/tesseract/tesseract.min.js');
    worker ??= Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract-core',
      langPath: '/vendor/tessdata', workerBlobURL: false,
    }).then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: '6' }); return w; });
    return worker;
  }

  // ---------- Códigos de barras ----------
  const OPC_BARRAS = { tryHarder: true, tryInvert: true, tryRotate: true, maxNumberOfSymbols: 8 };

  /** Lee todos los códigos de una imagen (ImageData o Blob). Prueba varias escalas: las fotos de móvil son grandes. */
  async function leerCodigos(imagen) {
    const { readBarcodes } = await zxing();
    const vistos = new Map();
    for (const extra of [{ tryDownscale: true, downscaleFactor: 2, downscaleThreshold: 500, binarizer: 'LocalAverage' },
      { tryDownscale: true, downscaleFactor: 4, downscaleThreshold: 500, binarizer: 'LocalAverage' }, {}]) {
      for (const r of await readBarcodes(imagen, { ...OPC_BARRAS, ...extra })) {
        if (r.isValid && r.text && !vistos.has(r.text)) vistos.set(r.text, r.format);
      }
    }
    return [...vistos].map(([texto, formato]) => ({ texto, formato }));
  }

  /** ¿Parece un nº de serie? Descarta MAC, UUID, URL y textos con espacios. */
  function pareceSerie(t) {
    return /^[A-Z0-9-]{5,30}$/i.test(t) && !/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i.test(t)
      && !/^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/i.test(t);
  }

  // ---------- OCR ----------
  /**
   * Prepara el recorte para el OCR: gris, invierte si el texto es claro sobre fondo oscuro (grabado láser),
   * suaviza la textura del metal y binariza con umbral local. Parámetros ajustados con docs/Modelo.jpg.
   */
  function preprocesar(origen, sel) {
    const escala = Math.min(1, 720 / sel.w);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sel.w * escala)); c.height = Math.max(1, Math.round(sel.h * escala));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = 'grayscale(1)';
    g.drawImage(origen, sel.x, sel.y, sel.w, sel.h, 0, 0, c.width, c.height);
    const W = c.width, H = c.height, n = W * H;
    let d = g.getImageData(0, 0, W, H);
    let media = 0; for (let i = 0; i < n; i++) media += d.data[i * 4]; media /= n;
    g.filter = `grayscale(1)${media < 128 ? ' invert(1)' : ''} blur(${(3 * escala).toFixed(1)}px)`;
    g.drawImage(origen, sel.x, sel.y, sel.w, sel.h, 0, 0, W, H);
    d = g.getImageData(0, 0, W, H);
    const px = d.data, gris = new Uint8Array(n);
    for (let i = 0; i < n; i++) gris[i] = px[i * 4];
    // Umbral local: media de una ventana de radio H/4 calculada con imagen integral
    const r = Math.max(8, Math.round(H / 4)), I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let fila = 0;
      for (let x = 0; x < W; x++) { fila += gris[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + fila; }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r);
        const m = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const v = gris[y * W + x] > m - 15 ? 255 : 0;
        px[(y * W + x) * 4] = px[(y * W + x) * 4 + 1] = px[(y * W + x) * 4 + 2] = v;
      }
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  /** Extrae nº de serie, código de producto y líneas de texto de lo leído por OCR. */
  function interpretar(texto) {
    const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => /[A-Z]{2,}/i.test(l));
    const buscar = (re) => { for (const l of lineas) { const m = l.match(re); if (m) return m[1].toUpperCase(); } return null; };
    return {
      lineas,
      serie: buscar(/(?:S\/?N|SERIAL[\s-]*(?:NUMBER|NO)?)\W{0,3}\s*([A-Z0-9]{6,20})/i),
      producto: buscar(/(?:PROD\w*\s*[I1l][D0]|P\/?N|PART\s*NO)\W{0,3}\s*([A-Z0-9][A-Z0-9#-]{4,19})/i),
    };
  }

  // ---------- Parecido de textos (emparejar con el catálogo) ----------
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }
  const fichas = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const parecido = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

  /** 0..1: cuántas fichas del modelo del catálogo aparecen (aprox.) en la línea leída. */
  function puntuar(linea, modelo) {
    const l = fichas(linea), m = fichas(`${modelo.marca} ${modelo.modelo}`);
    if (!l.length || !m.length) return 0;
    return m.reduce((s, t) => s + Math.max(...l.map((x) => parecido(t, x))), 0) / m.length;
  }

  /**
   * Propone modelos del catálogo para lo leído: primero por código de producto aprendido
   * (admite un carácter mal leído) y después por parecido del texto.
   */
  function proponerModelos(leido, modelos, codigos) {
    const props = new Map();
    if (leido.producto) {
      for (const c of codigos) {
        if (lev(leido.producto, c.codigo.toUpperCase()) <= 1) props.set(c.modelo_id, 1.01);
      }
    }
    for (const m of modelos) {
      const p = Math.max(0, ...leido.lineas.map((l) => puntuar(l, m)));
      if (p >= 0.6 && !(props.get(m.id) > p)) props.set(m.id, p);
    }
    return [...props].sort((a, b) => b[1] - a[1]).map(([id, p]) => ({ modelo: modelos.find((m) => m.id === id), puntos: p }))
      .filter((x) => x.modelo);
  }

  // ---------- Interfaz ----------
  let dlg;
  function crearDialogo() {
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-lector';
    dlg.innerHTML = `
      <h2 id="lt-titulo"></h2>
      <p class="muted" id="lt-ayuda"></p>
      <div class="lt-vista">
        <video id="lt-video" playsinline muted hidden></video>
        <canvas id="lt-lienzo" hidden></canvas>
        <div class="frame" id="lt-marco" hidden></div>
      </div>
      <div class="actions">
        <button type="button" id="lt-camara">Cámara</button>
        <label class="btn" for="lt-foto">Subir foto</label>
        <input id="lt-foto" type="file" accept="image/*" capture="environment" hidden>
        <button type="button" id="lt-capturar" hidden>Capturar</button>
        <button type="button" class="primary" id="lt-leer" hidden>Leer</button>
      </div>
      <p class="muted" id="lt-estado" role="status"></p>
      <div id="lt-resultado"></div>
      <div class="actions"><button type="button" id="lt-cerrar">Cerrar</button></div>`;
    document.body.appendChild(dlg);
  }

  /**
   * Abre el lector. modo 'serie' devuelve { serie }; modo 'modelo' devuelve { serie, producto, texto }.
   * Resuelve null si se cierra sin elegir.
   */
  function abrir(modo) {
    if (!dlg) crearDialogo();
    const $ = (s) => dlg.querySelector(s);
    const video = $('#lt-video'), lienzo = $('#lt-lienzo'), estado = $('#lt-estado'), res = $('#lt-resultado');
    $('#lt-titulo').textContent = modo === 'serie' ? 'Leer nº de serie' : 'Leer modelo de la etiqueta';
    $('#lt-ayuda').textContent = modo === 'serie'
      ? 'Enfoca la pegatina con los códigos de barras o sube una foto. Puedes marcar con el dedo la zona del código.'
      : 'Haz una foto de la etiqueta y marca con el dedo el texto (SN, ProdID y modelo).';
    estado.textContent = ''; res.innerHTML = '';
    let stream, imagen, sel, bucle, terminado = false;

    return new Promise((resolver) => {
      const parar = () => { cancelAnimationFrame(bucle); stream?.getTracks().forEach((t) => t.stop()); stream = null; video.hidden = true; $('#lt-marco').hidden = true; $('#lt-capturar').hidden = true; };
      const acabar = (valor) => { if (terminado) return; terminado = true; parar(); dlg.close(); resolver(valor); };
      dlg.onclose = () => acabar(null);
      $('#lt-cerrar').onclick = () => acabar(null);

      // Muestra la imagen en el lienzo; el usuario arrastra para marcar la zona
      function mostrar(img) {
        imagen = img; sel = null;
        lienzo.width = img.width; lienzo.height = img.height; lienzo.hidden = false;
        pintar(); $('#lt-leer').hidden = false;
        estado.textContent = modo === 'serie' ? 'Pulsa Leer (o marca antes la zona del código).' : 'Marca la zona del texto y pulsa Leer.';
      }
      function pintar() {
        const g = lienzo.getContext('2d');
        g.drawImage(imagen, 0, 0);
        if (sel) {
          g.fillStyle = 'rgba(0,0,0,.45)';
          g.fillRect(0, 0, lienzo.width, sel.y); g.fillRect(0, sel.y + sel.h, lienzo.width, lienzo.height - sel.y - sel.h);
          g.fillRect(0, sel.y, sel.x, sel.h); g.fillRect(sel.x + sel.w, sel.y, lienzo.width - sel.x - sel.w, sel.h);
          g.strokeStyle = '#F4A900'; g.lineWidth = Math.max(3, lienzo.width / 300); g.strokeRect(sel.x, sel.y, sel.w, sel.h);
        }
      }
      const punto = (e) => { const r = lienzo.getBoundingClientRect(); return [(e.clientX - r.left) * lienzo.width / r.width, (e.clientY - r.top) * lienzo.height / r.height]; };
      let inicio = null;
      lienzo.onpointerdown = (e) => { if (!imagen) return; inicio = punto(e); lienzo.setPointerCapture(e.pointerId); };
      lienzo.onpointermove = (e) => {
        if (!inicio) return;
        const [x, y] = punto(e);
        sel = { x: Math.round(Math.min(x, inicio[0])), y: Math.round(Math.min(y, inicio[1])), w: Math.round(Math.abs(x - inicio[0])), h: Math.round(Math.abs(y - inicio[1])) };
        pintar();
      };
      lienzo.onpointerup = () => { inicio = null; if (sel && (sel.w < 20 || sel.h < 10)) { sel = null; pintar(); } };

      $('#lt-foto').value = '';
      $('#lt-foto').onchange = async () => {
        const f = $('#lt-foto').files[0]; if (!f) return;
        parar();
        try { mostrar(await createImageBitmap(f)); } catch { estado.textContent = 'No se pudo abrir la imagen.'; }
      };

      $('#lt-camara').onclick = async () => {
        if (!window.isSecureContext || !navigator.mediaDevices) { estado.textContent = 'La cámara necesita HTTPS. Usa «Subir foto».'; return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
        } catch (err) { estado.textContent = `No se pudo abrir la cámara: ${err.message}`; return; }
        lienzo.hidden = true; $('#lt-leer').hidden = true; res.innerHTML = '';
        video.srcObject = stream; video.hidden = false; $('#lt-marco').hidden = false; $('#lt-capturar').hidden = false;
        await video.play();
        estado.textContent = modo === 'serie' ? 'Buscando códigos… o pulsa Capturar.' : 'Encuadra el texto en el marco y pulsa Capturar.';
        if (modo === 'serie') {
          // Lectura continua: cada fotograma que dé códigos los añade a la lista
          const c = document.createElement('canvas'); const g = c.getContext('2d', { willReadFrequently: true });
          let ocupado = false, ultimo = 0;
          const paso = async (t) => {
            if (!stream) return;
            bucle = requestAnimationFrame(paso);
            if (ocupado || t - ultimo < 350 || !video.videoWidth) return;
            ocupado = true; ultimo = t;
            c.width = video.videoWidth; c.height = video.videoHeight; g.drawImage(video, 0, 0);
            try { const cods = await leerCodigos(g.getImageData(0, 0, c.width, c.height)); if (cods.length) mostrarCodigos(cods, true); } catch { /* fotograma no válido */ }
            ocupado = false;
          };
          bucle = requestAnimationFrame(paso);
        }
      };

      $('#lt-capturar').onclick = async () => {
        const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        const bmp = await createImageBitmap(c);
        parar(); mostrar(bmp);
        // En modelo, la zona por defecto es la del marco que se ve en pantalla (centro)
        if (modo === 'modelo') { sel = { x: Math.round(bmp.width * 0.1), y: Math.round(bmp.height * 0.3), w: Math.round(bmp.width * 0.8), h: Math.round(bmp.height * 0.4) }; pintar(); }
      };

      const todos = new Map();
      function mostrarCodigos(cods, acumular) {
        if (!acumular) todos.clear();
        for (const c of cods) todos.set(c.texto, c);
        const lista = [...todos.values()];
        const elegido = lista.find((c) => pareceSerie(c.texto)) || lista[0];
        res.innerHTML = `<p><strong>Códigos leídos</strong> (toca el nº de serie):</p>
          <div class="chips">${lista.map((c, i) => `<button type="button" class="chip${c === elegido ? ' selected' : ''}" data-i="${i}">${esc(c.texto)}<small>${esc(c.formato)}</small></button>`).join('')}</div>
          <div class="actions"><button type="button" class="primary" id="lt-usar">Usar ${esc(elegido.texto)}</button></div>`;
        let actual = elegido;
        res.querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
          actual = lista[Number(b.dataset.i)];
          res.querySelectorAll('.chip').forEach((x) => x.classList.toggle('selected', x === b));
          res.querySelector('#lt-usar').textContent = `Usar ${actual.texto}`;
        }));
        res.querySelector('#lt-usar').onclick = () => acabar({ serie: actual.texto });
      }

      $('#lt-leer').onclick = async () => {
        if (!imagen) return;
        const boton = $('#lt-leer'); boton.disabled = true;
        try {
          const zona = sel || { x: 0, y: 0, w: imagen.width, h: imagen.height };
          const recorte = document.createElement('canvas'); recorte.width = zona.w; recorte.height = zona.h;
          const g = recorte.getContext('2d', { willReadFrequently: true });
          g.drawImage(imagen, zona.x, zona.y, zona.w, zona.h, 0, 0, zona.w, zona.h);
          estado.textContent = 'Buscando códigos de barras…';
          const cods = await leerCodigos(g.getImageData(0, 0, zona.w, zona.h));
          if (modo === 'serie') {
            if (cods.length) { estado.textContent = ''; mostrarCodigos(cods, false); } else estado.textContent = 'No se ha encontrado ningún código. Acerca la cámara o marca la zona del código.';
            return;
          }
          if (!sel) { estado.textContent = 'Marca primero con el dedo la zona del texto.'; return; }
          estado.textContent = 'Leyendo texto… (la primera vez tarda unos segundos)';
          const w = await ocr();
          const { data } = await w.recognize(preprocesar(imagen, sel));
          const leido = interpretar(data.text);
          // Si la etiqueta trae un código (DataMatrix...), el nº de serie se toma de ahí
          const serieCodigo = cods.map((c) => c.texto).find(pareceSerie);
          estado.textContent = '';
          res.innerHTML = `<p><strong>Texto leído</strong> (revísalo: el OCR puede confundir 8/B o 0/O):</p>
            <pre class="lt-texto">${esc(data.text.trim() || '(nada)')}</pre>
            <div class="actions"><button type="button" class="primary" id="lt-usar">Usar</button></div>`;
          res.querySelector('#lt-usar').onclick = () => acabar({ ...leido, serie: serieCodigo || leido.serie, texto: data.text });
        } catch (err) {
          estado.textContent = `No se pudo leer: ${err.message}`;
        } finally { boton.disabled = false; }
      };

      lienzo.hidden = true; video.hidden = true; $('#lt-leer').hidden = true; $('#lt-capturar').hidden = true;
      dlg.showModal();
    });
  }

  return { abrir, proponerModelos, interpretar, pareceSerie };
})();
