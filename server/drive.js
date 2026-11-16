import fs from 'node:fs';
import { google } from 'googleapis';
import { getSetting, setSetting } from './db.js';
import { importExcelFromBuffer } from './excel.js';

let driveClient = null;

export function sanitizeDriveFolderId(input) {
  if (!input || typeof input !== 'string') return '';
  let clean = input.trim();
  // If user pasted a full Google Drive URL: https://drive.google.com/drive/folders/1ABC_def-123...?usp=sharing
  const urlMatch = clean.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    clean = urlMatch[1];
  }
  // Strip quotes or trailing slashes
  clean = clean.replace(/^['"]|['"]$/g, '').replace(/\/$/, '').trim();
  return clean;
}

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
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events'
        ]
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

export function getServiceAccountEmail() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) return null;
  try {
    let credentials;
    if (serviceAccountKey.startsWith('{')) {
      credentials = JSON.parse(serviceAccountKey);
    } else if (fs.existsSync(serviceAccountKey)) {
      credentials = JSON.parse(fs.readFileSync(serviceAccountKey, 'utf-8'));
    }
    return credentials?.client_email || null;
  } catch (e) {
    return null;
  }
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

  const rawFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || (await getSetting('drive_folder_id'));
  const folderId = sanitizeDriveFolderId(rawFolderId);

  if (!folderId || folderId === '.' || folderId.length < 5) {
    return {
      success: false,
      error: `El ID de la carpeta de Google Drive configurado ("${rawFolderId || ''}") no es válido. Debe ser el identificador alfanumérico de tu carpeta de Google Drive (ej: 1AbCdEfGhIjKlMnOpQrStUvWxYz) o la URL completa de la carpeta compartida en Drive. Si pusiste "." pensando en la carpeta local, para sincronizar archivos locales usa la opción "Sincronizar archivo local" o sube tu archivo Excel directamente en la web.`
    };
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
    let errMsg = err.message || 'Error desconocido';
    if (errMsg.includes('File not found') || err.code === 404) {
      const saEmail = getServiceAccountEmail();
      errMsg = `No se encontró la carpeta en Google Drive (ID: "${folderId}"). Posibles causas: 1) El ID de la carpeta no existe. 2) La carpeta en Google Drive NO ha sido compartida con la cuenta de servicio (${saEmail || 'tu cuenta de servicio'}). Abre tu carpeta en Google Drive, dale Compartir y añade ese correo con permiso de Lector.`;
    }
    return { success: false, error: errMsg };
  }
}

// Watch changes on the folder via webhook
export async function setupDriveWatch(appPublicUrl) {
  const drive = getDriveInstance();
  if (!drive || !appPublicUrl) return null;

  const rawFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || (await getSetting('drive_folder_id'));
  const folderId = sanitizeDriveFolderId(rawFolderId);
  if (!folderId || folderId === '.' || folderId.length < 5) return null;

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
