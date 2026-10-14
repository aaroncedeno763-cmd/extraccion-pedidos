const fs = require('node:fs/promises');
const path = require('node:path');
const { main: extraerPedido } = require('./openrouter');

async function main() {
  const rutaCorreos = path.join(
    __dirname,
    '..',
    'resultados',
    'correos-categorizados',
    'pedidos.json'
  );

  const numeroCorreo = Number(process.argv[2] || 1);
  const modelo = process.argv[3] || 'openai/gpt-oss-120b';
  const textoCorreos = await fs.readFile(rutaCorreos, 'utf8');
  const correos = JSON.parse(textoCorreos);

  if (!Array.isArray(correos)) {
    throw new Error('pedidos.json debe contener una lista de correos.');
  }

  if (numeroCorreo < 1 || numeroCorreo > correos.length) {
    throw new Error(`Elige un número de correo entre 1 y ${correos.length}.`);
  }

  const correo = correos[numeroCorreo - 1];
  const asunto = correo.subject || correo.asunto || '';
  const remitente = correo.from || correo.remitente || '';
  const cuerpo = correo.body || correo.contenido || correo.text || '';
  const textoCorreo = `Asunto: ${asunto}\nRemitente: ${remitente}\n\n${cuerpo}`;

  console.log(`Correo ${numeroCorreo}/${correos.length}: ${asunto}`);
  const pedido = await extraerPedido(textoCorreo, modelo);

  if (
    pedido.productos?.length === 0
    && pedido.dudas?.length === 0
    && /adjunt/i.test(cuerpo)
  ) {
    pedido.dudas.push(
      'El correo indica que el pedido está en un documento adjunto, pero ese archivo no está incluido en pedidos.json.'
    );
  }

  const resultado = {
    correo: numeroCorreo,
    asunto,
    remitente,
    modelo,
    extraccion: pedido,
  };
  const carpetaSalida = path.join(__dirname, '..', 'resultados', 'extracciones');
  await fs.mkdir(carpetaSalida, { recursive: true });

  const nombreModelo = modelo.replace(/[^a-zA-Z0-9-]/g, '-');
  const rutaSalida = path.join(
    carpetaSalida,
    `correo-${numeroCorreo}-${nombreModelo}.json`
  );
  await fs.writeFile(rutaSalida, JSON.stringify(resultado, null, 2), 'utf8');
  console.log(`Resultado guardado en: ${rutaSalida}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
