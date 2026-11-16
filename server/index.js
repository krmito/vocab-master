import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initDb, query, execute, getSetting, setSetting, getDbInfo } from './db.js';
import { importExcelFromFile, importExcelFromBuffer } from './excel.js';
import { calculateNextReview } from './srs.js';
import { lookupWord } from './wiktionary.js';
import { getWordImage, searchImageCandidates, setWordImage, clearImageCache } from './images.js';
import { checkAndSyncDrive, setupDriveWatch, getServiceAccountEmail, sanitizeDriveFolderId } from './drive.js';
import { syncDailyCalendarEvent } from './calendar.js';
import { sendDailyTelegramReminder, handleTelegramUpdate, startTelegramPolling, getBotToken, detectChatIdFromBot } from './telegram.js';
import { startScheduler } from './scheduler.js';
import { enrichWordInDb, enrichAllMissingExamples } from './examples.js';

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

    const ratingStats = await query(`
      SELECT CAST(COALESCE(difficulty, 0) AS INTEGER) as rating, COUNT(id) as count
      FROM srs_cards
      GROUP BY CAST(COALESCE(difficulty, 0) AS INTEGER)
    `);

    const reviewsCount = await query('SELECT COUNT(id) as total FROM study_logs');
    const lastSync = await getSetting('drive_last_sync');
    const lastFileName = await getSetting('drive_file_name');

    // Get all distinct tags across words
    const tagsRows = await query(`
      SELECT DISTINCT tags FROM words WHERE active = 1 AND tags IS NOT NULL AND tags != ''
    `);
    const allTags = new Set();
    for (const row of tagsRows) {
      if (row.tags) {
        row.tags.split(';').map(t => t.trim()).filter(Boolean).forEach(t => allTags.add(t));
      }
    }

    const totalReviews = parseInt(reviewsCount[0]?.total || 0, 10);
    const dbInfo = getDbInfo();

    res.json({
      success: true,
      totals: totalWords,
      due: dueWords,
      states: stateStats,
      ratings: ratingStats,
      totalReviews,
      tags: Array.from(allTags).sort(),
      dbInfo,
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
    const { lang, tag, search, rating, page = 1, limit = 50 } = req.query;
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

    if (rating && rating !== 'all') {
      if (rating === 'hard') {
        conditions.push('c.difficulty IN (1, 2)');
      } else if (rating === 'easy') {
        conditions.push('c.difficulty = 4');
      } else if (rating === 'new') {
        conditions.push('(c.difficulty IS NULL OR c.difficulty = 0) AND (c.reps IS NULL OR c.reps = 0)');
      } else if (rating === 'reviewed') {
        conditions.push('(c.difficulty > 0 OR c.reps > 0)');
      } else if (['1', '2', '3', '4'].includes(String(rating))) {
        conditions.push('c.difficulty = ?');
        params.push(parseInt(rating, 10));
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`
      SELECT COUNT(w.id) as total
      FROM words w
      LEFT JOIN srs_cards c ON c.word_id = w.id
      ${whereClause}
    `, params);
    const total = parseInt(countRes[0]?.total || 0, 10);

    const rows = await query(`
      SELECT w.*, c.state, c.due, c.stability, c.difficulty, c.scheduled_days, c.reps, c.lapses, c.last_review
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

// 3. Study cards for session (with difficulty/rating filters, custom IDs, or full deck)
app.get('/api/study/due', async (req, res) => {
  try {
    const { lang, tag, filter = 'due', ids, limit = 50 } = req.query;
    const nowIso = new Date().toISOString();
    const parsedLimit = (limit === 'all' || parseInt(limit, 10) === 0) ? 5000 : (parseInt(limit, 10) || 50);

    // Custom selected word IDs mode
    if (ids && String(ids).trim()) {
      const idList = String(ids)
        .split(',')
        .map(x => parseInt(x.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);

      if (idList.length > 0) {
        const customCards = await query(`
          SELECT w.*, c.state, c.due, c.stability, c.difficulty, c.scheduled_days, c.reps, c.lapses, c.last_review
          FROM srs_cards c
          JOIN words w ON c.word_id = w.id
          WHERE w.active = 1 AND w.id IN (${idList.join(',')})
          ORDER BY w.id ASC
        `);
        const formattedCustom = customCards.map(r => {
          let ex = [];
          try { ex = JSON.parse(r.examples || '[]'); } catch (e) {}
          return { ...r, examples: ex };
        });
        return res.json({
          success: true,
          count: formattedCustom.length,
          cards: formattedCustom
        });
      }
    }

    const baseConditions = ['w.active = 1'];
    const baseParams = [];

    if (lang && lang !== 'all') {
      baseConditions.push('w.lang = ?');
      baseParams.push(lang.toLowerCase());
    }

    if (tag) {
      baseConditions.push('w.tags LIKE ?');
      baseParams.push(`%${tag}%`);
    }

    let cards = [];

    if (filter === 'due') {
      // Standard SRS mode: due cards first, then fill with new cards
      const dueConditions = [...baseConditions, 'c.due <= ?'];
      const dueParams = [...baseParams, nowIso];

      cards = await query(`
        SELECT w.*, c.state, c.due, c.stability, c.difficulty, c.scheduled_days, c.reps, c.lapses, c.last_review
        FROM srs_cards c
        JOIN words w ON c.word_id = w.id
        WHERE ${dueConditions.join(' AND ')}
        ORDER BY c.due ASC
        LIMIT ${parsedLimit}
      `, dueParams);

      if (cards.length < parsedLimit) {
        const remainingLimit = parsedLimit - cards.length;
        const newConditions = [...baseConditions, 'c.state = 0'];
        const existingIds = cards.map(c => c.id);
        if (existingIds.length > 0) {
          newConditions.push(`w.id NOT IN (${existingIds.join(',')})`);
        }

        const newCards = await query(`
          SELECT w.*, c.state, c.due, c.stability, c.difficulty, c.scheduled_days, c.reps, c.lapses, c.last_review
          FROM srs_cards c
          JOIN words w ON c.word_id = w.id
          WHERE ${newConditions.join(' AND ')}
          ORDER BY w.id ASC
          LIMIT ${remainingLimit}
        `, baseParams);

        cards = cards.concat(newCards);
      }
    } else {
      // Filtered mode (regardless of due date!)
      const filterConditions = [...baseConditions];
      const filterParams = [...baseParams];
      let orderBy = 'w.id ASC';

      if (filter === 'hard') {
        filterConditions.push('c.difficulty IN (1, 2)');
        orderBy = 'c.difficulty ASC, c.last_review DESC';
      } else if (filter === 'rating_1') {
        filterConditions.push('c.difficulty = 1');
        orderBy = 'c.last_review DESC';
      } else if (filter === 'rating_2') {
        filterConditions.push('c.difficulty = 2');
        orderBy = 'c.last_review DESC';
      } else if (filter === 'rating_3') {
        filterConditions.push('c.difficulty = 3');
        orderBy = 'c.last_review DESC';
      } else if (filter === 'easy' || filter === 'rating_4') {
        filterConditions.push('c.difficulty = 4');
        orderBy = 'c.last_review DESC';
      } else if (filter === 'reviewed') {
        filterConditions.push('(c.difficulty > 0 OR c.reps > 0)');
        orderBy = 'c.last_review DESC';
      } else if (filter === 'new') {
        filterConditions.push('(c.difficulty IS NULL OR c.difficulty = 0) AND (c.reps IS NULL OR c.reps = 0)');
        orderBy = 'w.id ASC';
      } else if (filter === 'all') {
        orderBy = 'w.id ASC';
      }

      cards = await query(`
        SELECT w.*, c.state, c.due, c.stability, c.difficulty, c.scheduled_days, c.reps, c.lapses, c.last_review
        FROM srs_cards c
        JOIN words w ON c.word_id = w.id
        WHERE ${filterConditions.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT ${parsedLimit}
      `, filterParams);
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
      SET state = ?, stability = ?, difficulty = ?, scheduled_days = ?, reps = ?, lapses = ?, last_review = ?, due = ?
      WHERE word_id = ?
    `, [next.state, next.stability, rating, next.scheduled_days, next.reps, next.lapses, next.last_review, next.due, wordId]);

    await execute(`
      INSERT INTO study_logs (word_id, rating, review_time)
      VALUES (?, ?, ?)
    `, [wordId, rating, next.last_review]);

    res.json({
      success: true,
      card: { ...next, difficulty: rating }
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

// 5b. Word Illustrative Image
app.get('/api/words/:id/image', async (req, res) => {
  try {
    const wordId = req.params.id;
    const words = await query('SELECT lang, word, translation, tags FROM words WHERE id = ?', [wordId]);
    if (!words || words.length === 0) {
      return res.status(404).json({ success: false, error: 'Palabra no encontrada' });
    }

    const { lang, word, translation, tags } = words[0];
    const imgResult = await getWordImage(word, lang, translation, tags);

    res.json(imgResult);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5c. Search candidate images for a word
app.get('/api/words/:id/image/candidates', async (req, res) => {
  try {
    const wordId = req.params.id;
    const { q } = req.query;
    const words = await query('SELECT lang, word, translation, tags FROM words WHERE id = ?', [wordId]);
    if (!words || words.length === 0) {
      return res.status(404).json({ success: false, error: 'Palabra no encontrada' });
    }

    const { lang, word, translation } = words[0];
    const candidates = await searchImageCandidates(word, translation, lang, q);
    res.json({ success: true, candidates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5d. Set / override image for a word
app.post('/api/words/:id/image', async (req, res) => {
  try {
    const wordId = req.params.id;
    const { imageUrl } = req.body;
    const words = await query('SELECT word FROM words WHERE id = ?', [wordId]);
    if (!words || words.length === 0) {
      return res.status(404).json({ success: false, error: 'Palabra no encontrada' });
    }

    const result = await setWordImage(words[0].word, imageUrl);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5e. Remove image for a word
app.delete('/api/words/:id/image', async (req, res) => {
  try {
    const wordId = req.params.id;
    const words = await query('SELECT word FROM words WHERE id = ?', [wordId]);
    if (!words || words.length === 0) {
      return res.status(404).json({ success: false, error: 'Palabra no encontrada' });
    }

    const result = await setWordImage(words[0].word, 'none');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5f. Clear image cache entirely
app.post('/api/images/clear-cache', async (req, res) => {
  try {
    const result = await clearImageCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5g. Enrich single word with bilingual examples
app.post('/api/words/:id/enrich-examples', async (req, res) => {
  try {
    const wordId = req.params.id;
    const result = await enrichWordInDb(wordId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5h. Check status of words missing examples
app.get('/api/words/enrich-examples/status', async (req, res) => {
  try {
    const countRes = await query(`
      SELECT lang, COUNT(id) as count
      FROM words
      WHERE active = 1 AND (examples IS NULL OR examples = '' OR examples = '[]' OR examples = 'null')
      GROUP BY lang
    `);
    const totalRes = await query(`
      SELECT COUNT(id) as total
      FROM words
      WHERE active = 1 AND (examples IS NULL OR examples = '' OR examples = '[]' OR examples = 'null')
    `);
    res.json({
      success: true,
      totalMissing: parseInt(totalRes[0]?.total || 0, 10),
      byLanguage: countRes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5i. Trigger background enrichment for all missing examples
app.post('/api/words/enrich-examples', async (req, res) => {
  try {
    const limit = parseInt(req.body?.limit || 200, 10);
    const result = await enrichAllMissingExamples(limit);
    res.json(result);
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

// 9b. Auto-detect Telegram Chat ID from incoming message
app.post('/api/telegram/detect', async (req, res) => {
  try {
    const result = await detectChatIdFromBot();
    res.json(result);
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
    const tgBotToken = process.env.TELEGRAM_BOT_TOKEN ? '********' : (await getSetting('telegram_bot_token', ''));
    const tgChatId = process.env.TELEGRAM_CHAT_ID || (await getSetting('telegram_chat_id', ''));
    const hasServiceAccount = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const serviceAccountEmail = getServiceAccountEmail();
    const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN || (await getSetting('telegram_bot_token')));

    res.json({
      success: true,
      reminderHour,
      folderId,
      calendarId,
      tgBotToken: tgBotToken ? (tgBotToken.length > 8 ? tgBotToken.slice(0, 4) + '...' + tgBotToken.slice(-4) : '******') : '',
      tgChatId,
      hasServiceAccount,
      serviceAccountEmail,
      hasTelegram,
      appUrl: getAppPublicUrl()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { reminderHour, folderId, calendarId, tgBotToken, tgChatId } = req.body;
    if (reminderHour !== undefined) await setSetting('reminder_hour', reminderHour);
    if (folderId !== undefined) {
      const cleanFolder = sanitizeDriveFolderId(folderId);
      await setSetting('drive_folder_id', cleanFolder);
    }
    if (calendarId !== undefined) await setSetting('calendar_id', calendarId);
    if (tgBotToken !== undefined && tgBotToken.trim() !== '' && !tgBotToken.includes('...')) {
      await setSetting('telegram_bot_token', tgBotToken.trim());
      // Start telegram polling if not already running
      startTelegramPolling();
    }
    if (tgChatId !== undefined) await setSetting('telegram_chat_id', tgChatId.trim());

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

  // Backfill last rating (difficulty) from study_logs if needed
  try {
    await execute(`
      UPDATE srs_cards
      SET difficulty = (
        SELECT l.rating FROM study_logs l
        WHERE l.word_id = srs_cards.word_id
        ORDER BY l.id DESC LIMIT 1
      )
      WHERE (difficulty IS NULL OR difficulty = 0) AND EXISTS (
        SELECT 1 FROM study_logs l WHERE l.word_id = srs_cards.word_id
      )
    `);
  } catch (e) {}

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
  const tgToken = await getBotToken();
  if (tgToken) {
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
