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

  const calendarId = process.env.GOOGLE_CALENDAR_ID || (await getSetting('calendar_id')) || 'primary';
  const reminderHour = parseInt(process.env.REMINDER_HOUR || (await getSetting('reminder_hour')) || '9', 10);
  const timeZone = process.env.TIMEZONE || 'America/Bogota';

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

    // Today's date in local target
    const today = new Date();
    const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), reminderHour, 0, 0);
    const endTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), reminderHour, 30, 0);

    const description = [
      `Tienes ${totalDue} palabras listas para repasar hoy:`,
      breakdown,
      '',
      appUrl ? `🔗 Entrar a repasar: ${appUrl}` : 'Abre tu aplicación para completar tu sesión de hoy.'
    ].join('\n');

    // Search if an event already exists for today
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0).toISOString();
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();

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
          start: { dateTime: startTime.toISOString(), timeZone },
          end: { dateTime: endTime.toISOString(), timeZone }
        }
      });
      resultEvent = updateRes.data;
      console.log('[Calendar] Evento actualizado:', eventTitle);
    } else {
      // Insert new event
      const insertRes = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventTitle,
          description,
          start: { dateTime: startTime.toISOString(), timeZone },
          end: { dateTime: endTime.toISOString(), timeZone },
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
      console.log('[Calendar] Evento creado:', eventTitle);
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
