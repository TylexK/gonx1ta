# Host para bot DYSTANY

Este servidor mantiene abierto el bot Node.js de WhatsApp y lo reinicia si termina.

## Uso local

1. Instala las dependencias con `npm install`.
2. Ejecuta:

```bash
npm start
```

El servidor escucha en `http://localhost:3000` y su comprobacion de estado esta en `GET /health`.

Antes de iniciar, ejecuta `npm run check` y `npm test`. El panel permanece en `127.0.0.1` por defecto; no publiques ese puerto directamente en internet. Las variables sensibles se configuran en `.env`, que no debe compartirse ni subirse al repositorio.

El panel requiere un token secreto: no existe un token predeterminado. Genera uno con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` y configura `PANEL_TOKEN` antes de iniciar. Por defecto escucha solo en `127.0.0.1`; usa `PANEL_HOST` unicamente si necesitas publicarlo detras de un proxy o firewall.

El comando `.menu` envía primero un botón «Abrir menú» que abre el panel visual en el navegador integrado de WhatsApp, y después la lista nativa de comandos esenciales. WhatsApp no puede mostrar una página HTML viva dentro de una burbuja de chat; el usuario debe tocar el botón para abrir el panel. Si WhatsApp rechaza el botón, el bot envía el enlace en texto; si rechaza la lista, envía los comandos esenciales y ese enlace como respaldo. `.menu buscar palabra` busca comandos en texto, sin depender de listas interactivas. `.menu web` envía únicamente un enlace al panel. Los enlaces del panel se firman con HMAC y vencen en una hora; el servidor crea o carga la clave en `%USERPROFILE%\.gonxta\menu.secret` (puedes cambiar la ruta con `MENU_SECRET_FILE` o proporcionar `MENU_SECRET`). El proceso padre comparte esa clave con el bot hijo; no la publiques ni la subas al repositorio. El origen se consulta en cada solicitud de `.menu`, así que Quick Tunnel puede cambiar al reiniciar sin generar enlaces con el dominio anterior. `MENU_STATIC_URL` permanece como respaldo permanente si el origen dinámico no está disponible. Puedes configurar `MENU_PUBLIC_URL` con el origen HTTPS de un dominio fijo y enrutar `/menu` y `/menu-assets/gonxta.png` al puerto local. Si no defines `MENU_PUBLIC_URL`, el servidor inicia Cloudflare Quick Tunnel (requiere `cloudflared` instalado) contra un listener aislado en `127.0.0.1:3061`, que solo expone el menú y su imagen; usa `MENU_TUNNEL=false` para desactivarlo. No publiques ni enrutes `/internal/menu-link`, `/internal/menu-origin` o `/internal/diagnostics`; son endpoints exclusivos para el proceso local del bot.

En Node 22.5 o superior, PM2 usa SQLite mediante `DB_STORAGE=sqlite` y migra automaticamente el contenido de `database.json` a `database.sqlite` la primera vez. En Termux con Node 18 se mantiene el backend JSON atomico hasta actualizar Node; no borres `database.json` hasta confirmar la migracion. Para respaldar SQLite, detén el bot antes de copiar `database.sqlite`, `database.sqlite-wal` y `database.sqlite-shm`, o usa una herramienta de backup compatible con SQLite; no copies solo uno de esos archivos mientras la base está activa.

Los backups JSON se guardan en `backups/` y se conservan automáticamente los últimos 24. Antes de restaurar, detén el bot, conserva una copia de la base actual y valida el backup con `JSON.parse`; después reemplaza la base solo si la estructura contiene `users`, `groups` y `transacciones`. Reinicia y prueba comandos de lectura y escritura en un grupo de prueba.

El panel lee y modifica la misma base de datos configurada para el bot, tanto en modo JSON como SQLite. El estado de pausa del bot se conserva al reiniciar el servidor. Para las descargas de musica, instala yt-dlp y una distribucion completa de FFmpeg; `ffprobe` debe estar junto a FFmpeg o disponible en `PATH` para evitar avisos de metadatos.

El panel de control separa el Dashboard de la vista «Grupos». Esta última muestra los grupos en los que el bot participa, sus fotos de perfil disponibles y acciones para activarlos, apagarlos o salir de ellos. La lista del bot y los datos visibles del panel se actualizan cada minuto. El Dashboard muestra la conexión de WhatsApp, memoria del servidor, tiempo activo, errores recientes y actividad administrativa. Las acciones de grupos y del bot requieren autorización del servidor, token de sesión, origen del mismo sitio y JSON; los cambios se registran en `panel-audit.json`. Las alertas de guardado y copias de seguridad aparecen en las fallas recientes.

Si WhatsApp devuelve `408` o `503`, el bot reintenta la conexión automáticamente con espera progresiva. Si devuelve `401` con `conflict/device_removed` o `conflict/replaced`, la sesión fue invalidada por WhatsApp: el bot archiva la carpeta `sesion` como `sesion_invalid_<timestamp>`, reinicia y muestra un nuevo QR para volver a vincular el dispositivo. Esto no puede repararse conservando las credenciales invalidadas.

Si aparecen repetidamente `Bad MAC`, `Failed to decrypt message` o `No matching sessions found`, las claves Signal locales quedaron desincronizadas. Detén el bot, renombra `sesion` a `sesion_bad_mac_<timestamp>` para conservar el respaldo y vuelve a iniciar para vincular el dispositivo con el nuevo QR. No borres la carpeta anterior hasta confirmar que los chats privados funcionan. El bot no procesa sus propios eventos (`emitOwnEvents: false`), evitando que esos eventos se conviertan en comandos duplicados.

En grupos, los administradores pueden usar `.registro [1-20]` para consultar las últimas acciones administrativas; sin cantidad, muestra las últimas 10. `.logs` conserva la vista anterior del registro.

En grupos, un administrador configura el mensaje de bienvenida con `.setwelcome texto`. Para incluir una imagen, envíala con el mismo comando como pie de foto: `.setwelcome ¡Bienvenido {user}!`. La imagen puede ser JPG, PNG o WebP de hasta 10 MB. `{user}` se reemplaza por la mención de la persona que entra; si no se incluye, la mención se agrega al final. Para quitar la imagen, vuelve a guardar el texto sin adjuntar una.

Los comandos de IA y administración de grupos extraídos se organizan en `services/commands/` por área; el enrutamiento y el contexto de WhatsApp permanecen en `index.js`. El registro de actividad mantiene los últimos mensajes en memoria y agrupa las escrituras a `actividad.json` en intervalos breves; al detener el proceso se intenta guardar cualquier cambio pendiente.

Los comandos aceptan los prefijos `.`, `/` y `#`, y alias en español e inglés, sin distinguir mayúsculas: por ejemplo, `.musica`, `/music` y `#sing` ejecutan la misma función; también puedes usar `.ai` por `.ia` y `.open` por `.abrir`. Los alias se convierten al comando original antes de aplicar permisos, cooldowns y restricciones del grupo. En `.cmd disable|enable`, puedes indicar el nombre en cualquiera de los dos idiomas.

