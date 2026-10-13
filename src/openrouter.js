async function main(correo) {
  const inicio = Date.now();
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: 'Extrae del correo todos los productos solicitados. No inventes datos ni deduzcas cantidades o unidades. Para cada producto devuelve nombre, cantidad como número o null si no se indica, y unidad como texto o null si no se indica claramente (por ejemplo: cajas, kg, bolsas o unidades). Si falta la cantidad, añade una pregunta concreta en "dudas" para pedirla. Si falta la unidad o no queda claro qué significa la cantidad, también añade una pregunta concreta en "dudas"; no supongas que "3 merluzas" significa 3 piezas ni que una cantidad sin unidad corresponde a kg, cajas u otra medida. Si el correo corrige o cancela una cantidad, conserva solo la instrucción final vigente. Si hay productos repetidos, suma las cantidades solo cuando sus unidades coincidan claramente; si no, mantenlos separados y explica la duda. Devuelve únicamente un JSON válido con esta estructura: {"productos":[{"nombre":"merluza fresca","cantidad":3,"unidad":"cajas"}],"dudas":[]}.',
        },
        {
          role: 'user',
          content: correo,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const detalle = await response.text();
    throw new Error(
      `OpenRouter respondió con el estado ${response.status}: ${detalle}`
    );
  }

  const data = await response.json();
  const pedido = JSON.parse(data.choices[0].message.content);

  const tiempoMs = Date.now() - inicio;
  const uso = data.usage ?? {};
  console.log(`Tiempo total de respuesta: ${(tiempoMs / 1000).toFixed(2)} segundos`);
  console.log(`Tokens de entrada: ${uso.prompt_tokens ?? 'no disponible'}`);
  console.log(`Tokens de salida: ${uso.completion_tokens ?? 'no disponible'}`);
  console.log(`Tokens totales: ${uso.total_tokens ?? 'no disponible'}`);
  console.log(`Modelo usado: ${data.model ?? 'no disponible'}`);

  return pedido;
}

module.exports = { main };
