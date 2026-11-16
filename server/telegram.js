import { query, execute, getSetting, setSetting } from './db.js';
import { calculateNextReview } from './srs.js';
import { isReminderScheduledToday } from './scheduler.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let pollingActive = false;
let lastUpdateId = 0;

export async function getBotToken() {
  const envToken = process.env.TELEGRAM_BOT_TOKEN
    || process.env.TELEGRAM_TOKEN
    || process.env.BOT_TOKEN
    || process.env.TG_BOT_TOKEN;
  const raw = envToken || (await getSetting('telegram_bot_token'));
  if (!raw) return null;
  return String(raw).replace(/^['"]|['"]$/g, '').trim();
}

export async function getChatId() {
  const envChatId = process.env.TELEGRAM_CHAT_ID
    || process.env.TELEGRAM_USER_ID
    || process.env.CHAT_ID
    || process.env.TG_CHAT_ID
    || process.env.TELEGRAM_CHATID;
  const raw = envChatId || (await getSetting('telegram_chat_id'));
  if (raw && String(raw).trim() !== '') {
    return String(raw).replace(/^['"]|['"]$/g, '').trim();
  }
  return null;
}

export async function callTelegram(method, payload = {}) {
  const token = await getBotToken();
  if (!token) return { ok: false, description: 'Falta configurar el Token del bot de Telegram' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`[Telegram API] Error in ${method}:`, data);
    }
    return data;
  } catch (err) {
    console.warn(`[Telegram] Error calling ${method}:`, err.message);
    return { ok: false, description: err.message };
  }
}

export async function sendDailyTelegramReminder(appUrl = '', force = false) {
  const token = await getBotToken();
  const chatId = await getChatId();

  if (!token || !chatId) {
    const missing = [];
    if (!token) missing.push('TELEGRAM_BOT_TOKEN (Token de BotFather)');
    if (!chatId) missing.push('TELEGRAM_CHAT_ID (Tu ID de usuario)');
    return {
      success: false,
      reason: `Falta configurar: ${missing.join(' y ')}. Asegúrate de que las variables estén en el servicio web en Railway (no en el servicio de Postgres) y de guardar los cambios.`
    };
  }

  if (!force) {
    const timeZone = process.env.TIMEZONE || 'America/Bogota';
    const check = await isReminderScheduledToday(timeZone);
    if (!check.shouldRun) {
      return { success: true, skipped: true, message: check.reason };
    }
  }

  const nowIso = new Date().toISOString();
  const rows = await query(`
    SELECT w.lang, COUNT(c.id) as count
    FROM srs_cards c
    JOIN words w ON c.word_id = w.id
    WHERE c.due <= ? AND w.active = 1
    GROUP BY w.lang
  `, [nowIso]);

  const totalDue = rows.reduce((acc, r) => acc + Number(r.count), 0);

  if (totalDue === 0) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '🎉 ¡Excelente! No tienes palabras pendientes de repaso hoy. ¡Todo al día!'
    });
    return { success: true, count: 0 };
  }

  const breakdown = rows.map(r => `• <b>${r.lang.toUpperCase()}</b>: ${r.count} palabras`).join('\n');
  const message = `🔔 <b>¡Hora de repasar tu vocabulario!</b>\n\nTienes <b>${totalDue} palabras</b> listas para hoy:\n${breakdown}\n\n¿Quieres hacer un mini quiz rápido aquí o entrar a la web?`;

  const inline_keyboard = [
    [{ text: '🎯 Repasar aquí en Telegram', callback_data: 'start_quiz' }]
  ];
  if (appUrl) {
    inline_keyboard.push([{ text: '🌐 Abrir Web App', url: appUrl }]);
  }

  const tgRes = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard }
  });

  if (!tgRes || !tgRes.ok) {
    console.error('[Telegram] Error enviando recordatorio:', tgRes);
    let errorDetail = tgRes?.description || 'No se pudo enviar el mensaje a Telegram';
    if (errorDetail.includes('chat not found') || errorDetail.includes('Forbidden') || tgRes?.error_code === 403 || tgRes?.error_code === 400) {
      errorDetail += ' (Asegúrate de haber abierto el bot en Telegram y haber pulsado INICIAR o enviado /start, y que tu Chat ID sea numérico).';
    }
    return { success: false, error: errorDetail, tgResponse: tgRes };
  }

  return { success: true, count: totalDue, messageId: tgRes.result?.message_id };
}