En un grupo, los administradores pueden usar `.link` o `.invitacion` para compartir el enlace de invitación del grupo.

En un grupo, un administrador puede usar `.n` respondiendo a un texto, una imagen o una encuesta para reenviarlo y mencionar a los participantes; también puede responder a una imagen con `.n texto` para añadir ese texto como pie de foto. Las encuestas se vuelven a crear con la misma pregunta, opciones y selección; los votos anteriores no se copian.

En los juegos de palabras, `.ahorcado` inicia una partida y `.letra a` prueba una letra (cada jugador tiene su propia partida en cada chat). Para la adivinanza, responde con `.adivinanza respuesta <palabra>`; las respuestas no distinguen mayúsculas, tildes ni signos de puntuación.

En grupos, los administradores pueden usar `.mute @usuario minutos` para un mute temporal. `.mute @usuario`, sin minutos, aplica un mute indefinido y también funciona respondiendo al mensaje del usuario. `.unmute` retira cualquier mute; `.unmutetemp` y `.unmuteperma` retiran únicamente el temporal o el indefinido, respectivamente. Los tres comandos de desmuteo aceptan una mención o una respuesta.

El casino incluye cinco juegos nuevos: `.casino` muestra las instrucciones de `.mayor_menor`, `.numero_secreto`, `.anagrama`, `.memoria` y `.par_impar`. Cada partida cuesta 50 monedas y una victoria paga 100.

