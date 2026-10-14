async function revisarBuzon() {
  const token = await obtenerTokenDeOutlook();
  const correosNuevos = await leerCorreoNuevos(token);

  for (const correo of correosNuevos) {
    const categoria = await clasificarCorreos(correo);

    if (categoria === "Pedido") {
      const adjuntos = await obtenerAdjuntos(correo.id, token);
      const textoCompleto = `${correo.subject}\n${correo.body}\n${adjuntos}`;
      const pedido = await extraerPedido(textoCompleto)
      await guardarCorreo(correo, pedido);
    }

    await guardarComoProcesado(correo.id);
  }
}