export async function handleTelegramUpdate(update) {
  if (update.message) {
    const { chat, text } = update.message;
    const chatId = chat.id;

    // Save chat ID automatically
    await setSetting('telegram_chat_id', chatId);

    if (text === '/start') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '👋 ¡Hola! Soy tu asistente de estudio de vocabulario.\n\nTe enviaré tus recordatorios diarios y puedes practicar directamente aquí o en tu web.',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📚 Repasar ahora', callback_data: 'quiz_next' }],
            [{ text: '📊 Estadísticas', callback_data: 'stats' }]
          ]
        }
      });
    } else if (text === '/repasar' || text === '/quiz') {
      await sendQuizCard(chatId);
    } else if (text === '/stats') {
      await sendStats(chatId);
    }
  } else if (update.callback_query) {
    const { id, message, data, from } = update.callback_query;
    const chatId = message.chat.id;
    const messageId = message.message_id;

    await callTelegram('answerCallbackQuery', { callback_query_id: id });

    if (data === 'start_quiz' || data === 'quiz_next') {
      await sendQuizCard(chatId);
    } else if (data.startsWith('reveal:')) {
      const wordId = parseInt(data.split(':')[1], 10);
      await revealQuizCard(chatId, messageId, wordId);
    } else if (data.startsWith('rate:')) {
      const parts = data.split(':');
      const wordId = parseInt(parts[1], 10);
      const rating = parseInt(parts[2], 10);
      await submitQuizRating(chatId, messageId, wordId, rating);
    } else if (data === 'stats') {
      await sendStats(chatId);
    }
  }
}

async function sendStats(chatId) {
  const nowIso = new Date().toISOString();
  const dueRows = await query(`
    SELECT w.lang, COUNT(c.id) as count
    FROM srs_cards c
    JOIN words w ON c.word_id = w.id
    WHERE c.due <= ? AND w.active = 1
    GROUP BY w.lang
  `, [nowIso]);

  const totalRows = await query(`
    SELECT lang, COUNT(id) as total FROM words WHERE active = 1 GROUP BY lang
  `);

  let text = '📊 <b>Estado de tu vocabulario:</b>\n\n';
  for (const t of totalRows) {
    const due = dueRows.find(d => d.lang === t.lang)?.count || 0;
    text += `<b>${t.lang.toUpperCase()}</b>: ${t.total} palabras (${due} pendientes)\n`;
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: '📚 Repasar', callback_data: 'quiz_next' }]]
    }
  });
}

async function sendQuizCard(chatId) {
  const nowIso = new Date().toISOString();
  // Find due card, or if none, any card
  let cards = await query(`
    SELECT w.id, w.lang, w.word, w.transcription, w.tags, c.state
    FROM srs_cards c
    JOIN words w ON c.word_id = w.id
    WHERE c.due <= ? AND w.active = 1
    ORDER BY c.due ASC
    LIMIT 1
  `, [nowIso]);

  if (!cards || cards.length === 0) {
    cards = await query(`
      SELECT w.id, w.lang, w.word, w.transcription, w.tags, c.state
      FROM srs_cards c
      JOIN words w ON c.word_id = w.id
      WHERE w.active = 1
      ORDER BY RANDOM()
      LIMIT 1
    `);
  }

  if (!cards || cards.length === 0) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'No tienes palabras registradas aún en el sistema.'
    });
    return;
  }

  const word = cards[0];
  let text = `🌍 <b>[${word.lang.toUpperCase()}]</b>  <code>${escapeHtml(word.word)}</code>\n`;
  if (word.transcription) text += `🗣️ /${escapeHtml(word.transcription)}/\n`;
  if (word.tags) text += `🏷️ <i>${escapeHtml(word.tags)}</i>\n`;
  text += '\n🤔 ¿Recuerdas qué significa?';

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👁️ Revelar significado', callback_data: `reveal:${word.id}` }]
      ]
    }
  });
}