En grupos, `.afk [motivo]` activa un estado AFK únicamente para quien lo ejecuta y para ese grupo. Al escribir otro mensaje en el grupo, el bot desactiva el estado, informa cuánto tiempo duró y no ejecuta respuestas automáticas adicionales del mensaje que provocó el regreso. El bot no puede silenciar las notificaciones del teléfono de un usuario mediante WhatsApp: los mensajes se entregan al dispositivo antes de que el bot pueda procesarlos. Para dejar de recibir notificaciones, el usuario debe silenciar ese grupo desde WhatsApp.

El comando `.sc` está reservado para administradores y solo informa si se solicita en un grupo. La versión actual de Baileys no permite iniciar videollamadas grupales desde el bot; únicamente expone funciones para rechazar llamadas entrantes.

## Configuracion

### Asistente de IA

Configura la clave del proveedor en el archivo `.env` (ya excluido de Git) o como variable secreta del entorno:

```dotenv
AI_API_KEY=tu_clave_del_proveedor
# Opcionales; AI_API_URL debe usar HTTPS.
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-4o-mini
AI_MAX_REQUESTS_PER_DAY=100
AI_MAX_REQUESTS_PER_USER_PER_DAY=10
AI_MAX_OUTPUT_TOKENS=400
```

En WhatsApp, `.ia <pregunta>` responde en español y `.iareset` borra el contexto de ese usuario. En grupos, el contexto es independiente para cada usuario. El servicio conserva como máximo tres intercambios por conversación y limita cada pregunta a 1000 caracteres. Los límites diarios de solicitudes se guardan localmente en `ai-usage.json`; las respuestas fallidas también cuentan para evitar gasto repetido. El máximo de tokens de salida ayuda a controlar el gasto. La IA solo genera texto y no ejecuta comandos del bot.

Los errores de proveedor se registran con el estado HTTP y el código de error seguro cuando están disponibles; nunca se registra la clave API ni el texto completo de la respuesta del proveedor.

Para cambiar los metadatos de un sticker, responde al sticker con `.wm nombre`. Cualquier miembro del grupo puede usarlo, también funciona en chats privados. El paquete se mantiene como `GONX!TA BOT` y el texto indicado reemplaza al autor anterior; el comando conserva los datos de imagen y animación del WebP. El nombre admite hasta 100 caracteres. Al reenviar el sticker, los metadatos pueden conservarse, aunque algunas aplicaciones pueden eliminarlos.

Usa `.qr texto o enlace` para crear una imagen QR y recibirla en el chat. El contenido puede tener hasta 1000 bytes UTF-8.

Los comandos `.brat` y `.bratv` generan stickers en un lienzo cuadrado de 512 × 512 con fondo blanco completo, tipografía sans serif y ajuste conservador del ancho para mantener las palabras dentro de los márgenes; las palabras demasiado largas también se dividen en varias líneas.

Para usar otro archivo JavaScript:

```bash
BOT_SCRIPT=otro-bot.js npm start
```

Tambien puedes iniciar cualquier comando mediante `BOT_COMMAND`:

```bash
BOT_COMMAND="node index.js" npm start
```

En Windows PowerShell:

```powershell
$env:BOT_COMMAND = "java -Xmx512M -jar mi-bot.jar"; npm start
```

Define `PORT` si tu plataforma de hosting asigna uno automaticamente. El endpoint `/health` informa si el proceso del bot esta ejecutandose.

## Ejecutarlo en un Samsung con Termux

Instala Termux desde F-Droid, abrelo y ejecuta:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts ffmpeg git
npm install -g pm2
termux-wake-lock
```

Copia esta carpeta al telefono, entra en ella y ejecuta:

```bash
npm install
pm2 start ecosystem.config.js
pm2 save
```

Para ver los logs y el QR:

```bash
pm2 logs dystany
```

Desactiva la optimizacion de bateria de Termux en los ajustes de Android y manten el telefono conectado al cargador y a una red estable. Para iniciar el bot despues de reiniciar Android, instala Termux:Boot y copia `termux-start.sh` dentro de `~/.termux/boot/`.

El telefono puede cerrar procesos por falta de memoria, temperatura, bateria o restricciones del fabricante. Por eso esta opcion no garantiza disponibilidad absoluta 24/7.

## Despliegue

Configura el comando de inicio de tu plataforma como `npm start`, sube el `.jar` y establece las variables de entorno que use tu bot. Para bots que necesitan credenciales, configuralas como variables secretas del hosting, no dentro del repositorio.
