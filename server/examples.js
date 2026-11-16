import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import { query, execute } from './db.js';

const LANG_MAP = {
  en: 'eng',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
  pt: 'por',
  es: 'spa'
};

/**
 * Searches Tatoeba API for human-translated bilingual sentences
 */
async function searchTatoeba(word, lang) {
  try {
    const iso3 = LANG_MAP[lang] || lang;
    let cleanQuery = word.trim();
    if (lang === 'fr' && /^(le|la|l'|les|un|une|des)\s+/i.test(cleanQuery)) {
      cleanQuery = cleanQuery.replace(/^(le|la|l'|les|un|une|des)\s+/i, '');
    } else if (lang === 'it' && /^(il|lo|la|l'|i|gli|le|un|uno|una)\s+/i.test(cleanQuery)) {
      cleanQuery = cleanQuery.replace(/^(il|lo|la|l'|i|gli|le|un|uno|una)\s+/i, '');
    } else if (lang === 'pt' && /^(o|a|os|as|um|uma|uns|umas)\s+/i.test(cleanQuery)) {
      cleanQuery = cleanQuery.replace(/^(o|a|os|as|um|uma|uns|umas)\s+/i, '');
    } else if (lang === 'de' && /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer)\s+/i.test(cleanQuery)) {
      cleanQuery = cleanQuery.replace(/^(der|die|das|den|dem|des|ein|eine|einen|einem|einer)\s+/i, '');
    }

    const url = `https://tatoeba.org/es/api_v0/search?from=${iso3}&to=spa&query=${encodeURIComponent(cleanQuery || word)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VocabMaster/1.0 (educational app)' },
      signal: AbortSignal.timeout(2500)
    });

    if (!res.ok) return [];
    const data = await res.json();
    const examples = [];

    for (const item of (data.results || [])) {
      const src = item.text?.trim();
      const transList = (item.translations || []).flat();
      const spa = transList.find(t => t.lang === 'spa')?.text?.trim();
      if (src && spa && !examples.some(e => e.source === src)) {
        examples.push({ source: src, translation: spa });
      }
    }
    return examples.slice(0, 3);
  } catch (err) {
    return [];
  }
}

/**
 * Searches Google Translate dictionary definitions & authentic usage sentences
 */
async function searchGoogleDictionary(word, lang) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${lang}&tl=es&dt=t&dt=bd&dt=ex&dt=md&q=${encodeURIComponent(word)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) return [];
    const data = await res.json();
    const raw = data[13] || [];
    const sentences = [];

    for (const g of raw) {
      if (Array.isArray(g)) {
        for (const item of g) {
          if (item && typeof item[0] === 'string') {
            const clean = item[0].replace(/<[^>]*>/g, '').trim();
            if (clean && !sentences.includes(clean)) {
              sentences.push(clean);
            }
          }
        }
      }
    }

    const examples = [];
    for (const s of sentences.slice(0, 2)) {
      const tr = await translateSentence(s, lang, 'es');
      if (tr) {
        examples.push({ source: s, translation: tr });
      }
    }
    return examples;
  } catch (err) {
    return [];
  }
}

/**
 * Translates a single sentence
 */
export async function translateSentence(text, sourceLang, targetLang = 'es') {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data[0] || []).map(p => p[0]).join('').trim();
  } catch (err) {
    return '';
  }
}

/**
 * Synthesizes natural, high-frequency communicative sentences when dictionary has 0 entries
 */
async function synthesizeContextualExamples(word, lang) {
  try {
    const cleanWord = word.trim();
    const isVerb = (
      (lang === 'fr' && (cleanWord.endsWith('er') || cleanWord.endsWith('ir') || cleanWord.endsWith('re'))) ||
      (lang === 'it' && (cleanWord.endsWith('are') || cleanWord.endsWith('ere') || cleanWord.endsWith('ire'))) ||
      (lang === 'pt' && (cleanWord.endsWith('ar') || cleanWord.endsWith('er') || cleanWord.endsWith('ir'))) ||
      (lang === 'de' && cleanWord.endsWith('en')) ||
      (lang === 'en' && cleanWord.startsWith('to '))
    );

    let templates = [];
    if (isVerb) {
      const verb = (lang === 'en' && cleanWord.startsWith('to ')) ? cleanWord.slice(3) : cleanWord;
      const verbFrames = {
        pt: [
          `É importante ${verb} todos os dias.`,
          `Eu gosto muito de ${verb}.`
        ],
        it: [
          `È importante ${verb} ogni giorno.`,
          `Mi piace molto ${verb}.`
        ],
        fr: [
          `Il est important de ${verb} chaque jour.`,
          `J'aime beaucoup ${verb}.`
        ],
        de: [
          `Es ist wichtig, jeden Tag zu ${verb}.`,
          `Ich möchte gern ${verb}.`
        ],
        en: [
          `It is important to ${verb} every day.`,
          `I really like to ${verb}.`
        ]
      };
      templates = verbFrames[lang] || verbFrames['en'];
    } else {
      const nounFrames = {
        pt: [
          `Eu comprei uma ${cleanWord} para a casa.`,
          `Onde você colocou a ${cleanWord}?`
        ],
        it: [
          `Ho comprato una ${cleanWord} per la casa.`,
          `Dove hai messo la ${cleanWord}?`
        ],
        fr: [
          `J'ai acheté un ${cleanWord} pour la maison.`,
          `Où est-ce que tu as mis le ${cleanWord} ?`
        ],
        de: [
          `Ich habe ein neues ${cleanWord} gekauft.`,
          `Wo ist das ${cleanWord}?`
        ],
        en: [
          `I recently bought a new ${cleanWord} for my room.`,
          `Where did you put the ${cleanWord}?`
        ]
      };
      templates = nounFrames[lang] || nounFrames['en'];
    }

    const results = [];
    for (const src of templates.slice(0, 2)) {
      const tr = await translateSentence(src, lang, 'es');
      if (tr) {
        results.push({ source: src, translation: tr });
      }
    }
    return results;
  } catch (err) {
    return [];
  }
}

/**
 * Main fetcher for a word:
 * 1. Tatoeba (human bilingual sentences)
 * 2. Google Translate authentic dictionary examples
 * 3. Smart contextual communicative synthesis
 */
export async function fetchExamplesForWord(word, lang) {
  if (!word || !lang) return [];
  const cleanLang = lang.trim().toLowerCase();

  // Tier 1: Tatoeba
  let examples = await searchTatoeba(word, cleanLang);
  if (examples && examples.length > 0) {
    return examples;
  }

  // Tier 2: Google Translate Dictionary
  examples = await searchGoogleDictionary(word, cleanLang);
  if (examples && examples.length > 0) {
    return examples;
  }

  // Tier 3: Contextual communicative synthesis
  examples = await synthesizeContextualExamples(word, cleanLang);
  if (examples && examples.length > 0) {
    return examples;
  }

  return [];
}

/**
 * Enriches a single word in the database if it lacks examples
 */
export async function enrichWordInDb(wordId) {
  const rows = await query('SELECT id, word, lang, examples FROM words WHERE id = ?', [wordId]);
  if (!rows || rows.length === 0) return { success: false, reason: 'Word not found' };

  const wordObj = rows[0];
  let currentExamples = [];
  try {
    currentExamples = JSON.parse(wordObj.examples || '[]');
  } catch (e) {}

  if (Array.isArray(currentExamples) && currentExamples.length > 0) {
    return { success: true, count: currentExamples.length, examples: currentExamples, alreadyHad: true };
  }

  const newExamples = await fetchExamplesForWord(wordObj.word, wordObj.lang);
  if (newExamples && newExamples.length > 0) {
    const jsonStr = JSON.stringify(newExamples);
    const nowIso = new Date().toISOString();
    await execute('UPDATE words SET examples = ?, updated_at = ? WHERE id = ?', [jsonStr, nowIso, wordId]);
    return { success: true, count: newExamples.length, examples: newExamples, updated: true };
  }

  return { success: false, reason: 'No se pudieron generar ejemplos para esta palabra' };
}

let isEnrichingInProgress = false;

/**
 * Background batch enrichment for all words that currently lack examples
 */
export async function enrichAllMissingExamples(maxLimit = 150) {
  if (isEnrichingInProgress) {
    return { success: false, inProgress: true, message: 'La sincronización de ejemplos ya se está ejecutando en segundo plano.' };
  }

  isEnrichingInProgress = true;

  (async () => {
    try {
      console.log(`[AutoExamples] Iniciando escaneo de palabras sin ejemplos (lote máx: ${maxLimit})...`);
      const wordsToEnrich = await query(`
        SELECT id, word, lang 
        FROM words 
        WHERE active = 1 AND (examples IS NULL OR examples = '' OR examples = '[]' OR examples = 'null')
        ORDER BY id ASC
        LIMIT ?
      `, [maxLimit]);

      console.log(`[AutoExamples] Encontradas ${wordsToEnrich.length} palabras pendientes de ejemplos.`);

      let enrichedCount = 0;
      for (const w of wordsToEnrich) {
        try {
          const ex = await fetchExamplesForWord(w.word, w.lang);
          if (ex && ex.length > 0) {
            const nowIso = new Date().toISOString();
            await execute('UPDATE words SET examples = ?, updated_at = ? WHERE id = ?', [JSON.stringify(ex), nowIso, w.id]);
            enrichedCount++;
            console.log(`[AutoExamples] [+] (${w.lang}) "${w.word}": ${ex.length} ejemplos guardados en la BD.`);
          }
          await new Promise(r => setTimeout(r, 350));
        } catch (itemErr) {
          console.warn(`[AutoExamples] Error con palabra ${w.word}:`, itemErr.message);
        }
      }

      console.log(`[AutoExamples] Finalizado: ${enrichedCount}/${wordsToEnrich.length} palabras enriquecidas en la base de datos.`);
    } catch (err) {
      console.error('[AutoExamples] Error en proceso por lotes:', err);
    } finally {
      isEnrichingInProgress = false;
    }
  })();

  return {
    success: true,
    message: 'Proceso de enriquecimiento automático de ejemplos iniciado en segundo plano.'
  };
}
