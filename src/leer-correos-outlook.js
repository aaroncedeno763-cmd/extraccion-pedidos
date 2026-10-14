// BORRADOR: ejemplo de cómo podría conectarse el proyecto con Outlook.
// Aún no se puede ejecutar: falta configurar el acceso de Microsoft y conectar
// la clasificación y la lectura de adjuntos.

const fs = require('node:fs/promises');
const path = require('node:path');
const { main: extraerPedido } = require('./openrouter');

// Dirección de Microsoft Graph, el servicio que permite leer el buzón de Outlook.
const graphUrl = 'https://graph.microsoft.com/v1.0';

// Archivo local donde guardaremos los IDs que ya se han procesado.
const archivoProcesados = path.join(
  __dirname,
  '..',
  'resultados',
  'correos-procesados.json'
);

async function leerIdsProcesados() {
  try {
    // Si ya existe el archivo, leemos la lista para evitar repetir correos.
    const texto = await fs.readFile(archivoProcesados, 'utf8');
    return JSON.parse(texto);
  } catch (error) {
    // La primera vez todavía no existe, así que empezamos con una lista vacía.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function guardarIdsProcesados(ids) {
  // Crea la carpeta resultados si aún no existe.
  await fs.mkdir(path.dirname(archivoProcesados), { recursive: true });

  // Guarda los IDs en un JSON para recordarlos la próxima vez.
  await fs.writeFile(archivoProcesados, JSON.stringify(ids, null, 2), 'utf8');
}

async function leerCorreosOutlook(token) {
  // Pide a Outlook los últimos 20 correos no leídos de la bandeja de entrada.
  const url = new URL(`${graphUrl}/me/mailFolders/inbox/messages`);
  url.searchParams.set('$filter', 'isRead eq false');
  url.searchParams.set('$select', 'id,subject,from,body,hasAttachments,receivedDateTime');
  url.searchParams.set('$top', '20');

  const respuesta = await fetch(url, {
    headers: {
      // Este token se obtiene al iniciar sesión y dar permiso de lectura del correo.
      Authorization: `Bearer ${token}`,
      // Solicita el cuerpo en texto para que sea más fácil enviarlo al modelo.
      Prefer: 'outlook.body-content-type="text"',
    },
  });

  if (!respuesta.ok) {
    throw new Error(`Microsoft Graph respondió HTTP ${respuesta.status}`);
  }

  const datos = await respuesta.json();
  return datos.value || [];
}

async function clasificarCorreo(correo) {
  // Aquí se conectaría la función clasificarCorreo del archivo
  // categorizar-correos.js. Ahora mismo ese archivo ejecuta todo el JSON
  // directamente y habría que prepararlo para poder reutilizar su función.
  throw new Error('Pendiente conectar la función de clasificación.');
}

async function leerTextoAdjuntos(token, correo) {
  // Si no hay adjuntos, no hace falta consultar otra vez a Outlook.
  if (!correo.hasAttachments) return '';

  // Pide a Microsoft Graph la lista de archivos adjuntos de este correo.
  const url = `${graphUrl}/me/messages/${correo.id}/attachments`;
  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!respuesta.ok) {
    throw new Error(`No se pudieron leer los adjuntos: HTTP ${respuesta.status}`);
  }

  const datos = await respuesta.json();

  // Aquí se descargarían los archivos y se leería su contenido.
  // Por ejemplo, un PDF necesita convertirse a texto antes de usar OpenRouter.
  // El formato real (PDF, Excel, imagen) determinará qué lector usar.
  console.log(`El correo tiene ${datos.value?.length || 0} adjunto(s).`);
  throw new Error('Pendiente descargar y convertir los adjuntos a texto.');
}

async function main() {
  // El token no debe escribirse directamente en el código.
  const token = process.env.MICROSOFT_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Falta configurar MICROSOFT_ACCESS_TOKEN para Outlook.');
  }

  // Carga los IDs procesados y solicita correos nuevos a Outlook.
  const idsProcesados = await leerIdsProcesados();
  const correos = await leerCorreosOutlook(token);

  for (const correo of correos) {
    // Si ya vimos este mensaje, lo saltamos.
    if (idsProcesados.includes(correo.id)) continue;

    console.log(`Procesando: ${correo.subject || '(sin asunto)'}`);

    // Primero se clasifica el correo para decidir qué hacer con él.
    const categoria = await clasificarCorreo(correo);

    if (categoria === 'Pedidos') {
      // El cuerpo del correo se combina con el texto extraído de los adjuntos.
      const textoAdjuntos = await leerTextoAdjuntos(token, correo);
      const cuerpo = correo.body?.content || '';
      const textoPedido = `Asunto: ${correo.subject}\n\n${cuerpo}\n\n${textoAdjuntos}`;

      // Envía solo este correo al modelo, no toda la bandeja de entrada.
      const pedido = await extraerPedido(textoPedido);
      console.log(JSON.stringify(pedido, null, 2));

      // TODO: guardar el pedido en un archivo JSON como hacemos en las pruebas.
    }

    // Se marca como procesado incluso si no era un pedido, para no repetirlo.
    idsProcesados.push(correo.id);
    await guardarIdsProcesados(idsProcesados);
  }

  console.log('Revisión terminada.');
}

// Muestra los errores de forma sencilla en la consola.
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
