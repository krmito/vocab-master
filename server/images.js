import { query, execute } from './db.js';

/**
 * Searches for high-relevance images for a vocabulary word.
 * Uses contextual cues (translation, tags, lemmas) to avoid homonym/brand confusion.
 */
export async function getWordImage(word, lang = 'en', translation = '', tags = '') {
  if (!word) return { success: false, imageUrl: null };
  const cleanWord = word.trim().toLowerCase();

  // 1. Check database cache
  try {
    const cached = await query('SELECT image_url FROM image_cache WHERE word = ?', [cleanWord]);
    if (cached && cached.length > 0) {
      const url = cached[0].image_url;
      // If user marked as 'none' or null, respect that
      if (!url || url === 'none') {
        return { success: true, imageUrl: null, fromCache: true };
      }
      return { success: true, imageUrl: url, fromCache: true };
    }
  } catch (err) {}

  // 2. Fetch candidates using contextual search
  const candidates = await searchImageCandidates(cleanWord, translation, lang);
  const bestImage = candidates.length > 0 ? candidates[0].image : null;

  // 3. Cache the best match
  if (bestImage) {
    try {
      const nowIso = new Date().toISOString();
      await execute(`
        INSERT INTO image_cache (word, image_url, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT (word) DO UPDATE SET image_url = EXCLUDED.image_url, updated_at = EXCLUDED.updated_at
      `, [cleanWord, bestImage, nowIso]);
    } catch (e) {
      try {
        await execute('INSERT OR REPLACE INTO image_cache (word, image_url, updated_at) VALUES (?, ?, ?)', [cleanWord, bestImage, new Date().toISOString()]);
      } catch (e2) {}
    }
  }

  return { success: true, imageUrl: bestImage, candidates, fromCache: false };
}

/**
 * Get multiple candidate images so the user can choose the best mnemonic
 */
export async function searchImageCandidates(word, translation = '', lang = 'en', customQuery = null) {
  const results = [];
  const seenUrls = new Set();

  function addResult(imgUrl, thumbUrl, title, source) {
    if (!imgUrl || seenUrls.has(imgUrl)) return;
    // Filter out common ad/tracker/placeholder images
    if (imgUrl.includes('placeholder') || imgUrl.includes('spacer.gif') || imgUrl.endsWith('.svg')) return;
    seenUrls.add(imgUrl);
    results.push({
      image: imgUrl,
      thumbnail: thumbUrl || imgUrl,
      title: title || word,
      source: source || 'Web'
    });
  }

  // A. If user provided a specific search query, prioritize it
  if (customQuery && customQuery.trim()) {
    const ddgList = await fetchDuckDuckGoImages(customQuery.trim());
    for (const r of ddgList) addResult(r.image, r.thumbnail, r.title, 'Search');
    return results.slice(0, 8);
  }

  const baseWord = word.replace(/^to\s+/i, '').trim();

  // B. Try Wikipedia Summary for concrete nouns / established concepts
  try {
    const wpLang = ['en', 'fr', 'de', 'it', 'pt', 'es'].includes(lang) ? lang : 'en';
    const wpUrl = `https://${wpLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(baseWord)}`;
    const wpRes = await fetch(wpUrl, {
      headers: { 'User-Agent': 'VocabStudyApp/1.0 (educational app; contact: info@example.com)' }
    });
    if (wpRes.ok) {
      const data = await wpRes.json();
      // Ensure it's not a disambiguation page and not a brand unless requested
      const desc = (data.description || '').toLowerCase();
      const isDisambig = desc.includes('topics referred to') || desc.includes('disambiguation');
      const isBrand = desc.includes('brand of') || desc.includes('company');
      
      if (!isDisambig && !isBrand && data.thumbnail?.source) {
        addResult(data.thumbnail.source, data.thumbnail.source, data.title + ': ' + (data.description || ''), 'Wikipedia');
      }
    }
  } catch (e) {}

  // C. Disambiguate with translation context using DuckDuckGo
  let hint = '';
  if (translation) {
    const firstDef = translation.split(/[;,/]/)[0].trim();
    hint = firstDef.replace(/^(el|la|los|las|un|una|para|de)\s+/i, '').split(/\s+/).slice(0, 2).join(' ');
  }

  const searchQueries = [];
  if (hint && hint.toLowerCase() !== baseWord.toLowerCase()) {
    searchQueries.push(`${baseWord} ${hint}`);
  }
  searchQueries.push(`${baseWord} illustration`);

  for (const q of searchQueries) {
    if (results.length >= 4) break;
    const ddgList = await fetchDuckDuckGoImages(q);
    for (const r of ddgList) {
      addResult(r.image, r.thumbnail, r.title, 'Web');
      if (results.length >= 6) break;
    }
  }

  return results.slice(0, 6);
}

/**
 * DuckDuckGo image search scraper (free, no API key required)
 */
async function fetchDuckDuckGoImages(query) {
  try {
    const res = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&t=h_&iax=images&ia=images', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    const vqd = text.match(/vqd=([0-9-]+)/)?.[1];
    if (!vqd) return [];

    const imgRes = await fetch(`https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,type:photo`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!imgRes.ok) return [];
    const data = await imgRes.json();
    return (data.results || []).slice(0, 6).map(r => ({
      title: r.title,
      image: r.image,
      thumbnail: r.thumbnail || r.image
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Manually update or remove an image for a word
 */
export async function setWordImage(word, imageUrl) {
  const cleanWord = word.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const val = imageUrl || 'none';

  try {
    await execute(`
      INSERT INTO image_cache (word, image_url, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT (word) DO UPDATE SET image_url = EXCLUDED.image_url, updated_at = EXCLUDED.updated_at
    `, [cleanWord, val, nowIso]);
  } catch (e) {
    await execute('INSERT OR REPLACE INTO image_cache (word, image_url, updated_at) VALUES (?, ?, ?)', [cleanWord, val, nowIso]);
  }
  return { success: true, word: cleanWord, imageUrl: val === 'none' ? null : val };
}

/**
 * Clear bad or obsolete cached images
 */
export async function clearImageCache(word = null) {
  if (word) {
    await execute('DELETE FROM image_cache WHERE word = ?', [word.trim().toLowerCase()]);
  } else {
    await execute('DELETE FROM image_cache');
  }
  return { success: true };
}
