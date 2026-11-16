import cron from 'node-cron';
import { syncDailyCalendarEvent } from './calendar.js';
import { sendDailyTelegramReminder } from './telegram.js';
import { checkAndSyncDrive, setupDriveWatch } from './drive.js';
import { getSetting } from './db.js';

export function startScheduler(getAppUrl) {
  console.log('[Scheduler] Iniciando programador de recordatorios y sincronización...');

  // Every hour check: if current hour matches reminder_hour, trigger reminder once per day
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const targetHour = parseInt(process.env.REMINDER_HOUR || (await getSetting('reminder_hour')) || '9', 10);

      if (currentHour === targetHour) {
        const appUrl = getAppUrl();
        console.log(`[Scheduler] Ejecutando recordatorio diario programado para las ${targetHour}:00...`);
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