async function revealQuizCard(chatId, messageId, wordId) {
  const rows = await query(`
    SELECT w.*, c.scheduled_days
    FROM words w
    JOIN srs_cards c ON c.word_id = w.id
    WHERE w.id = ?
  `, [wordId]);

  if (!rows || rows.length === 0) return;
  const word = rows[0];

  let examples = [];
  try { examples = JSON.parse(word.examples || '[]'); } catch (e) {}

  let text = `🌍 <b>[${word.lang.toUpperCase()}]</b>  <code>${escapeHtml(word.word)}</code>\n`;
  if (word.transcription) text += `🗣️ /${escapeHtml(word.transcription)}/\n`;
  text += `\n📖 <b>Significado:</b>\n👉 ${escapeHtml(word.translation)}\n`;

  if (word.additional_translation) {
    text += `➕ <i>${escapeHtml(word.additional_translation)}</i>\n`;
  }

  if (examples.length > 0) {
    text += `\n💬 <b>Ejemplo:</b>\n"${escapeHtml(examples[0].source)}"\n↳ <i>${escapeHtml(examples[0].translation || '')}</i>\n`;
  }

  text += '\n¿Cómo te resultó recordarla?';

  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Otra vez', callback_data: `rate:${word.id}:1` },
          { text: '😓 Difícil', callback_data: `rate:${word.id}:2` }
        ],
        [
          { text: '👍 Bien', callback_data: `rate:${word.id}:3` },
          { text: '⭐ Fácil', callback_data: `rate:${word.id}:4` }
        ]
      ]
    }
  });
}

async function submitQuizRating(chatId, messageId, wordId, rating) {
  const cards = await query('SELECT * FROM srs_cards WHERE word_id = ?', [wordId]);
  if (!cards || cards.length === 0) return;

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

  const ratingNames = { 1: '🔄 Otra vez (en breve)', 2: '😓 Difícil (+1 día)', 3: '👍 Bien', 4: '⭐ Fácil' };
  const ratingText = ratingNames[rating] || 'Guardado';

  let nextIntervalDesc = next.scheduled_days === 0 ? 'hoy en 10 min' : `en ${next.scheduled_days} día(s)`;

  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `✅ Calificación: <b>${ratingText}</b>.\nPróximo repaso programado: <b>${nextIntervalDesc}</b>.`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '➡️ Siguiente palabra', callback_data: 'quiz_next' }]
      ]
    }
  });
}

// Polling worker for local or direct use without webhook
export async function startTelegramPolling() {
  const token = await getBotToken();
  if (!token || pollingActive) return;

  pollingActive = true;
  console.log('[Telegram] Iniciando sondeo de mensajes (polling)...');

  const poll = async () => {
    if (!pollingActive) return;
    try {
      const res = await callTelegram('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 25
      });
      if (res && res.result && Array.isArray(res.result)) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          await handleTelegramUpdate(update);
        }
      }
    } catch (e) {
      // transient network wait
    }
    if (pollingActive) {
      setTimeout(poll, 1500);
    }
  };

  poll();
}

export async function detectChatIdFromBot() {
  const token = await getBotToken();
  if (!token) {
    return { success: false, error: 'Falta configurar TELEGRAM_BOT_TOKEN primero en Ajustes.' };
  }

  // Call getUpdates to see recent incoming messages to this bot
  const res = await callTelegram('getUpdates', { limit: 15 });
  if (!res || !res.ok) {
    return { success: false, error: res?.description || 'Error al comunicarse con Telegram' };
  }

  const updates = res.result || [];
  if (updates.length === 0) {
    return {
      success: false,
      error: 'No hay mensajes recientes en tu bot. Entra a tu bot en Telegram, envíale cualquier mensaje (ej: /start o hola) y vuelve a presionar este botón.'
    };
  }

  // Look from newest to oldest for a message
  let found = null;
  for (let i = updates.length - 1; i >= 0; i--) {
    const msg = updates[i].message || updates[i].channel_post;
    if (msg && msg.chat && msg.chat.id) {
      found = msg.chat;
      break;
    }
  }

  if (!found) {
    return { success: false, error: 'No se pudo encontrar el Chat ID en los mensajes recibidos.' };
  }

  await setSetting('telegram_chat_id', String(found.id));

  // Send a greeting to confirm
  await callTelegram('sendMessage', {
    chat_id: found.id,
    text: `🎉 <b>¡Conexión exitosa!</b> Hola ${found.first_name || ''}, tu bot de vocabulario ha sido vinculado correctamente.`,
    parse_mode: 'HTML'
  });

  return {
    success: true,
    chatId: found.id,
    name: found.first_name || found.username || 'Usuario',
    message: `¡Chat ID detectado y guardado (${found.id})! Te enviamos un saludo a Telegram para confirmar.`
  };
}
