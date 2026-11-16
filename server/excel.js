import xlsxModule from 'xlsx';
const XLSX = xlsxModule.readFile ? xlsxModule : (xlsxModule.default || xlsxModule);
import { query, execute, getDb } from './db.js';

export function parseExamples(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result = [];
  for (const line of lines) {
    const parts = line.split(/\s*—\s*|\s*--\s*/);
    if (parts.length >= 2) {
      result.push({
        source: parts[0].trim(),
        translation: parts.slice(1).join(' — ').trim()
      });
    } else {
      result.push({
        source: line,
        translation: ''
      });
    }
  }
  return result;
}

export async function importExcelFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return await processWorkbook(workbook);
}

export async function importExcelFromFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  return await processWorkbook(workbook);
}

async function processWorkbook(workbook) {
  const stats = {
    totalWords: 0,
    added: 0,
    updated: 0,
    sheets: {}
  };

  const { isPostgres, db } = getDb();
  const nowIso = new Date().toISOString();

  // Begin transaction if possible for massive speedup
  if (!isPostgres) {
    db.exec('BEGIN TRANSACTION;');
  }

  try {
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);
      const lang = sheetName.trim().toLowerCase();
      stats.sheets[lang] = rows.length;

      for (const row of rows) {
        const rawWord = row.Word || row.word || row['Palabra'];
        if (!rawWord || typeof rawWord !== 'string') continue;
        const word = rawWord.trim();
        if (!word) continue;

        const transcription = String(row.Transcription || row.transcription || '').trim();
        const translation = String(row.Translation || row.translation || '').trim();
        const addTranslation = String(row['Additional translation'] || row.additional_translation || '').trim();
        const tags = String(row.Tags || row.tags || '').trim();
        const rawExamples = String(row.Examples || row.examples || '');
        const examplesJson = JSON.stringify(parseExamples(rawExamples));

        stats.totalWords++;

        // Check if word exists
        const existing = await query('SELECT id FROM words WHERE lang = ? AND word = ?', [lang, word]);

        if (existing && existing.length > 0) {
          const wordId = existing[0].id;
          await execute(`
            UPDATE words 
            SET transcription = ?, translation = ?, additional_translation = ?, tags = ?, examples = ?, active = 1, updated_at = ?
            WHERE id = ?
          `, [transcription, translation, addTranslation, tags, examplesJson, nowIso, wordId]);
          stats.updated++;
        } else {
          // Insert new word
          const insertRes = await execute(`
            INSERT INTO words (lang, word, transcription, translation, additional_translation, tags, examples, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `, [lang, word, transcription, translation, addTranslation, tags, examplesJson, nowIso, nowIso]);

          let newId = insertRes.lastInsertRowid;
          if (!newId) {
            const check = await query('SELECT id FROM words WHERE lang = ? AND word = ?', [lang, word]);
            newId = check[0]?.id;
          }

          if (newId) {
            // Create SRS card for this new word
            await execute(`
              INSERT INTO srs_cards (word_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses)
              VALUES (?, 0, ?, 2.5, 0, 0, 0, 0, 0)
            `, [newId, nowIso]);
            stats.added++;
          }
        }
      }
    }

    if (!isPostgres) {
      db.exec('COMMIT;');
    }
  } catch (err) {
    if (!isPostgres) {
      try { db.exec('ROLLBACK;'); } catch (e) {}
    }
    throw err;
  }

  return stats;
}
