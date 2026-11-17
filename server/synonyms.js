import { query, execute } from './db.js';

// Strip common leading articles/particles per language
export function cleanWordForLookup(lang, word) {
  if (!word) return '';
  let clean = word.trim().toLowerCase();

  // Remove punctuation at ends
  clean = clean.replace(/^[¿¡"'({\[]+|[.,;:!?"')}\]]+$/g, '').trim();

  if (lang === 'en') {
    clean = clean.replace(/^(?:the|a|an)\s+/i, '');
  } else if (lang === 'fr') {
    clean = clean.replace(/^(?:le|la|les|un|une|des)\s+/i, '').replace(/^l['’]/i, '');
  } else if (lang === 'de') {
    clean = clean.replace(/^(?:der|die|das|den|dem|des|ein|eine|einen|einem|eines)\s+/i, '');
  } else if (lang === 'it') {
    clean = clean.replace(/^(?:il|lo|la|i|gli|le|un|uno|una)\s+/i, '').replace(/^(?:l|un)['’]/i, '');
  } else if (lang === 'pt') {
    clean = clean.replace(/^(?:o|a|os|as|um|uma|uns|umas)\s+/i, '');
  } else if (lang === 'es') {
    clean = clean.replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, '');
  }

  return clean.trim();
}

const USER_AGENT = 'VocabStudyApp/1.0 (educational language learning app; contact: info@vocabmaster.app)';

export async function getSynonyms(lang, rawWord, lemma = null) {
  if (!rawWord || !lang) return [];

  const cleanLang = lang.trim().toLowerCase();
  const cleanWord = cleanWordForLookup(cleanLang, rawWord);
  if (!cleanWord) return [];

  const cleanLemma = lemma ? cleanWordForLookup(cleanLang, lemma) : null;

  // 1. Check cache first
  try {
    const cached = await query(
      'SELECT synonyms_json FROM synonyms_cache WHERE lang = ? AND word = ?',
      [cleanLang, cleanWord]
    );
    if (cached && cached.length > 0 && cached[0].synonyms_json) {
      const parsed = JSON.parse(cached[0].synonyms_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    // Cache read failure is non-fatal
  }

  const results = new Set();

  try {
    if (cleanLang === 'en') {
      await collectEnglishSynonyms(cleanWord, results);
      if (cleanLemma && cleanLemma !== cleanWord && results.size < 5) {
        await collectEnglishSynonyms(cleanLemma, results);
      }
      if (results.size < 5) {
        await collectEnWiktionarySynonyms('en', cleanWord, results);
      }
    } else {
      // Non-English: query native Wiktionary + en.wiktionary
      await collectNativeWiktionarySynonyms(cleanLang, cleanWord, results);
      if (cleanLemma && cleanLemma !== cleanWord && results.size < 4) {
        await collectNativeWiktionarySynonyms(cleanLang, cleanLemma, results);
      }

      await collectEnWiktionarySynonyms(cleanLang, cleanWord, results);
      if (cleanLemma && cleanLemma !== cleanWord && results.size < 5) {
        await collectEnWiktionarySynonyms(cleanLang, cleanLemma, results);
      }
    }
  } catch (err) {
    console.warn(`[Synonyms] Fetch error for ${cleanWord} (${cleanLang}):`, err.message);
  }

  // Sanitize and deduplicate
  const cleanList = Array.from(results)
    .map(s => s.trim().toLowerCase())
    .filter(s => {
      if (!s || s.length < 2) return false;
      if (s === cleanWord) return false;
      if (cleanLemma && s === cleanLemma) return false;
      if (/[<>{}[\]|\\/]/.test(s)) return false;
      if (/^(http|file|category|wiki|image)/i.test(s)) return false;
      return true;
    })
    .slice(0, 15);

  // 2. Save to cache
  if (cleanList.length > 0) {
    try {
      const nowIso = new Date().toISOString();
      await execute(`
        INSERT INTO synonyms_cache (lang, word, synonyms_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (lang, word) DO UPDATE SET
          synonyms_json = EXCLUDED.synonyms_json,
          updated_at = EXCLUDED.updated_at
      `, [cleanLang, cleanWord, JSON.stringify(cleanList), nowIso]);
    } catch (saveErr) {
      // In SQLite without ON CONFLICT DO UPDATE:
      try {
        await execute(`
          INSERT OR REPLACE INTO synonyms_cache (lang, word, synonyms_json, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `, [cleanLang, cleanWord, JSON.stringify(cleanList)]);
      } catch (sqLiteErr) {}
    }
  }

  return cleanList;
}

// ----------------------------------------------------
// English: Datamuse + FreeDictionary
// ----------------------------------------------------
async function collectEnglishSynonyms(targetWord, resultsSet) {
  // 1. Datamuse rel_syn
  try {
    const dmRes = await fetch(
      `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(targetWord)}&max=14`,
      { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000) }
    );
    if (dmRes.ok) {
      const data = await dmRes.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.word) resultsSet.add(item.word);
        }
      }
    }
  } catch (e) {}

  // 2. FreeDictionary API
  try {
    const fdRes = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(targetWord)}`,
      { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000) }
    );
    if (fdRes.ok) {
      const entries = await fdRes.json();
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (Array.isArray(entry.meanings)) {
            for (const m of entry.meanings) {
              if (Array.isArray(m.synonyms)) {
                for (const s of m.synonyms) resultsSet.add(s);
              }
              if (Array.isArray(m.definitions)) {
                for (const def of m.definitions) {
                  if (Array.isArray(def.synonyms)) {
                    for (const s of def.synonyms) resultsSet.add(s);
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {}

  // 3. Datamuse means-like fallback if still short
  if (resultsSet.size < 4) {
    try {
      const mlRes = await fetch(
        `https://api.datamuse.com/words?ml=${encodeURIComponent(targetWord)}&max=6`,
        { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(3000) }
      );
      if (mlRes.ok) {
        const mlData = await mlRes.json();
        if (Array.isArray(mlData)) {
          for (const item of mlData) {
            if (item && item.word && !item.word.includes(' ')) resultsSet.add(item.word);
          }
        }
      }
    } catch (e) {}
  }
}

