# Leer pedidos desde Outlook

## Primera configuración

1. Instala la dependencia del proyecto desde PowerShell:

   ```powershell
   npm install
   ```

2. En Microsoft Entra, registra una aplicación de tipo **cuentas de esta organización** y activa el acceso de cliente público. Añade los permisos delegados de Microsoft Graph `User.Read` y `Mail.Read`.
3. Copia `.env.example` a `.env` (si ya tienes `.env`, conserva tu clave de OpenRouter) y completa `OUTLOOK_CLIENT_ID` y `OUTLOOK_EMAIL`.
4. Ejecuta la prueba de una sola revisión:

   ```powershell
   node --env-file=.env src/leer-correos-outlook.js --once
   ```

   La primera vez, Microsoft mostrará un código para iniciar sesión. Usa la cuenta que has puesto en `OUTLOOK_EMAIL`.

## Uso normal

Para revisar el buzón continuamente, una vez por minuto:

```powershell
node --env-file=.env src/leer-correos-outlook.js
```

También se puede pasar el correo como argumento:

```powershell
node --env-file=.env src/leer-correos-outlook.js usuario@empresa.com
```

Los resultados se guardan individualmente en `resultados/correos-outlook`. El programa recuerda qué mensajes ya procesó en `resultados/correos-procesados.json`. Los errores no se marcan como procesados, así que se vuelven a intentar en la próxima revisión.

Por ahora, los pedidos adjuntos en PDF, TXT o CSV se pueden enviar a extracción. Otros formatos quedan anotados en `dudas` para revisión manual. Los PDF escaneados pueden necesitar OCR y no siempre se leerán con el motor gratuito.
