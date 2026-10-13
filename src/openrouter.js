async function main() {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages: [
        {
          role: 'system',
          content: 'Extrae los productos y sus cantidades del correo. No inventes información. Responde solo con un JSON como este: {"productos":[{"nombre":"merluza","cantidad":3}],"dudas":[]}.',
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
    throw new Error(`OpenRouter respondió con el estado ${response.status}`);
  }

  const data = await response.json();
  const pedido = JSON.parse(data.choices[0].message.content);
  console.log(pedido);
}

main().catch(console.error);