// ----------------------------------------------------
// Native Wiktionaries (fr, de, it, pt, es)
// ----------------------------------------------------
async function collectNativeWiktionarySynonyms(lang, targetWord, resultsSet) {
  const domain = `${lang}.wiktionary.org`;
  const url = `https://${domain}/w/api.php?action=parse&page=${encodeURIComponent(targetWord)}&prop=wikitext&format=json`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return;

    const data = await res.json();
    const wt = data.parse?.wikitext?.['*'];
    if (!wt) return;

    if (lang === 'fr') {
      const synMatch = wt.match(/\{\{S\|synonymes[^}]*\}\}([\s\S]*?)(?=\n\{\{S\||\n==|$)/i) ||
                       wt.match(/===\s*Synonymes?\s*===([\s\S]*?)(?=\n===|\n==|$)/i);
      if (synMatch) {
        extractWikiLinks(synMatch[1], resultsSet);
      }
    } else if (lang === 'de') {
      const synMatch = wt.match(/\{\{Synonyme\}\}([\s\S]*?)(?=\n\{\{|\n==|$)/i);
      if (synMatch) {
        extractWikiLinks(synMatch[1], resultsSet);
      }
    } else if (lang === 'it') {
      const synMatch = wt.match(/\{\{-sin-\}\}([\s\S]*?)(?=\n\{\{-|\n==|$)/i) ||
                       wt.match(/===\s*Sinonimi\s*===([\s\S]*?)(?=\n===|\n==|$)/i);
      if (synMatch) {
        extractWikiLinks(synMatch[1], resultsSet);
      }
    } else if (lang === 'pt') {
      const synMatch = wt.match(/===+\s*Sin[oô]nimos?\s*===+([\s\S]*?)(?=\n===|\n==|$)/i);
      if (synMatch) {
        extractWikiLinks(synMatch[1], resultsSet);
      }
    } else if (lang === 'es') {
      const synTemplates = [...wt.matchAll(/\{\{sin[oó]nimo(?:s)?\|([^}]+)\}\}/gi)];
      for (const m of synTemplates) {
        const parts = m[1].split('|').map(p => p.trim()).filter(p => p && !p.includes('='));
        for (const p of parts) resultsSet.add(p);
      }
      const synMatch = wt.match(/===+\s*Sin[oó]nimos?\s*===+([\s\S]*?)(?=\n===|\n==|$)/i);
      if (synMatch) {
        extractWikiLinks(synMatch[1], resultsSet);
      }
    }
  } catch (err) {}
}

// ----------------------------------------------------
// en.wiktionary.org for any language
// ----------------------------------------------------
const LANG_MAP = {
  en: 'English',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  es: 'Spanish'
};

async function collectEnWiktionarySynonyms(lang, targetWord, resultsSet) {
  const langHeader = LANG_MAP[lang] || lang;
  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(targetWord)}&prop=wikitext&format=json`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return;

    const data = await res.json();
    const wt = data.parse?.wikitext?.['*'];
    if (!wt) return;

    // Filter to target language section
    const langRegex = new RegExp(`==\\s*${langHeader}\\s*==([\\s\\S]*?)(?=\\n==[^=]|$)`, 'i');
    const match = wt.match(langRegex);
    const section = match ? match[1] : wt;

    // Look for {{syn|lang|...}} or {{synonyms|lang|...}}
    const synTemplates = [...section.matchAll(new RegExp(`\\{\\{syn(?:onyms)?\\|${lang}\\|([^}]+)\\}\\}`, 'gi'))];
    for (const st of synTemplates) {
      const parts = st[1].split('|').map(p => p.trim()).filter(p => p && !p.includes('='));
      for (const p of parts) resultsSet.add(p);
    }

    // Look for ====Synonyms==== block
    const synBlock = section.match(/====?\s*Synonyms?\s*====?([\s\S]*?)(?=\n===|\n==|$)/i);
    if (synBlock) {
      extractWikiLinks(synBlock[1], resultsSet);
      // Also extract {{l|lang|word}}
      const lTemplates = [...synBlock[1].matchAll(new RegExp(`\\{\\{l\\|${lang}\\|([^|}]+)`, 'gi'))];
      for (const lt of lTemplates) {
        resultsSet.add(lt[1].trim());
      }
    }
  } catch (err) {}
}

function extractWikiLinks(text, resultsSet) {
  if (!text) return;
  const matches = [...text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)];
  for (const m of matches) {
    const word = m[1].trim();
    if (word && !word.includes(':')) {
      resultsSet.add(word);
    }
  }
}
