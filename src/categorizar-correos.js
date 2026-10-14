const fs = require('node:fs/promises');
const path = require('node:path');

const categorias = [
  'Pedidos',
  'Facturación',
  'Incidencias',
  'Proveedores',
  'Publicidad',
  'Notificaciones',
  'Modificaciones',
  'Pagos',
  'Logística',
  'Comercial',
];

const nombresArchivo = {
  Pedidos: 'pedidos',
  'Facturación': 'facturacion',
  Incidencias: 'incidencias',
  Proveedores: 'proveedores',
  Publicidad: 'publicidad',
  Notificaciones: 'notificaciones',
  Modificaciones: 'modificaciones',
  Pagos: 'pagos',
  'Logística': 'logistica',
  Comercial: 'comercial',
};

const prompt = `Clasifica el correo según el asunto, el remitente y el contenido.
Elige una sola categoría:
Pedidos: nuevos pedidos y solicitudes de productos, incluidos los pedidos que llegan mediante avisos automáticos de plataformas.
Facturación: facturas, albaranes, abonos y consultas contables.
Incidencias: reclamaciones, errores, productos defectuosos o faltantes.
Proveedores: tarifas, catálogos y ofertas de proveedores.
Publicidad: anuncios, promociones, spam y posibles fraudes.
Notificaciones: avisos automáticos e informativos que no incluyan un pedido, una factura u otra operación comercial.
Modificaciones: cambios o cancelaciones de pedidos existentes.
Pagos: transferencias, cobros, vencimientos y deudas.
Logística: transporte, entregas y planificación de distribución.
Comercial: presupuestos, consultas y otras comunicaciones comerciales.
Devuelve solo el nombre de la categoría.`;

async function clasificarCorreo(correo) {
  const asunto = correo.asunto || correo.subject || correo.tema || '';
  const remitente = correo.remitente || correo.from || correo.sender || correo.de || '';
  const contenido = correo.contenido || correo.body || correo.text || correo.texto || correo.mensaje || '';

  let ultimoError = 'respuesta vacía o categoría no válida';

  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      const respuesta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          max_tokens: 30,
          reasoning_effort: 'none',
          temperature: 0,
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: `Asunto: ${asunto}\nRemitente: ${remitente}\nContenido: ${contenido}`,
            },
          ],
        }),
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.text();
        if (respuesta.status === 402) {
          try {
            const errorApi = JSON.parse(detalle);
            ultimoError = `HTTP 402: ${errorApi.error?.message || 'créditos insuficientes'}`;
          } catch {
            ultimoError = 'HTTP 402: créditos insuficientes';
          }
          break;
        }
        ultimoError = `HTTP ${respuesta.status}: ${detalle}`;
      } else {
        const datos = await respuesta.json();
        const texto = datos.choices?.[0]?.message?.content;
        const categoria = typeof texto === 'string'
          ? texto.trim().replace(/[.!]+$/, '')
          : '';

        if (categorias.includes(categoria)) {
          return categoria;
        }

        ultimoError = `respuesta no válida (${JSON.stringify(texto ?? datos.error ?? 'sin texto')})`;
      }
    } catch (error) {
      ultimoError = error.message;
    }

    if (intento < 3) {
      const espera = intento * 3000;
      console.log(`Reintentando correo "${asunto}" en ${espera / 1000} segundos...`);
      await new Promise((resolver) => setTimeout(resolver, espera));
    }
  }

  throw new Error(`No se pudo clasificar "${asunto}" después de 3 intentos. Último error: ${ultimoError}`);
}

function limpiarTexto(texto) {
  return texto.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

async function main() {
  const archivoEntrada = process.argv[2];
  const carpetaSalida = process.argv[3];

  if (!archivoEntrada || !carpetaSalida) {
    console.log('Uso: node src/categorizar-correos.js entrada.json carpeta-salida');
    return;
  }

  // Lee la clave guardada en .env si no está definida en el terminal.
  if (!process.env.OPENROUTER_API_KEY) {
    const archivoEnv = path.join(__dirname, '..', '.env');
    const env = await fs.readFile(archivoEnv, 'utf8');
    const linea = env.split('\n').find((texto) => texto.startsWith('OPENROUTER_API_KEY='));
    process.env.OPENROUTER_API_KEY = linea?.split('=').slice(1).join('=').trim();
  }

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('No se encontró OPENROUTER_API_KEY en el archivo .env');
  }

  const entrada = JSON.parse(await fs.readFile(archivoEntrada, 'utf8'));
  const nombreLista = ['correos', 'emails', 'messages'].find((nombre) =>
    Array.isArray(entrada[nombre])
  );
  const correos = Array.isArray(entrada) ? entrada : entrada[nombreLista];

  if (!Array.isArray(correos)) {
    throw new Error('El JSON debe contener una lista de correos o una clave "correos".');
  }

  const rutaCarpetaSalida = path.resolve(carpetaSalida);
  const archivoProgreso = `${rutaCarpetaSalida}.progreso.json`;
  await fs.mkdir(rutaCarpetaSalida, { recursive: true });
  const ids = correos.map((correo) => correo.id || correo.messageId || correo.subject || '');
  let categoriasGuardadas = [];

  try {
    const progreso = JSON.parse(await fs.readFile(archivoProgreso, 'utf8'));
    const mismoArchivo = JSON.stringify(progreso.ids) === JSON.stringify(ids);
    const categoriasValidas = Array.isArray(progreso.categorias)
      && progreso.categorias.every((categoria) => categorias.includes(categoria));

    if (mismoArchivo && categoriasValidas) {
      categoriasGuardadas = progreso.categorias;
      console.log(`Continuando desde el correo ${categoriasGuardadas.length + 1}...`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  for (let i = categoriasGuardadas.length; i < correos.length; i += 5) {
    const grupo = correos.slice(i, i + 5);
    const categoriasGrupo = await Promise.all(grupo.map(clasificarCorreo));

    for (let j = 0; j < grupo.length; j += 1) {
      categoriasGuardadas.push(categoriasGrupo[j]);
      console.log(`Correo ${i + j + 1}/${correos.length}: ${categoriasGrupo[j]}`);
    }

    await fs.writeFile(
      archivoProgreso,
      JSON.stringify({ ids, categorias: categoriasGuardadas }, null, 2),
      'utf8'
    );
  }

  const resultado = correos.map((correo, i) => {
    const correoFinal = { ...correo, categoría: categoriasGuardadas[i] };
    if (typeof correoFinal.body === 'string') {
      correoFinal.body = limpiarTexto(correoFinal.body);
    }
    return correoFinal;
  });

  for (const categoria of categorias) {
    const correosCategoria = resultado.filter(
      (correo) => correo.categoría === categoria
    );
    const archivoCategoria = path.join(
      rutaCarpetaSalida,
      `${nombresArchivo[categoria]}.json`
    );

    await fs.writeFile(archivoCategoria, JSON.stringify(correosCategoria, null, 2), 'utf8');
    console.log(`${categoria}: ${correosCategoria.length} correos`);
  }

  await fs.unlink(archivoProgreso).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  console.log(`Archivos separados guardados en: ${rutaCarpetaSalida}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
