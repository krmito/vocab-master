# ⚡ VocabMaster — Plataforma de Vocabulario Multilingüe

Sistema web inteligente para el estudio de vocabulario basado en tus hojas de Excel (**Inglés, Francés, Alemán, Italiano y Portugués**), equipado con **Repetición Espaciada (SRS)**, sincronización automática con **Google Drive**, recordatorios en **Google Calendar**, asistente interactivo en **Telegram**, consulta de lemas/raíces gramaticales en **Wiktionary** y videos de pronunciación con **YouGlish**.

---

## 🌟 Características Principales

1. **Sincronización Inteligente con Google Drive:**
   - Detecta automáticamente cuando reemplazas o actualizas tu archivo `.xls` o `.xlsx` en tu carpeta de Google Drive mediante notificaciones push (`webhooks`).
   - Sincronización incremental: **las palabras nuevas se añaden y las existentes se actualizan sin borrar nunca tu historial de repaso**.
   - También permite subir archivos directamente desde la interfaz web o sincronizar el archivo local del proyecto.

2. **Repetición Espaciada (SM-2 / FSRS) y Filtros de Estudio:**
   - Algoritmo que calcula el intervalo óptimo de repaso para cada palabra según tu calificación (*1: Otra vez, 2: Difícil, 3: Bien, 4: Fácil*).
   - **Filtros por Dificultad:** Puedes elegir repasar solamente las difíciles (`🔥 Difíciles`, `🔄 Otra vez` o `😓 Difícil`), solo las fáciles (`⭐ Fáciles`), todas las palabras (`🌐 Todo`) o solo las pendientes del día (`⏰ Pendientes`).
   - **Selección Personalizada:** En el Diccionario puedes marcar casillas (`☑️`) en las palabras específicas que desees y pulsar *"Estudiar selección"* para una sesión a medida.
   - Compatible con atajos de teclado (`Espacio` para ver traducción, `1-4` para calificar, `R` para repetir audio).

3. **Ejemplos Bilingües Automáticos en Base de Datos:**
   - Para palabras en otros idiomas (**francés, portugués, italiano, alemán, inglés**) que no tengan oraciones de ejemplo en el Excel, el sistema busca automáticamente oraciones bilingües de alta calidad con traducción al español (mediante el corpus bilingüe humano Tatoeba y definiciones de diccionario) y las guarda permanentemente en la base de datos PostgreSQL.
   - Las palabras que ya tengan ejemplos nunca se sobreescriben ni se pierden al volver a sincronizar.

4. **Forma Original, Lemas y Raíces (Wiktionary):**
   - Si una palabra está conjugada (*ej: "vedo" o "plotted"*), el sistema consulta Wiktionary para mostrarte el **verbo o forma base en infinitivo** (*"vedere"*, *"plot"*), categoría gramatical y acepciones adicionales.

4. **Pronunciación y Videos Reales:**
   - Botón **🔊 Escuchar** instantáneo usando la síntesis de voz nativa del navegador en el idioma correspondiente (`en-US`, `fr-FR`, `de-DE`, `it-IT`, `pt-BR`).
   - Botón **🎬 YouGlish**: abre clips de YouTube donde personas nativas pronuncian exactamente esa palabra en su contexto real.
   - Botones rápidos para **🎙️ Forvo** y **▶️ YouTube**.

5. **Recordatorios Diarios:**
   - **Google Calendar:** crea o actualiza un evento diario con el resumen de palabras pendientes por idioma y enlace directo a la app.
   - **Telegram Bot:** envía una alerta matutina y permite hacer un **mini quiz interactivo** directamente dentro del chat con botones en línea.

---

## 🚀 Inicio Rápido en Local

La app está diseñada para funcionar de inmediato en local sin necesidad de bases de datos externas:

1. **Instalar dependencias y compilar:**
   ```bash
   npm install
   npm run build
   ```

2. **Iniciar servidor:**
   ```bash
   npm start
   ```

