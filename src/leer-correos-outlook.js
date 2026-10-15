// este archivo es solo un ejemplo rtodavia no lo he puesto a prueba es para poder conectar el correo y que revise 
// los correos y que los extraiga los correos y se los envie a los otrs codigos


// Lee correos nuevos de Outlook, los clasifica y extrae los pedidos.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PublicClientApplication } = require('@azure/msal-node');
const { clasificarCorreo } = require('./categorizar-correos');
const { main: extraerPedido } = require('./openrouter');

const carpetaResultados = path.join(__dirname, '..', 'resultados', 'correos-outlook');
const archivoProcesados = path.join(__dirname, '..', 'resultados', 'correos-procesados.json');
const archivoCache = path.join(__dirname, '..', 'resultados', 'outlook-token-cache.json');
const graphUrl = 'https://graph.microsoft.com/v1.0';
const modeloExtraccion = process.env.MODELO_EXTRACCION || 'openai/gpt-oss-120b';

// Guarda los tokens de inicio de sesión para no pedir autorización cada vez.
const cachePlugin = {
  beforeCacheAccess: async (context) => {
    try {
      context.tokenCache.deserialize(await fs.readFile(archivoCache, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  },
  afterCacheAccess: async (context) => {
    if (context.cacheHasChanged) {
      await fs.mkdir(path.dirname(archivoCache), { recursive: true });
      await fs.writeFile(archivoCache, context.tokenCache.serialize(), 'utf8');
    }
  },
};

async function obtenerToken(correoBuzon) {
  if (!process.env.OUTLOOK_CLIENT_ID) {
    throw new Error('Falta OUTLOOK_CLIENT_ID en el archivo .env. Consulta las instrucciones de configuración.');
  }

  const aplicacion = new PublicClientApplication({
    auth: {
      clientId: process.env.OUTLOOK_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID || 'organizations'}`,
    },
    cache: { cachePlugin },
  });
  const cuentas = await aplicacion.getTokenCache().getAllAccounts();
  const cuenta = cuentas.find((item) => item.username.toLowerCase() === correoBuzon.toLowerCase());

  if (cuenta) {
    try {
      const token = await aplicacion.acquireTokenSilent({
        account: cuenta,
        scopes: ['User.Read', 'Mail.Read'],
      });
      return token.accessToken;
    } catch {
      // Si ha caducado, solicitamos de nuevo el inicio de sesión.
    }
  }

  console.log('Inicia sesión con la cuenta de Outlook que quieres leer:');
  const token = await aplicacion.acquireTokenByDeviceCode({
    scopes: ['User.Read', 'Mail.Read'],
    deviceCodeCallback: (respuesta) => console.log(respuesta.message),
  });
  if (token.account?.username && token.account.username.toLowerCase() !== correoBuzon.toLowerCase()) {
    throw new Error(`Has iniciado sesión con ${token.account.username}, pero pediste ${correoBuzon}.`);
  }
  return token.accessToken;
}

async function graphGet(url, token) {
  const respuesta = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  if (!respuesta.ok) {
    throw new Error(`Microsoft Graph respondió HTTP ${respuesta.status}: ${await respuesta.text()}`);
  }
  return respuesta.json();
}

async function leerCorreosNuevos(token) {
  const url = new URL(`${graphUrl}/me/mailFolders/inbox/messages`);
  url.searchParams.set('$filter', 'isRead eq false');
  url.searchParams.set('$select', 'id,subject,from,body,hasAttachments,receivedDateTime');
  url.searchParams.set('$top', '50');

  const correos = [];
  let siguiente = url.toString();
  while (siguiente) {
    const pagina = await graphGet(siguiente, token);
    correos.push(...(pagina.value || []));
    siguiente = pagina['@odata.nextLink'];
  }
  return correos;
}

async function obtenerAdjuntos(correo, token) {
  if (!correo.hasAttachments) return { pdfs: [], texto: '', nombres: [], dudas: [] };
  const url = `${graphUrl}/me/messages/${encodeURIComponent(correo.id)}/attachments`;
  const datos = await graphGet(url, token);
  const resultado = { pdfs: [], texto: '', nombres: [], dudas: [] };

  for (const adjunto of datos.value || []) {
    if (adjunto.isInline || !adjunto.contentBytes) continue;
    resultado.nombres.push(adjunto.name || 'archivo sin nombre');
    const contenido = Buffer.from(adjunto.contentBytes, 'base64');
    const extension = path.extname(adjunto.name || '').toLowerCase();

    if (extension === '.pdf' || adjunto.contentType === 'application/pdf') {
      if (contenido.length > 15 * 1024 * 1024) {
        resultado.dudas.push(`El PDF ${adjunto.name} supera 15 MB y no se ha enviado al modelo.`);
      } else {
        resultado.pdfs.push({ nombre: adjunto.name || 'pedido.pdf', contenido });
      }
    } else if (['.txt', '.csv'].includes(extension)) {
      resultado.texto += `\n\nContenido del archivo ${adjunto.name}:\n${contenido.toString('utf8')}`;
    } else {
      resultado.dudas.push(`No se ha podido leer automáticamente el adjunto ${adjunto.name || '(sin nombre)'} (${adjunto.contentType || 'formato desconocido'}).`);
    }
  }
  return resultado;
}

async function leerProcesados() {
  try {
    return JSON.parse(await fs.readFile(archivoProcesados, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function guardarResultado(correo, categoria, adjuntos, extraccion) {
  await fs.mkdir(carpetaResultados, { recursive: true });
  const resultado = {
    id: correo.id,
    asunto: correo.subject || '',
    remitente: correo.from?.emailAddress?.address || '',
    recibido: correo.receivedDateTime || null,
    categoría: categoria,
    adjuntos: adjuntos.nombres,
    ...(extraccion ? { extraccion } : {}),
  };
  const nombre = `${crypto.createHash('sha1').update(correo.id).digest('hex')}.json`;
  await fs.writeFile(path.join(carpetaResultados, nombre), JSON.stringify(resultado, null, 2), 'utf8');
}

async function revisarBuzon(correoBuzon) {
  const token = await obtenerToken(correoBuzon);
  const procesados = await leerProcesados();
  const nuevos = await leerCorreosNuevos(token);
  let cantidad = 0;

  for (const correo of nuevos) {
    if (procesados.includes(correo.id)) continue;
    const asunto = correo.subject || '(sin asunto)';
    console.log(`Procesando: ${asunto}`);

    try {
      const categoria = await clasificarCorreo({
        subject: correo.subject || '',
        from: correo.from?.emailAddress?.address || '',
        body: correo.body?.content || '',
      });
      let adjuntos = { pdfs: [], texto: '', nombres: [], dudas: [] };
      let extraccion;

      if (categoria === 'Pedidos') {
        adjuntos = await obtenerAdjuntos(correo, token);
        const texto = `Asunto: ${correo.subject || ''}\nRemitente: ${correo.from?.emailAddress?.address || ''}\n\n${correo.body?.content || ''}${adjuntos.texto}`;
        extraccion = await extraerPedido(texto, modeloExtraccion, adjuntos.pdfs);
        if (adjuntos.dudas.length) extraccion.dudas.push(...adjuntos.dudas);
        if (adjuntos.nombres.length && adjuntos.pdfs.length === 0 && !adjuntos.texto) {
          extraccion.dudas.push('El pedido puede estar en un adjunto que este programa no puede leer todavía.');
        }
      }

      await guardarResultado(correo, categoria, adjuntos, extraccion);
      procesados.push(correo.id);
      await fs.mkdir(path.dirname(archivoProcesados), { recursive: true });
      await fs.writeFile(archivoProcesados, JSON.stringify(procesados, null, 2), 'utf8');
      cantidad += 1;
      console.log(`Guardado (${categoria}).`);
    } catch (error) {
      // Si falla, no guardamos el ID como procesado: se intentará en la siguiente revisión.
      console.error(`Error con "${asunto}": ${error.message}`);
    }
  }
  console.log(`Revisión terminada. Correos procesados: ${cantidad}.`);
}

async function main() {
  const correoBuzon = process.argv.slice(2).find((argumento) => !argumento.startsWith('--'))
    || process.env.OUTLOOK_EMAIL;
  if (!correoBuzon) {
    throw new Error('Indica el correo: node --env-file=.env src/leer-correos-outlook.js usuario@empresa.com');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Falta OPENROUTER_API_KEY en .env.');
  }

  const soloUnaVez = process.argv.includes('--once');
  do {
    await revisarBuzon(correoBuzon);
    if (!soloUnaVez) {
      console.log('Esperando un minuto para revisar otra vez...');
      await new Promise((resolver) => setTimeout(resolver, 60_000));
    }
  } while (!soloUnaVez);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { revisarBuzon };
