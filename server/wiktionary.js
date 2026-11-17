import { query, execute } from './db.js';
import { getVerbConjugations } from './conjugator.js';
import { getSynonyms } from './synonyms.js';

const LANG_MAP = {
  en: 'English',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese'
};

export async function lookupWord(lang, word) {
  if (!word || !lang) return null;
  const cleanWord = word.trim().toLowerCase();
  const cleanLang = lang.trim().toLowerCase();

  // 1. Check cache first
  try {
    const cached = await query(
      'SELECT data_json FROM wiktionary_cache WHERE lang = ? AND word = ?',
      [cleanLang, cleanWord]
    );
    if (cached && cached.length > 0) {
      const data = JSON.parse(cached[0].data_json);
      // Ensure conjugation is attached even if cache was from older version
      if (!data.conjugation) {
        data.conjugation = getVerbConjugations(cleanLang, cleanWord, data.lemma || cleanWord);
      }
      // Ensure synonyms are attached even if cache was from older version
      if (!data.synonyms || !Array.isArray(data.synonyms)) {
        data.synonyms = await getSynonyms(cleanLang, cleanWord, data.lemma || cleanWord);
      }
      return data;
    }
  } catch (err) {
    console.error('[Wiktionary] Cache read error:', err.message);
  }

  // 2. Fetch from en.wiktionary.org (which has extensive multi-language sections)
  try {
    const targetLangHeader = LANG_MAP[cleanLang] || cleanLang;
    const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(cleanWord)}&prop=wikitext&format=json`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'VocabStudyApp/1.0 (educational app; contact: user@example.com)'
      }
    });

    if (!res.ok) {
      const fallback = { found: false, word: cleanWord, lang: cleanLang };
      fallback.conjugation = getVerbConjugations(cleanLang, cleanWord, cleanWord);
      fallback.synonyms = await getSynonyms(cleanLang, cleanWord, cleanWord);
      return fallback;
    }

    const data = await res.json();
    const wikitext = data.parse?.wikitext?.['*'];

    if (!wikitext) {
      const fallback = { found: false, word: cleanWord, lang: cleanLang };
      fallback.conjugation = getVerbConjugations(cleanLang, cleanWord, cleanWord);
      fallback.synonyms = await getSynonyms(cleanLang, cleanWord, cleanWord);
      return fallback;
    }

    const parsed = parseWikitext(wikitext, targetLangHeader, cleanWord);
    parsed.conjugation = getVerbConjugations(cleanLang, cleanWord, parsed.lemma || cleanWord);
    parsed.synonyms = await getSynonyms(cleanLang, cleanWord, parsed.lemma || cleanWord);

    // Save to cache
    try {
      const nowIso = new Date().toISOString();
      await execute(`
        INSERT INTO wiktionary_cache (lang, word, data_json, updated_at)
        VALUES (?, ?, ?, ?)
      `, [cleanLang, cleanWord, JSON.stringify(parsed), nowIso]);
    } catch (cacheErr) {
      // Ignore unique constraint or minor cache errors
    }

    return parsed;
  } catch (err) {
    console.warn(`[Wiktionary] Lookup failed for ${cleanWord} (${cleanLang}):`, err.message);
    const fallback = {
      found: false,
      word: cleanWord,
      lang: cleanLang,
      error: err.message
    };
    fallback.conjugation = getVerbConjugations(cleanLang, cleanWord, cleanWord);
    fallback.synonyms = await getSynonyms(cleanLang, cleanWord, cleanWord);
    return fallback;
  }
}

function parseWikitext(text, langSection, originalWord) {
  // Extract language section: ==Language== ... next ==OtherLanguage== or end
  const langRegex = new RegExp(`==\\s*${langSection}\\s*==([\\s\\S]*?)(?=\\n==[^=]|$)`, 'i');
  const match = text.match(langRegex);

  const sectionText = match ? match[1] : text;

  const result = {
    found: true,
    word: originalWord,
    language: langSection,
    lemma: null,
    partsOfSpeech: [],
    definitions: [],
    forms: []
  };

  // Find English specific inflections
  const enPastMatch = sectionText.match(/\{\{en-past of\|([^|}]+)/i);
  if (enPastMatch) {
    result.lemma = enPastMatch[1].trim();
    result.forms.push('Pasado simple y participio');
  }

  const enIngMatch = sectionText.match(/\{\{en-ing form of\|([^|}]+)/i);
  if (enIngMatch) {
    result.lemma = enIngMatch[1].trim();
    result.forms.push('Gerundio / Progresivo (-ing)');
  }

  const enThirdMatch = sectionText.match(/\{\{en-third-person singular of\|([^|}]+)/i);
  if (enThirdMatch) {
    result.lemma = enThirdMatch[1].trim();
    result.forms.push('3ª persona singular presente');
  }

  // Find general inflections / lemma:
  // e.g. {{infl of|en|plot||ed-form}} or {{inflection of|it|vedere||1|s|pres|ind}} or {{form of|...}}
  const inflectionRegex = /\{\{(?:infl of|inflection of|form of|past participle of|present participle of|plural of|feminine of|[a-z]{2,3}-verb(?:-form)?-of)\|[^|]*\|([^|}]+)(?:\|([^}]+))?\}\}/i;
  const inflMatch = sectionText.match(inflectionRegex);
  if (inflMatch && !result.lemma) {
    result.lemma = inflMatch[1].trim();
    if (inflMatch[2]) {
      let rawForm = inflMatch[2].replace(/\|+/g, ' ').trim();
      if (/ed-form/i.test(rawForm)) rawForm = 'Pasado simple y participio pasado (-ed)';
      else if (/ing-form/i.test(rawForm)) rawForm = 'Gerundio / Progresivo (-ing)';
      else if (/s-form/i.test(rawForm)) rawForm = '3ª persona singular presente (-s)';
      result.forms.push(rawForm);
    }
  }

  // Common parts of speech
  const posHeadings = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun', 'Preposition', 'Conjunction', 'Interjection'];
  for (const pos of posHeadings) {
    const posRegex = new RegExp(`===\\s*${pos}\\s*===([\\s\\S]*?)(?=\\n===|\\n==|$)`, 'i');
    const posMatch = sectionText.match(posRegex);
    if (posMatch) {
      result.partsOfSpeech.push(pos);
      const posContent = posMatch[1];

      // Extract definition lines starting with #
      const lines = posContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') && !trimmed.startsWith('#*') && !trimmed.startsWith('#:')) {
          let cleanDef = trimmed.replace(/^#\s*/, '')
            .replace(/\{\{[^}]+\}\}/g, '') // remove templates
            .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1') // clean wiki links
            .replace(/'''?/g, '') // bold/italic
            .trim();
          if (cleanDef && cleanDef.length > 2 && result.definitions.length < 5) {
            result.definitions.push({
              pos,
              definition: cleanDef
            });
          }
        }
      }
    }
  }

  if (!result.lemma && result.partsOfSpeech.length > 0) {
    result.lemma = originalWord; // It is already a base/lemma form
  }

  return result;
}
