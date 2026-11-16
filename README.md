# ⚡ VocabMaster — Plataforma de Vocabulario Multilingüe

Sistema web inteligente para el estudio de vocabulario basado en tus hojas de Excel (**Inglés, Francés, Alemán, Italiano y Portugués**), equipado con **Repetición Espaciada (SRS)**, sincronización automática con **Google Drive**, recordatorios en **Google Calendar**, asistente interactivo en **Telegram**, consulta de lemas/raíces gramaticales en **Wiktionary** y videos de pronunciación con **YouGlish**.

---

## 🌟 Características Principales

1. **Sincronización Inteligente con Google Drive:**
   - Detecta automáticamente cuando reemplazas o actualizas tu archivo `.xls` o `.xlsx` en tu carpeta de Google Drive mediante notificaciones push (`webhooks`).
   - Sincronización incremental: **las palabras nuevas se añaden y las existentes se actualizan sin borrar nunca tu historial de repaso**.
   - También permite subir archivos directamente desde la interfaz web o sincronizar el archivo local del proyecto.

2. **Repetición Espaciada (SM-2 / FSRS):**
   - Algoritmo que calcula el intervalo óptimo de repaso para cada palabra según tu calificación (*1: Otra vez, 2: Difícil, 3: Bien, 4: Fácil*).
   - Compatible con atajos de teclado (`Espacio` para ver traducción, `1-4` para calificar, `R` para repetir audio).

3. **Forma Original, Lemas y Raíces (Wiktionary):**
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

## ☁️ Despliegue en Railway

### Opción A: Desde GitHub (Recomendado)
1. Sube este proyecto a un repositorio privado o público en tu cuenta de **GitHub**.
2. Entra a [Railway.app](https://railway.app) y haz clic en **New Project → Deploy from GitHub repo**.
3. (Opcional) En el proyecto de Railway, haz clic en **+ New → Database → Add PostgreSQL**. Railway inyectará automáticamente la variable `DATABASE_URL`.
   *(Nota: si no añades PostgreSQL, la app usará SQLite automáticamente).*
4. En la pestaña **Settings** de tu servicio en Railway, ve a **Networking → Generate Domain** para obtener tu enlace público `https://tu-app.up.railway.app`.
5. Configura las variables de entorno en la pestaña **Variables** (guíate con la lista abajo).

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

### 2. Bot de Telegram
Para recibir alertas diarias y repasar desde Telegram:

1. Abre Telegram y busca al usuario [@BotFather](https://t.me/BotFather).
2. Envía el comando `/newbot` y sigue las instrucciones para ponerle nombre y usuario.
3. BotFather te dará un **Token** (ej: `7123456789:AAH...`).
4. En Railway (o `.env`), define:
   - `TELEGRAM_BOT_TOKEN`: el token entregado por BotFather.
5. Inicia tu bot en Telegram enviándole `/start`. El servidor registrará tu chat automáticamente para enviarte los repasos.
6. Comandos útiles en Telegram:
   - `/repasar` o `/quiz`: inicia una sesión de repaso en el chat.
   - `/stats`: muestra el total de palabras y tarjetas pendientes.

---

## 📋 Resumen de Variables de Entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `PORT` | Automática | Puerto del servidor (Railway lo asigna solo, en local 3000) |
| `DATABASE_URL` | Opcional | URL de PostgreSQL (Railway lo autoconfigura al añadir Postgres) |
| `RAILWAY_PUBLIC_DOMAIN` | Opcional | Tu dominio en Railway para webhooks y enlaces |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Para Drive/Calendar | JSON completo de la clave de la cuenta de servicio |
| `GOOGLE_DRIVE_FOLDER_ID` | Para Drive | ID de la carpeta compartida donde guardas el Excel |
| `GOOGLE_CALENDAR_ID` | Para Calendar | ID del calendario (por defecto `primary`) |
| `TELEGRAM_BOT_TOKEN` | Para Telegram | Token de tu bot de @BotFather |
| `REMINDER_HOUR` | Opcional | Hora para recordatorio diario (0 a 23, defecto: `9` para 9:00 AM) |
| `TIMEZONE` | Opcional | Zona horaria (defecto: `America/Bogota`) |
