import { query } from './db.js';

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function generateClozeExercise(wordId) {
  const words = await query('SELECT id, lang, word, translation, examples FROM words WHERE id = ?', [wordId]);
  if (!words || words.length === 0) {
    return { success: false, error: 'Palabra no encontrada' };
  }

  const { id, lang, word, translation } = words[0];
  let rawExamples = [];
  try {
    rawExamples = JSON.parse(words[0].examples || '[]');
  } catch (e) {}

  const cleanWord = word.trim();
  // Strip articles for matching
  let coreWord = cleanWord.toLowerCase();
  if (lang === 'en') coreWord = coreWord.replace(/^(?:the|a|an)\s+/i, '');
  else if (lang === 'fr') coreWord = coreWord.replace(/^(?:le|la|les|un|une|des)\s+/i, '').replace(/^l['’]/i, '');
  else if (lang === 'de') coreWord = coreWord.replace(/^(?:der|die|das|den|dem|des|ein|eine|einen|einem|eines)\s+/i, '');
  else if (lang === 'it') coreWord = coreWord.replace(/^(?:il|lo|la|i|gli|le|un|uno|una)\s+/i, '').replace(/^(?:l|un)['’]/i, '');
  else if (lang === 'pt') coreWord = coreWord.replace(/^(?:o|a|os|as|um|uma|uns|umas)\s+/i, '');

  let selectedExample = null;
  let matchedToken = cleanWord;

  // Regex to match the word with common prefixes/suffixes
  const matchRegex = new RegExp(`(^|[^\\p{L}])(${escapeRegex(coreWord)}(?:[\\p{L}]{0,4}))([^\\p{L}]|$)`, 'iu');

  // Find an example that contains the word
  for (const ex of rawExamples) {
    if (ex && ex.source && typeof ex.source === 'string') {
      const match = ex.source.match(matchRegex);
      if (match) {
        selectedExample = ex;
        matchedToken = match[2];
        break;
      }
    }
  }

  // If no example contained the word, but we have examples, pick the first one
  if (!selectedExample && rawExamples.length > 0 && rawExamples[0].source) {
    selectedExample = rawExamples[0];
  }

  let fullSentence = '';
  let maskedSentence = '';
  let sentenceTranslation = '';

  if (selectedExample && selectedExample.source) {
    fullSentence = selectedExample.source.trim();
    sentenceTranslation = (selectedExample.translation || '').trim();

    if (fullSentence.match(matchRegex)) {
      maskedSentence = fullSentence.replace(matchRegex, '$1________$3');
    } else {
      // Fallback: prepend or append in sentence
      maskedSentence = `${fullSentence} (Palabra objetivo: ________)`;
    }
  } else {
    // Synthetic context template if no examples exist in DB
    if (lang === 'en') {
      fullSentence = `In everyday communication, we often use "${cleanWord}".`;
      maskedSentence = `In everyday communication, we often use "________".`;
      sentenceTranslation = `En la comunicación cotidiana, a menudo usamos "${cleanWord}".`;
    } else if (lang === 'fr') {
      fullSentence = `Dans la vie quotidienne, il est important d'utiliser "${cleanWord}".`;
      maskedSentence = `Dans la vie quotidienne, il est important d'utiliser "________".`;
      sentenceTranslation = `En la vida cotidiana, es importante usar "${cleanWord}".`;
    } else if (lang === 'de') {
      fullSentence = `Im täglichen Leben verwenden wir oft "${cleanWord}".`;
      maskedSentence = `Im täglichen Leben verwenden wir oft "________".`;
      sentenceTranslation = `En la vida cotidiana, solemos usar "${cleanWord}".`;
    } else if (lang === 'it') {
      fullSentence = `Nella vita quotidiana, usiamo spesso "${cleanWord}".`;
      maskedSentence = `Nella vita quotidiana, usiamo spesso "________".`;
      sentenceTranslation = `En la vida cotidiana, a menudo usamos "${cleanWord}".`;
    } else if (lang === 'pt') {
      fullSentence = `No dia a dia, costumamos usar "${cleanWord}".`;
      maskedSentence = `No dia a dia, costumamos usar "________".`;
      sentenceTranslation = `En el día a día, solemos usar "${cleanWord}".`;
    }
  }

  // Get 3 random distractors from words table of same language
  const distractorRows = await query(`
    SELECT word FROM words
    WHERE lang = ? AND id != ? AND length(word) >= 3 AND word NOT LIKE '% %'
    ORDER BY RANDOM()
    LIMIT 3
  `, [lang, id]);

  const distractors = (distractorRows || []).map(r => r.word.trim());
  // Ensure we have 3 distractors
  while (distractors.length < 3) {
    distractors.push(`opción_${distractors.length + 1}`);
  }

  const options = shuffleArray([
    matchedToken,
    ...distractors
  ]);

  const cleanHint = `${cleanWord[0]}... (${cleanWord.length} letras)`;

  return {
    success: true,
    wordId: id,
    word: cleanWord,
    lang,
    translation,
    maskedSentence,
    fullSentence,
    sentenceTranslation,
    correctAnswer: matchedToken,
    options,
    hint: cleanHint
  };
}
