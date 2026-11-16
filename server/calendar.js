import { google } from 'googleapis';
import { getDriveAuth, getServiceAccountEmail } from './drive.js';
import { query, getSetting } from './db.js';
import { isReminderScheduledToday } from './scheduler.js';

let calendarClient = null;

export function getCalendarInstance() {
  if (calendarClient) return calendarClient;
  const auth = getDriveAuth();
  if (!auth) return null;
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

export async function getCalendarId() {
  const dbCalId = await getSetting('calendar_id');
  if (dbCalId && dbCalId.trim() !== '' && dbCalId.trim() !== 'primary') {
    return dbCalId.trim();
  }
  const envCalId = process.env.GOOGLE_CALENDAR_ID;
  if (envCalId && envCalId.trim() !== '' && envCalId.trim() !== 'primary') {
    return envCalId.trim();
  }
  return dbCalId || envCalId || null;
}

function getTargetEventDate(reminderHour, timeZone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(now);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const currentHour = parseInt(p.hour, 10);

  let d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let isTomorrow = false;
  if (currentHour >= reminderHour) {
    d.setUTCDate(d.getUTCDate() + 1);
    isTomorrow = true;
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { dateStr: `${y}-${m}-${day}`, isTomorrow, currentHour };
}

export async function syncDailyCalendarEvent(appUrl = '', force = false) {
  const calendar = getCalendarInstance();
  if (!calendar) {
    return { success: false, reason: 'Google Calendar no configurado (falta GOOGLE_SERVICE_ACCOUNT_KEY).' };
  }

  const timeZone = process.env.TIMEZONE || 'America/Bogota';

  if (!force) {
    const check = await isReminderScheduledToday(timeZone);
    if (!check.shouldRun) {
      return { success: true, skipped: true, message: check.reason };
    }
  }

  const calendarId = await getCalendarId();
  const reminderHour = parseInt(process.env.REMINDER_HOUR || (await getSetting('reminder_hour')) || '9', 10);
  const saEmail = getServiceAccountEmail();

  if (!calendarId || calendarId === 'primary') {
    return {
      success: false,
      reason: `Falta configurar tu correo personal de Gmail en "ID del Calendario" en Ajustes. Actualmente está vacío o en 'primary' (el calendario de servicio privado de ${saEmail || 'la cuenta de servicio'}). Debes escribir tu correo personal (ej. tu_correo@gmail.com).`
    };
  }

  try {
    // 1. Get due cards count by language
    const nowIso = new Date().toISOString();
    const rows = await query(`
      SELECT w.lang, COUNT(c.id) as count
      FROM srs_cards c
      JOIN words w ON c.word_id = w.id
      WHERE c.due <= ? AND w.active = 1
      GROUP BY w.lang
    `, [nowIso]);

    const totalDue = rows.reduce((acc, r) => acc + Number(r.count), 0);

    let eventTitle = '';
    let description = '';

    if (totalDue === 0) {
      eventTitle = '📚 Repaso Vocabulario (Al día / Práctica libre)';
      description = [
        '🎉 ¡Excelente! No tienes palabras pendientes de repaso acumuladas.',
        'Abre tu aplicación para repasar vocabulario nuevo o explorar el diccionario.',
        '',
        appUrl ? `🔗 Entrar a la app: ${appUrl}` : 'Abre tu aplicación para practicar.'
      ].join('\n');
    } else {
      const breakdown = rows.map(r => `${r.lang.toUpperCase()}: ${r.count}`).join(' · ');
      eventTitle = `📚 Repaso Vocabulario: ${totalDue} palabras (${breakdown})`;
      description = [
        `Tienes ${totalDue} palabras listas para repasar:`,
        breakdown,
        '',
        appUrl ? `🔗 Entrar a repasar: ${appUrl}` : 'Abre tu aplicación para completar tu sesión de hoy.'
      ].join('\n');
    }

    // Determine target date (today if before reminder hour, tomorrow if reminder hour already passed)
    const { dateStr, isTomorrow } = getTargetEventDate(reminderHour, timeZone);

    const hStr = String(reminderHour).padStart(2, '0');
    const startIso = `${dateStr}T${hStr}:00:00`;
    const endH = reminderHour + 1 > 23 ? 23 : reminderHour;
    const endM = reminderHour + 1 > 23 ? '59' : '30';
    const endIso = `${dateStr}T${String(endH).padStart(2, '0')}:${endM}:00`;

    // Search if an event already exists for that target date
    const dayStart = `${dateStr}T00:00:00Z`;
    const dayEnd = `${dateStr}T23:59:59Z`;

    const searchRes = await calendar.events.list({
      calendarId,
      timeMin: dayStart,
      timeMax: dayEnd,
      q: 'Repaso Vocabulario',
      singleEvents: true
    });

    const existingEvent = searchRes.data.items?.[0];

    let resultEvent;
    if (existingEvent) {
      // Update existing event
      const updateRes = await calendar.events.patch({
        calendarId,
        eventId: existingEvent.id,
        requestBody: {
          summary: eventTitle,
          description,
          start: { dateTime: startIso, timeZone },
          end: { dateTime: endIso, timeZone }
        }
      });
      resultEvent = updateRes.data;
      console.log(`[Calendar] Evento actualizado en ${calendarId} para ${dateStr} a las ${hStr}:00:`, eventTitle);
    } else {
      // Insert new event
      const insertRes = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventTitle,
          description,
          start: { dateTime: startIso, timeZone },
          end: { dateTime: endIso, timeZone },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 10 },
              { method: 'email', minutes: 30 }
            ]
          }
        }
      });
      resultEvent = insertRes.data;
      console.log(`[Calendar] Evento creado en ${calendarId} para ${dateStr} a las ${hStr}:00:`, eventTitle);
    }

    return {
      success: true,
      event: resultEvent,
      htmlLink: resultEvent.htmlLink,
      targetDate: dateStr,
      targetTime: `${hStr}:00`,
      isTomorrow,
      calendarId,
      message: `Evento agendado en Google Calendar para ${isTomorrow ? 'mañana' : 'hoy'} ${dateStr} a las ${hStr}:00.`
    };
  } catch (err) {
    console.error('[Calendar] Error al gestionar evento en Google Calendar:', err.message);
    const saEmail = getServiceAccountEmail();
    let detail = err.message;
    if (err.message.includes('Insufficient Permission') || err.message.includes('Not Found') || err.code === 404 || err.code === 403) {
      detail += ` | Solución: Si usas cuenta de servicio (${saEmail || 'tu-cuenta-de-servicio'}), debes compartir tu calendario de Google con ella dándole permiso de "Hacer cambios en eventos", y configurar tu correo en Calendar ID en Ajustes.`;
    }
    return { success: false, error: detail };
  }
}
