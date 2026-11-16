import { google } from 'googleapis';
import { getDriveAuth, getServiceAccountEmail } from './drive.js';
import { query, getSetting } from './db.js';

let calendarClient = null;

export function getCalendarInstance() {
  if (calendarClient) return calendarClient;
  const auth = getDriveAuth();
  if (!auth) return null;
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

export async function syncDailyCalendarEvent(appUrl = '') {
  const calendar = getCalendarInstance();
  if (!calendar) {
    return { success: false, reason: 'Google Calendar no configurado (falta cuenta de servicio).' };
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID || (await getSetting('calendar_id'));
  const reminderHour = parseInt(process.env.REMINDER_HOUR || (await getSetting('reminder_hour')) || '9', 10);
  const timeZone = process.env.TIMEZONE || 'America/Bogota';
  const saEmail = getServiceAccountEmail();

  if (!calendarId || calendarId === 'primary') {
    return {
      success: false,
      reason: `Falta configurar tu correo de Gmail en "ID del Calendario" en la pestaña Ajustes (actualmente está vacío o en 'primary', por lo que el evento se creó en el calendario privado de ${saEmail || 'la cuenta de servicio'} en vez de tu Google Calendar personal).`
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

    if (totalDue === 0) {
      return { success: true, message: 'No hay palabras pendientes para hoy, no se requiere evento.' };
    }

    const breakdown = rows.map(r => `${r.lang.toUpperCase()}: ${r.count}`).join(' · ');
    const eventTitle = `📚 Repaso Vocabulario: ${totalDue} palabras (${breakdown})`;

    // Today's date in target time zone: YYYY-MM-DD
    const nowTarget = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const localDateStr = formatter.format(nowTarget); // YYYY-MM-DD

    const hStr = String(reminderHour).padStart(2, '0');
    const startIso = `${localDateStr}T${hStr}:00:00`;
    const endH = reminderHour + 1 > 23 ? 23 : reminderHour;
    const endM = reminderHour + 1 > 23 ? '59' : '30';
    const endIso = `${localDateStr}T${String(endH).padStart(2, '0')}:${endM}:00`;

    const description = [
      `Tienes ${totalDue} palabras listas para repasar hoy:`,
      breakdown,
      '',
      appUrl ? `🔗 Entrar a repasar: ${appUrl}` : 'Abre tu aplicación para completar tu sesión de hoy.'
    ].join('\n');

    // Search if an event already exists for today
    const dayStart = `${localDateStr}T00:00:00Z`;
    const dayEnd = `${localDateStr}T23:59:59Z`;

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
      console.log('[Calendar] Evento actualizado en Google Calendar:', eventTitle);
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
      console.log('[Calendar] Evento creado en Google Calendar:', eventTitle);
    }

    return { success: true, event: resultEvent };
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
