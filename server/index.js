import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb, query, execute, getSetting, setSetting } from './db.js';
import { importExcelFromFile, importExcelFromBuffer } from './excel.js';
import { calculateNextReview } from './srs.js';
import { lookupWord } from './wiktionary.js';
import { checkAndSyncDrive, setupDriveWatch } from './drive.js';
import { syncDailyCalendarEvent } from './calendar.js';
import { sendDailyTelegramReminder, handleTelegramUpdate, startTelegramPolling } from './telegram.js';
import { startScheduler } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.raw({
  type: ['application/octet-stream', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  limit: '25mb'
}));

function getAppPublicUrl() {
  return process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : (process.env.APP_URL || `http://localhost:${PORT}`);
}

// ================= API ROUTES =================

// 1. Dashboard statistics
app.get('/api/stats', async (req, res) => {
  try {
    const nowIso = new Date().toISOString();

    const totalWords = await query('SELECT lang, COUNT(id) as count FROM words WHERE active = 1 GROUP BY lang');
    const dueWords = await query(`
      SELECT w.lang, COUNT(c.id) as count
      FROM srs_cards c
      JOIN words w ON c.word_id = w.id
      WHERE c.due <= ? AND w.active = 1
      GROUP BY w.lang
    `, [nowIso]);

    const stateStats = await query(`
      SELECT state, COUNT(id) as count
      FROM srs_cards
      GROUP BY state
    `);

    const reviewsCount = await query('SELECT COUNT(id) as total FROM study_logs');
    const lastSync = await getSetting('drive_last_sync');
    const lastFileName = await getSetting('drive_file_name');

    res.json({
      success: true,
      totals: totalWords,
      due: dueWords,
      states: stateStats,
      totalReviews: reviewsCount[0]?.total || 0,
      lastSync,
      lastFileName
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Words list with filters and pagination
app.get('/api/words', async (req, res) => {
  try {
    const { lang, tag, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const conditions = ['w.active = 1'];
    const params = [];

    if (lang && lang !== 'all') {
      conditions.push('w.lang = ?');
      params.push(lang.toLowerCase());
    }

    if (tag) {
      conditions.push('w.tags LIKE ?');
      params.push(`%${tag}%`);
    }

    if (search) {
      conditions.push('(w.word LIKE ? OR w.translation LIKE ? OR w.examples LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(w.id) as total FROM words w ${whereClause}`, params);
    const total = countRes[0]?.total || 0;

    const rows = await query(`
      SELECT w.*, c.state, c.due, c.stability, c.scheduled_days, c.reps, c.lapses, c.last_review
      FROM words w
      LEFT JOIN srs_cards c ON c.word_id = w.id
      ${whereClause}
      ORDER BY w.id ASC
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `, params);

    // Parse examples JSON for client
    const formatted = rows.map(r => {
      let ex = [];
      try { ex = JSON.parse(r.examples || '[]'); } catch (e) {}
      return { ...r, examples: ex };
    });

    res.json({
      success: true,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
      words: formatted
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Due study cards for session
app.get('/api/study/due', async (req, res) => {
  try {
    const { lang, limit = 30 } = req.query;
    const nowIso = new Date().toISOString();

    const conditions = ['w.active = 1', 'c.due <= ?'];
    const params = [nowIso];

    if (lang && lang !== 'all') {
      conditions.push('w.lang = ?');
      params.push(lang.toLowerCase());
    }

    let cards = await query(`
      SELECT w.*, c.state, c.due, c.stability, c.scheduled_days, c.reps, c.lapses, c.last_review
      FROM srs_cards c
      JOIN words w ON c.word_id = w.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.due ASC
      LIMIT ${parseInt(limit, 10)}
    `, params);

    // If fewer cards due than limit, fetch some new cards (state = 0)
    if (cards.length < parseInt(limit, 10)) {
      const remainingLimit = parseInt(limit, 10) - cards.length;
      const newConditions = ['w.active = 1', 'c.state = 0'];
      const newParams = [];

      if (lang && lang !== 'all') {
        newConditions.push('w.lang = ?');
        newParams.push(lang.toLowerCase());
      }

      const existingIds = cards.map(c => c.id);
      if (existingIds.length > 0) {
        newConditions.push(`w.id NOT IN (${existingIds.join(',')})`);
      }

      const newCards = await query(`
        SELECT w.*, c.state, c.due, c.stability, c.scheduled_days, c.reps, c.lapses, c.last_review
        FROM srs_cards c
        JOIN words w ON c.word_id = w.id
        WHERE ${newConditions.join(' AND ')}
        ORDER BY w.id ASC
        LIMIT ${remainingLimit}
      `, newParams);

      cards = cards.concat(newCards);
    }

    const formatted = cards.map(r => {
      let ex = [];
      try { ex = JSON.parse(r.examples || '[]'); } catch (e) {}
      return { ...r, examples: ex };
    });

    res.json({
      success: true,
      count: formatted.length,
      cards: formatted
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Submit study review
app.post('/api/study/review', async (req, res) => {
  try {
    const { wordId, rating } = req.body;
    if (!wordId || !rating || rating < 1 || rating > 4) {
      return res.status(400).json({ success: false, error: 'Parámetros inválidos (wordId y rating de 1 a 4 requeridos).' });
    }

    const cards = await query('SELECT * FROM srs_cards WHERE word_id = ?', [wordId]);
    if (!cards || cards.length === 0) {
      return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });
    }

    const card = cards[0];
    const next = calculateNextReview(card, rating);

    await execute(`
      UPDATE srs_cards
      SET state = ?, stability = ?, scheduled_days = ?, reps = ?, lapses = ?, last_review = ?, due = ?
      WHERE word_id = ?
    `, [next.state, next.stability, next.scheduled_days, next.reps, next.lapses, next.last_review, next.due, wordId]);

    await execute(`
      INSERT INTO study_logs (word_id, rating, review_time)
      VALUES (?, ?, ?)
    `, [wordId, rating, next.last_review]);

    res.json({
      success: true,
      card: next
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Wiktionary Lemma & Meanings Lookup
app.get('/api/words/:id/wiktionary', async (req, res) => {
  try {
    const wordId = req.params.id;
    const words = await query('SELECT lang, word FROM words WHERE id = ?', [wordId]);
    if (!words || words.length === 0) {
      return res.status(404).json({ success: false, error: 'Palabra no encontrada' });
    }

    const { lang, word } = words[0];
    const wikiData = await lookupWord(lang, word);

    res.json({
      success: true,
      data: wikiData
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Manual trigger for Google Drive Sync
app.post('/api/sync/drive', async (req, res) => {
  try {
    const result = await checkAndSyncDrive(true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Manual trigger for Local Workspace Excel Sync
app.post('/api/sync/local', async (req, res) => {
  try {
    // Find latest export-*.xls or .xlsx in ROOT_DIR or current directory
    const files = fs.readdirSync(ROOT_DIR).filter(f => f.startsWith('export-') && (f.endsWith('.xls') || f.endsWith('.xlsx')));
    if (files.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontró ningún archivo export-*.xls en el directorio de trabajo.' });
    }

    files.sort().reverse();
    const targetFile = path.join(ROOT_DIR, files[0]);
    console.log('[Sync] Importando archivo local:', targetFile);

    const stats = await importExcelFromFile(targetFile);
    await setSetting('drive_file_name', files[0]);
    await setSetting('drive_last_sync', new Date().toISOString());

    res.json({
      success: true,
      file: files[0],
      stats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Upload Excel directly from Web UI
app.post('/api/sync/upload', async (req, res) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ success: false, error: 'No se envió contenido de archivo binario válido.' });
    }

    const stats = await importExcelFromBuffer(req.body);
    await setSetting('drive_file_name', 'upload_manual.xlsx');
    await setSetting('drive_last_sync', new Date().toISOString());

    res.json({
      success: true,
      message: 'Archivo importado con éxito',
      stats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Trigger immediate test reminders (Calendar + Telegram)
app.post('/api/remind/now', async (req, res) => {
  try {
    const appUrl = getAppPublicUrl();
    const calRes = await syncDailyCalendarEvent(appUrl);
    const tgRes = await sendDailyTelegramReminder(appUrl);

    res.json({
      success: true,
      calendar: calRes,
      telegram: tgRes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Webhooks
app.post('/webhooks/drive', async (req, res) => {
  console.log('[Webhook Drive] Notificación recibida:', req.headers);
  res.status(200).send('OK');
  // Process asynchronously
  checkAndSyncDrive(false).catch(err => console.error('[Webhook Drive] Error:', err));
});

app.post('/webhooks/telegram', async (req, res) => {
  res.status(200).send('OK');
  if (req.body) {
    handleTelegramUpdate(req.body).catch(err => console.error('[Webhook Telegram] Error:', err));
  }
});

// Settings API
app.get('/api/settings', async (req, res) => {
  try {
    const reminderHour = await getSetting('reminder_hour', '9');
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || (await getSetting('drive_folder_id', ''));
    const calendarId = process.env.GOOGLE_CALENDAR_ID || (await getSetting('calendar_id', ''));
    const tgChatId = process.env.TELEGRAM_CHAT_ID || (await getSetting('telegram_chat_id', ''));
    const hasServiceAccount = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN);

    res.json({
      success: true,
      reminderHour,
      folderId,
      calendarId,
      tgChatId,
      hasServiceAccount,
      hasTelegram,
      appUrl: getAppPublicUrl()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { reminderHour, folderId, calendarId, tgChatId } = req.body;
    if (reminderHour !== undefined) await setSetting('reminder_hour', reminderHour);
    if (folderId !== undefined) await setSetting('drive_folder_id', folderId);
    if (calendarId !== undefined) await setSetting('calendar_id', calendarId);
    if (tgChatId !== undefined) await setSetting('telegram_chat_id', tgChatId);

    res.json({ success: true, message: 'Configuraciones guardadas' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend in production or build
const distPath = path.join(ROOT_DIR, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start Server
async function start() {
  await initDb();
  console.log('[Server] Base de datos lista.');

  // Auto-import local excel on first boot if DB is empty
  const wordCount = await query('SELECT COUNT(id) as total FROM words');
  if (!wordCount || wordCount[0].total === 0) {
    const excelFiles = fs.readdirSync(ROOT_DIR).filter(f => f.startsWith('export-') && (f.endsWith('.xls') || f.endsWith('.xlsx')));
    if (excelFiles.length > 0) {
      excelFiles.sort().reverse();
      const localFile = path.join(ROOT_DIR, excelFiles[0]);
      console.log(`[Server] Base de datos vacía. Importando automáticamente ${excelFiles[0]}...`);
      try {
        const stats = await importExcelFromFile(localFile);
        console.log('[Server] Importación inicial completada:', stats);
        await setSetting('drive_file_name', excelFiles[0]);
        await setSetting('drive_last_sync', new Date().toISOString());
      } catch (err) {
        console.error('[Server] Error en importación inicial:', err);
      }
    }
  }

  // Start Telegram bot polling if token exists
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startTelegramPolling();
  }

  // Start scheduler
  startScheduler(getAppPublicUrl);

  app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`🌐 URL pública configurada: ${getAppPublicUrl()}`);
  });
}

start().catch(err => {
  console.error('[Fatal] Error iniciando servidor:', err);
  process.exit(1);
});
