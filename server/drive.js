import fs from 'node:fs';
import { google } from 'googleapis';
import { getSetting, setSetting } from './db.js';
import { importExcelFromBuffer } from './excel.js';

let driveClient = null;

export function getDriveAuth() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    let credentials;
    if (serviceAccountKey.startsWith('{')) {
      credentials = JSON.parse(serviceAccountKey);
    } else if (fs.existsSync(serviceAccountKey)) {
      credentials = JSON.parse(fs.readFileSync(serviceAccountKey, 'utf-8'));
    }

    if (credentials) {
      return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });
    }
  }

  // Fallback to OAuth2 if refresh token is provided
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return oAuth2Client;
  }

  return null;
}

export function getDriveInstance() {
  if (driveClient) return driveClient;
  const auth = getDriveAuth();
  if (!auth) return null;
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

export async function checkAndSyncDrive(force = false) {
  const drive = getDriveInstance();
  if (!drive) {
    return { success: false, reason: 'Google Drive no está configurado (falta GOOGLE_SERVICE_ACCOUNT_KEY).' };
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || (await getSetting('drive_folder_id'));
  if (!folderId) {
    return { success: false, reason: 'Falta configurar GOOGLE_DRIVE_FOLDER_ID.' };
  }

  try {
    // 1. List files in folder
    const q = `'${folderId}' in parents and (mimeType = 'application/vnd.ms-excel' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xls' or name contains '.xlsx') and trashed = false`;
    const listRes = await drive.files.list({
      q,
      fields: 'files(id, name, modifiedTime, size)',
      orderBy: 'modifiedTime desc',
      pageSize: 5
    });

    const files = listRes.data.files || [];
    if (files.length === 0) {
      return { success: false, reason: 'No se encontraron archivos Excel (.xls / .xlsx) en la carpeta de Drive.' };
    }

    const latestFile = files[0];
    const lastModified = await getSetting('drive_file_modified_time');

    if (!force && lastModified === latestFile.modifiedTime) {
      return {
        success: true,
        updated: false,
        message: 'El archivo en Drive no ha cambiado desde la última sincronización.',
        fileName: latestFile.name,
        lastModified
      };
    }

    console.log(`[Drive] Descargando archivo actualizado: ${latestFile.name} (Modificado: ${latestFile.modifiedTime})`);

    // 2. Download file buffer
    const fileRes = await drive.files.get(
      { fileId: latestFile.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(fileRes.data);

    // 3. Process workbook
    const stats = await importExcelFromBuffer(buffer);

    // 4. Update sync settings
    await setSetting('drive_file_id', latestFile.id);
    await setSetting('drive_file_name', latestFile.name);
    await setSetting('drive_file_modified_time', latestFile.modifiedTime);
    await setSetting('drive_last_sync', new Date().toISOString());

    return {
      success: true,
      updated: true,
      fileName: latestFile.name,
      modifiedTime: latestFile.modifiedTime,
      stats
    };
  } catch (err) {
    console.error('[Drive] Error durante sincronización:', err);
    return { success: false, error: err.message };
  }
}

// Watch changes on the folder via webhook
export async function setupDriveWatch(appPublicUrl) {
  const drive = getDriveInstance();
  if (!drive || !appPublicUrl) return null;

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || (await getSetting('drive_folder_id'));
  if (!folderId) return null;

  try {
    const channelId = `drive-watch-${Date.now()}`;
    const webhookUrl = `${appPublicUrl.replace(/\/$/, '')}/api/webhooks/drive`;

    const res = await drive.files.watch({
      fileId: folderId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        // Expire in 7 days (Google max)
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    await setSetting('drive_channel_id', channelId);
    await setSetting('drive_resource_id', res.data.resourceId);
    console.log('[Drive] Webhook registrado exitosamente:', webhookUrl, res.data);
    return res.data;
  } catch (err) {
    console.warn('[Drive] No se pudo registrar webhook (normal si no hay URL pública HTTPS):', err.message);
    return null;
  }
}
