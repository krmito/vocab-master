import { query, execute, getSetting, setSetting } from './db.js';
import { calculateNextReview } from './srs.js';

let pollingActive = false;
let lastUpdateId = 0;

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

export async function callTelegram(method, payload = {}) {
  const token = getBotToken();
  if (!token) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.warn(`[Telegram] Error calling ${method}:`, err.message);
    return null;
  }
}

export async function sendDailyTelegramReminder(appUrl = '') {
  const token = getBotToken();
  const chatId = process.env.TELEGRAM_CHAT_ID || (await getSetting('telegram_chat_id'));

  if (!token || !chatId) {
    return { success: false, reason: 'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID' };
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

  const breakdown = rows.map(r => `• *${r.lang.toUpperCase()}*: ${r.count} palabras`).join('\n');
  const message = `🔔 *¡Hora de repasar tu vocabulario!*\n\nTienes *${totalDue} palabras* listas para hoy:\n${breakdown}\n\n¿Quieres hacer un mini quiz rápido aquí o entrar a la web?`;

  const inline_keyboard = [
    [{ text: '🎯 Repasar aquí en Telegram', callback_data: 'start_quiz' }]
  ];
  if (appUrl) {
    inline_keyboard.push([{ text: '🌐 Abrir Web App', url: appUrl }]);
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard }
  });

  return { success: true, count: totalDue };
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

  let text = '📊 *Estado de tu vocabulario:*\n\n';
  for (const t of totalRows) {
    const due = dueRows.find(d => d.lang === t.lang)?.count || 0;
    text += `*${t.lang.toUpperCase()}*: ${t.total} palabras (${due} pendientes)\n`;
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
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
  let text = `🌍 *[${word.lang.toUpperCase()}]*  \`${word.word}\`\n`;
  if (word.transcription) text += `🗣️ /${word.transcription}/\n`;
  if (word.tags) text += `🏷️ _${word.tags}_\n`;
  text += '\n🤔 ¿Recuerdas qué significa?';

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
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

  let text = `🌍 *[${word.lang.toUpperCase()}]*  \`${word.word}\`\n`;
  if (word.transcription) text += `🗣️ /${word.transcription}/\n`;
  text += `\n📖 *Significado:*\n👉 ${word.translation}\n`;

  if (word.additional_translation) {
    text += `➕ _${word.additional_translation}_\n`;
  }

  if (examples.length > 0) {
    text += `\n💬 *Ejemplo:*\n"${examples[0].source}"\n↳ _${examples[0].translation}_\n`;
  }

  text += '\n¿Cómo te resultó recordarla?';

  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
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
    SET state = ?, stability = ?, scheduled_days = ?, reps = ?, lapses = ?, last_review = ?, due = ?
    WHERE word_id = ?
  `, [next.state, next.stability, next.scheduled_days, next.reps, next.lapses, next.last_review, next.due, wordId]);

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
    text: `✅ Calificación: *${ratingText}*.\nPróximo repaso programado: *${nextIntervalDesc}*.`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '➡️ Siguiente palabra', callback_data: 'quiz_next' }]
      ]
    }
  });
}

// Polling worker for local or direct use without webhook
export function startTelegramPolling() {
  const token = getBotToken();
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
