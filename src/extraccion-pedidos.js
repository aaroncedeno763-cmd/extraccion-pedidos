const fs = require('node:fs/promises');
const path = require('node:path');
const { main: extraerPedido } = require('./openrouter');

async function main() {
  const rutaCorreo = path.join(
    __dirname,
    '..',
    'data',
    'correos',
    'correo-correccion.txt'
  );

  const correo = await fs.readFile(rutaCorreo, 'utf8');
  const pedido = await extraerPedido(correo);

  console.log(JSON.stringify(pedido, null, 2));
}

main().catch(console.error);