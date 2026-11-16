import { query, execute } from './db.js';

export async function getWordImage(word, lang = 'en') {
  if (!word) return null;
  const cleanWord = word.trim().toLowerCase();

  // 1. Check database cache
  try {
    const cached = await query('SELECT image_url FROM image_cache WHERE word = ?', [cleanWord]);
    if (cached && cached.length > 0 && cached[0].image_url) {
      return { success: true, imageUrl: cached[0].image_url, fromCache: true };
    }
  } catch (err) {
    // If table doesn't exist yet, continue
  }

  // 2. Fetch from Wikimedia Commons
  let imageUrl = null;
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanWord)}&gsrlimit=1&prop=pageimages&pithumbsize=600&format=json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'VocabStudyApp/1.0 (educational app; contact: user@example.com)'
      }
    });

    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.pages;
      if (pages) {
        const firstKey = Object.keys(pages)[0];
        imageUrl = pages[firstKey]?.thumbnail?.source || null;
      }
    }
  } catch (err) {
    console.warn(`[Image] Commons search failed for ${cleanWord}:`, err.message);
  }

  // 3. Fallback to Wikipedia PageImages
  if (!imageUrl) {
    try {
      const wpUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(cleanWord)}&prop=pageimages&format=json&pithumbsize=600`;
      const res = await fetch(wpUrl, {
        headers: {
          'User-Agent': 'VocabStudyApp/1.0 (educational app; contact: user@example.com)'
        }
      });
      if (res.ok) {
        const data = await res.json();
        const pages = data.query?.pages;
        if (pages) {
          const firstKey = Object.keys(pages)[0];
          imageUrl = pages[firstKey]?.thumbnail?.source || null;
        }
      }
    } catch (e) {}
  }

  // 4. Fallback to LoremFlickr for descriptive stock photo if no encyclopedic photo found
  if (!imageUrl) {
    imageUrl = `https://loremflickr.com/600/400/${encodeURIComponent(cleanWord)}`;
  }

  // 5. Cache in database
  if (imageUrl) {
    try {
      const nowIso = new Date().toISOString();
      await execute(`
        INSERT INTO image_cache (word, image_url, updated_at)
        VALUES (?, ?, ?)
      `, [cleanWord, imageUrl, nowIso]);
    } catch (cacheErr) {}
  }

  return { success: true, imageUrl, fromCache: false };
}
