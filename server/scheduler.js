import cron from 'node-cron';
import { syncDailyCalendarEvent } from './calendar.js';
import { sendDailyTelegramReminder } from './telegram.js';
import { checkAndSyncDrive, setupDriveWatch } from './drive.js';
import { getSetting } from './db.js';

/**
 * Returns current date, hour, and day of week in the configured timezone (e.g. America/Bogota)
 */
export function getLocalTimeInfo(timeZone = 'America/Bogota') {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short'
  });
  const parts = formatter.formatToParts(now);
  const partObj = {};
  for (const p of parts) partObj[p.type] = p.value;

  const localDate = `${partObj.year}-${partObj.month}-${partObj.day}`;
  const currentHour = parseInt(partObj.hour, 10);
  const weekday = partObj.weekday; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  return { localDate, currentHour, weekday, isWeekend };
}

/**
 * Checks if reminders should run today according to user preferences:
 * 1. Days of week: all (Monday-Sunday) vs weekdays (Monday-Friday)
 * 2. Date range: unlimited vs specific start/end dates
 */
export async function isReminderScheduledToday(timeZone = 'America/Bogota') {
  const { localDate, weekday, isWeekend } = getLocalTimeInfo(timeZone);

  // 1. Check days of week
  const reminderDays = await getSetting('reminder_days', 'all');
  if (reminderDays === 'weekdays' && isWeekend) {
    return {
      shouldRun: false,
      reason: `Hoy es ${weekday} (fin de semana) y la frecuencia está configurada en "De lunes a viernes".`
    };
  }

  // 2. Check date range
  const rangeType = await getSetting('reminder_range_type', 'unlimited');
  if (rangeType === 'range') {
    const startDate = await getSetting('reminder_start_date', '');
    const endDate = await getSetting('reminder_end_date', '');

    if (startDate && localDate < startDate) {
      return {
        shouldRun: false,
        reason: `Hoy (${localDate}) es anterior a la fecha de inicio configurada (${startDate}).`
      };
    }
    if (endDate && localDate > endDate) {
      return {
        shouldRun: false,
        reason: `Hoy (${localDate}) es posterior a la fecha límite configurada (${endDate}).`
      };
    }
  }

  return { shouldRun: true, localDate, weekday };
}

export function startScheduler(getAppUrl) {
  console.log('[Scheduler] Iniciando programador de recordatorios y sincronización...');

  // Check every hour: if current local hour matches reminder_hour and date/day rules match
  cron.schedule('0 * * * *', async () => {
    try {
      const timeZone = process.env.TIMEZONE || 'America/Bogota';
      const { localDate, currentHour } = getLocalTimeInfo(timeZone);
      const targetHour = parseInt(process.env.REMINDER_HOUR || (await getSetting('reminder_hour')) || '9', 10);

      if (currentHour === targetHour) {
        const check = await isReminderScheduledToday(timeZone);
        if (!check.shouldRun) {
          console.log(`[Scheduler] Omitiendo recordatorio de hoy (${localDate}): ${check.reason}`);
          return;
        }

        const appUrl = getAppUrl();
        console.log(`[Scheduler] Ejecutando recordatorio diario (${targetHour}:00, ${localDate})...`);
        await syncDailyCalendarEvent(appUrl);
        await sendDailyTelegramReminder(appUrl);
      }
    } catch (err) {
      console.error('[Scheduler] Error en tarea horaria:', err);
    }
  });

  // Once a day at 03:00 AM: renew Google Drive webhook watch & failsafe check
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[Scheduler] Ejecutando verificación nocturna de Drive y renovación de webhook...');
      await checkAndSyncDrive(false);
      const appUrl = getAppUrl();
      if (appUrl && appUrl.startsWith('https://')) {
        await setupDriveWatch(appUrl);
      }
    } catch (err) {
      console.error('[Scheduler] Error en mantenimiento nocturno:', err);
    }
  });
}