3. **Abrir en tu navegador:**
   - Entra en [http://localhost:3000](http://localhost:3000).
   - El sistema cargará automáticamente tu archivo Excel `export-*.xls` en la base de datos local SQLite (`data/vocab.sqlite`).

---

## ☁️ Despliegue en Railway y Persistencia de Datos

### ⚠️ Persistencia de la Base de Datos (PostgreSQL vs SQLite)
* **En contenedores de Railway (Nube):** El disco del contenedor de la aplicación web es efímero. Si usas SQLite sin un volumen montado, cada vez que haces un nuevo *deploy* (despliegue) de código o el contenedor se reinicia, el archivo `vocab.sqlite` vuelve al estado inicial y se pierden los repasos completados.
* **Solución definitiva con PostgreSQL (100% Persistente):**
  1. En tu proyecto de Railway, haz clic en el botón superior **+ New → Database → Add PostgreSQL**.
  2. En tu servicio de la app web, ve a la pestaña **Variables** y vincula `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway suele hacer esto automáticamente al conectar ambos servicios en el mismo proyecto).
  3. ¡Listo! A partir de ese momento, la app detectará `DATABASE_URL` y usará PostgreSQL. Todos tus repasos, calificaciones, fechas de algoritmo SRS y ejemplos automáticos generados se guardarán permanentemente en la base de datos Postgres sin borrarse jamás entre despliegues.

### Pasos para Desplegar:
1. Sube este proyecto a un repositorio en tu cuenta de **GitHub**.
2. Entra a [Railway.app](https://railway.app) y haz clic en **New Project → Deploy from GitHub repo**.
3. Añade la base de datos **PostgreSQL** (**+ New → Database → Add PostgreSQL**).
4. En la pestaña **Settings** de tu servicio web en Railway, ve a **Networking → Generate Domain** para obtener tu enlace público `https://tu-app.up.railway.app`.
5. Configura las variables de entorno en la pestaña **Variables** (ver tabla detallada abajo).

---

## 🔧 Configuración de Integraciones (Paso a Paso)

### 1. Google Drive y Google Calendar (Cuenta de Servicio)
Para que el servidor pueda leer tu carpeta de Drive y crear eventos en Calendar:

1. Ve a [Google Cloud Console](https://console.cloud.google.com/) y crea un nuevo proyecto (ej: `VocabMaster`).
2. Ve a **APIs y servicios → Biblioteca** y habilita:
   - **Google Drive API**
   - **Google Calendar API**
3. Ve a **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**:
   - Asígnale un nombre (ej: `vocab-service`).
   - Al terminar, haz clic sobre la cuenta de servicio creada, ve a la pestaña **Claves (Keys) → Agregar clave → Crear clave nueva → JSON**. Se descargará un archivo `.json`.
4. **Compartir tu carpeta de Google Drive:**
   - En Google Drive, crea una carpeta donde colocarás tu Excel (o usa una existente).
   - Haz clic derecho en la carpeta → **Compartir** → Añade el correo de la cuenta de servicio (`ejemplo@vocabmaster.iam.gserviceaccount.com`) con rol de **Lector**.
   - Copia el ID de la carpeta de la URL (`drive.google.com/drive/folders/ESTE_ID_DE_AQUI`).
5. **Compartir tu Google Calendar:**
   - En Google Calendar en la web, ve a la configuración de tu calendario → **Compartir con personas específicas** → Añade el correo de la cuenta de servicio con permiso **"Hacer cambios en eventos"**.
6. En Railway (o en tu archivo `.env`), define:
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: pega todo el contenido del archivo JSON que descargaste.
   - `GOOGLE_DRIVE_FOLDER_ID`: el ID de la carpeta de Drive.
   - `GOOGLE_CALENDAR_ID`: `primary` (o tu correo de Gmail).

---

### 2. Bot de Telegram (Paso a Paso Completo)
Para recibir alertas diarias y repasar desde tu celular con mini-quizzes interactivos:

#### Paso 1: Crear el Bot con `@BotFather`
1. Abre Telegram y busca al usuario oficial **[@BotFather](https://t.me/BotFather)**.
2. Envía el comando `/newbot`.
3. Dale un nombre visible a tu bot (por ejemplo: `Mi Vocabulario`).
4. Dale un nombre de usuario único terminado en `bot` (por ejemplo: `CarlosVocabMasterBot`).
5. BotFather te responderá con tu **Token HTTP API**.
   * **¿Qué es el Token?:** Es la clave completa que incluye los números iniciales, los dos puntos `:` y todas las letras.
   * *Ejemplo real:* `7483920192:AAEfGhIjKlMnOpQrStUvWxYz_123456`
   * **¡Copia todo el texto completo sin omitir los números del inicio!**

#### Paso 2: Obtener tu "Chat ID" Personal (¡No el del bot!)
Telegram necesita saber **a cuál usuario de Telegram debe escribirle**. Por eso el Chat ID es **tu número de identificación personal como usuario**, no el del bot:

* **Método 1 (Automático en la app web — Recomendado):**
  1. Abre tu bot recién creado en Telegram y pulsa el botón **"INICIAR"** (o envíale `/start` o cualquier mensaje como `hola`).
  2. En la app web ve a la pestaña **Ajustes ⚙️**.
  3. En la casilla *Tu Chat ID*, haz clic en el botón morado **`🔍 Auto-detectar`**.
  4. El servidor leerá tu mensaje, guardará tu Chat ID numérico automáticamente y te responderá en Telegram con un saludo de bienvenida.

* **Método 2 (Manual con `@userinfobot`):**
  1. En Telegram, busca y abre el bot **[@userinfobot](https://t.me/userinfobot)**.
  2. Pulsa **Iniciar**. Te responderá con tu información.
  3. Copia el número que aparece junto a **`Id:`** (ejemplo: `9028328272`). Ese es tu Chat ID personal.

#### Paso 3: Configurar las Credenciales
Puedes configurarlo de cualquiera de estas dos formas:

* **Opción A (Desde la propia Web App — Sin reiniciar servidor):**
  1. Entra a tu app web y ve a la pestaña **Ajustes ⚙️**.
  2. En **Bot Token**, pega el token completo de BotFather.
  3. En **Tu Chat ID**, pon tu número de usuario (ej: `9028328272`).
  4. Haz clic en **"💾 Guardar ajustes"**.
  5. Haz clic en **"🔔 Probar ahora"** para recibir tu primer recordatorio interactivo.

* **Opción B (Desde las Variables de Railway):**
  En Railway → Tu Servicio Web → Pestaña **Variables** → **New Variable**:
  * `TELEGRAM_BOT_TOKEN`: El token completo de BotFather (ej: `7483920192:AAEf...`).
  * `TELEGRAM_CHAT_ID`: Tu ID numérico personal (ej: `9028328272`).

> [!IMPORTANT]
> **Regla de oro de Telegram:** Un bot **nunca** puede enviarte mensajes si no has entrado a su chat al menos una vez y presionado el botón **"INICIAR"** (o enviado `/start`). Si alguna vez el bot te da error *"chat not found"* o *"forbidden"*, simplemente abre el bot y envíale un mensaje para reactivar el canal.

#### Comandos interactivos en Telegram:
Una vez conectado, puedes interactuar directamente con tu bot desde Telegram:
* `/start`: Inicia el bot y muestra el menú principal de opciones.
* `/repasar` o `/quiz`: Envía una palabra al azar para adivinar con botón de *"👁️ Revelar significado"* y botones para calificar (*🔄 Otra vez, 😓 Difícil, 👍 Bien, ⭐ Fácil*). Al calificarla, se reprograma en el algoritmo SRS igual que en la web.
* `/stats`: Muestra cuántas palabras tienes en total y cuántas pendientes por idioma.

---

## 📋 Resumen de Variables de Entorno

| Variable | Requerida | Ejemplo / Valor | Descripción |
|---|---|---|---|
| `PORT` | Automática | `3000` | Puerto asignado por Railway |
| `DATABASE_URL` | Opcional | `postgresql://...` | Conexión a PostgreSQL (Railway lo autoconfigura al añadir Postgres) |
| `RAILWAY_PUBLIC_DOMAIN` | Opcional | `mi-app.up.railway.app` | Dominio público de tu app para webhooks y enlaces |
| `GOOGLE_SERVICE_ACCOUNT_KEY`| Para Drive/Calendar | `{"type": "service_account", ...}` | JSON completo de la clave de la cuenta de servicio de Google Cloud |
| `GOOGLE_DRIVE_FOLDER_ID` | Para Drive | `1AbCdEfGhIjKlMnOp...` | ID de la carpeta compartida de Google Drive donde está tu archivo Excel |
| `GOOGLE_CALENDAR_ID` | Para Calendar | `tu_correo@gmail.com` | Tu correo Gmail personal donde quieres que se agenden los eventos |
| `TELEGRAM_BOT_TOKEN` | Para Telegram | `7483920192:AAEf...` | Token completo proporcionado por @BotFather (con números y dos puntos) |
| `TELEGRAM_CHAT_ID` | Para Telegram | `9028328272` | Tu ID numérico personal de usuario en Telegram (obtenido de @userinfobot) |
| `REMINDER_HOUR` | Opcional | `9` | Hora del día para los recordatorios diarios (0 a 23, defecto: 9 = 9:00 AM) |
| `TIMEZONE` | Opcional | `America/Bogota` | Zona horaria para sincronizar fechas y horas (defecto: `America/Bogota`) |
