/**
 * Multilingual Verb Conjugation Generator & Analyzer for:
 * - English (en)
 * - French (fr)
 * - German (de)
 * - Italian (it)
 * - Portuguese (pt)
 */

const ENGLISH_IRREGULARS = {
  be: { past: 'was / were', part: 'been', pres3: 'is', gerund: 'being', pres: 'am / are' },
  have: { past: 'had', part: 'had', pres3: 'has', gerund: 'having', pres: 'have' },
  do: { past: 'did', part: 'done', pres3: 'does', gerund: 'doing', pres: 'do' },
  say: { past: 'said', part: 'said', pres3: 'says', gerund: 'saying', pres: 'say' },
  go: { past: 'went', part: 'gone', pres3: 'goes', gerund: 'going', pres: 'go' },
  get: { past: 'got', part: 'got / gotten', pres3: 'gets', gerund: 'getting', pres: 'get' },
  make: { past: 'made', part: 'made', pres3: 'makes', gerund: 'making', pres: 'make' },
  know: { past: 'knew', part: 'known', pres3: 'knows', gerund: 'knowing', pres: 'know' },
  think: { past: 'thought', part: 'thought', pres3: 'thinks', gerund: 'thinking', pres: 'think' },
  take: { past: 'took', part: 'taken', pres3: 'takes', gerund: 'taking', pres: 'take' },
  see: { past: 'saw', part: 'seen', pres3: 'sees', gerund: 'seeing', pres: 'see' },
  come: { past: 'came', part: 'come', pres3: 'comes', gerund: 'coming', pres: 'come' },
  find: { past: 'found', part: 'found', pres3: 'finds', gerund: 'finding', pres: 'find' },
  give: { past: 'gave', part: 'given', pres3: 'gives', gerund: 'giving', pres: 'give' },
  tell: { past: 'told', part: 'told', pres3: 'tells', gerund: 'telling', pres: 'tell' },
  feel: { past: 'felt', part: 'felt', pres3: 'feels', gerund: 'feeling', pres: 'feel' },
  become: { past: 'became', part: 'become', pres3: 'becomes', gerund: 'becoming', pres: 'become' },
  leave: { past: 'left', part: 'left', pres3: 'leaves', gerund: 'leaving', pres: 'leave' },
  put: { past: 'put', part: 'put', pres3: 'puts', gerund: 'putting', pres: 'put' },
  mean: { past: 'meant', part: 'meant', pres3: 'means', gerund: 'meaning', pres: 'mean' },
  keep: { past: 'kept', part: 'kept', pres3: 'keeps', gerund: 'keeping', pres: 'keep' },
  let: { past: 'let', part: 'let', pres3: 'lets', gerund: 'letting', pres: 'let' },
  begin: { past: 'began', part: 'begun', pres3: 'begins', gerund: 'beginning', pres: 'begin' },
  show: { past: 'showed', part: 'shown', pres3: 'shows', gerund: 'showing', pres: 'show' },
  hear: { past: 'heard', part: 'heard', pres3: 'hears', gerund: 'hearing', pres: 'hear' },
  run: { past: 'ran', part: 'run', pres3: 'runs', gerund: 'running', pres: 'run' },
  write: { past: 'wrote', part: 'written', pres3: 'writes', gerund: 'writing', pres: 'write' },
  bring: { past: 'brought', part: 'brought', pres3: 'brings', gerund: 'bringing', pres: 'bring' },
  sit: { past: 'sat', part: 'sat', pres3: 'sits', gerund: 'sitting', pres: 'sit' },
  stand: { past: 'stood', part: 'stood', pres3: 'stands', gerund: 'standing', pres: 'stand' },
  lose: { past: 'lost', part: 'lost', pres3: 'loses', gerund: 'losing', pres: 'lose' },
  pay: { past: 'paid', part: 'paid', pres3: 'pays', gerund: 'paying', pres: 'pay' },
  meet: { past: 'met', part: 'met', pres3: 'meets', gerund: 'meeting', pres: 'meet' },
  set: { past: 'set', part: 'set', pres3: 'sets', gerund: 'setting', pres: 'set' },
  learn: { past: 'learned', part: 'learned', pres3: 'learns', gerund: 'learning', pres: 'learn' },
  lead: { past: 'led', part: 'led', pres3: 'leads', gerund: 'leading', pres: 'lead' },
  understand: { past: 'understood', part: 'understood', pres3: 'understands', gerund: 'understanding', pres: 'understand' },
  speak: { past: 'spoke', part: 'spoken', pres3: 'speaks', gerund: 'speaking', pres: 'speak' },
  read: { past: 'read', part: 'read', pres3: 'reads', gerund: 'reading', pres: 'read' },
  spend: { past: 'spent', part: 'spent', pres3: 'spends', gerund: 'spending', pres: 'spend' },
  grow: { past: 'grew', part: 'grown', pres3: 'grows', gerund: 'growing', pres: 'grow' },
  win: { past: 'won', part: 'won', pres3: 'wins', gerund: 'winning', pres: 'win' },
  buy: { past: 'bought', part: 'bought', pres3: 'buys', gerund: 'buying', pres: 'buy' },
  send: { past: 'sent', part: 'sent', pres3: 'sends', gerund: 'sending', pres: 'send' },
  build: { past: 'built', part: 'built', pres3: 'builds', gerund: 'building', pres: 'build' },
  fall: { past: 'fell', part: 'fallen', pres3: 'falls', gerund: 'falling', pres: 'fall' },
  cut: { past: 'cut', part: 'cut', pres3: 'cuts', gerund: 'cutting', pres: 'cut' },
  drive: { past: 'drove', part: 'driven', pres3: 'drives', gerund: 'driving', pres: 'drive' },
  break: { past: 'broke', part: 'broken', pres3: 'breaks', gerund: 'breaking', pres: 'break' },
  wear: { past: 'wore', part: 'worn', pres3: 'wears', gerund: 'wearing', pres: 'wear' },
  choose: { past: 'chose', part: 'chosen', pres3: 'chooses', gerund: 'choosing', pres: 'choose' },
  plot: { past: 'plotted', part: 'plotted', pres3: 'plots', gerund: 'plotting', pres: 'plot' }
};

// Italian Irregulars (frequent)
const ITALIAN_IRREGULARS = {
  vedere: {
    present: ['vedo', 'vedi', 'vede', 'vediamo', 'vedete', 'vedono'],
    passato_prossimo: 'ho visto',
    imperfetto: ['vedevo', 'vedevi', 'vedeva', 'vedevamo', 'vedevate', 'vedevano'],
    futuro: ['vedrò', 'vedrai', 'vedrà', 'vedremo', 'vedrete', 'vedranno'],
    participio: 'visto / veduto',
    gerundio: 'vedendo'
  },
  essere: {
    present: ['sono', 'sei', 'è', 'siamo', 'siete', 'sono'],
    passato_prossimo: 'sono stato/a',
    imperfetto: ['ero', 'eri', 'era', 'eravamo', 'eravate', 'erano'],
    futuro: ['sarò', 'sarai', 'sarà', 'saremo', 'sarete', 'saranno'],
    participio: 'stato',
    gerundio: 'essendo'
  },
  avere: {
    present: ['ho', 'hai', 'ha', 'abbiamo', 'avete', 'hanno'],
    passato_prossimo: 'ho avuto',
    imperfetto: ['avevo', 'avevi', 'aveva', 'avevamo', 'avevate', 'avevano'],
    futuro: ['avrò', 'avrai', 'avrà', 'avremo', 'avrete', 'avranno'],
    participio: 'avuto',
    gerundio: 'avendo'
  },
  fare: {
    present: ['faccio', 'fai', 'fa', 'facciamo', 'fate', 'fanno'],
    passato_prossimo: 'ho fatto',
    imperfetto: ['facevo', 'facevi', 'faceva', 'facevamo', 'facevate', 'facevano'],
    futuro: ['farò', 'farai', 'farà', 'faremo', 'farete', 'faranno'],
    participio: 'fatto',
    gerundio: 'facendo'
  },
  andare: {
    present: ['vado', 'vai', 'va', 'andiamo', 'andate', 'vanno'],
    passato_prossimo: 'sono andato/a',
    imperfetto: ['andavo', 'andavi', 'andava', 'andavamo', 'andavate', 'andavano'],
    futuro: ['andrò', 'andrai', 'andrà', 'andremo', 'andrete', 'andranno'],
    participio: 'andato',
    gerundio: 'andando'
  },
  dire: {
    present: ['dico', 'dici', 'dice', 'diciamo', 'dite', 'dicono'],
    passato_prossimo: 'ho detto',
    imperfetto: ['dicevo', 'dicevi', 'diceva', 'dicevamo', 'dicevate', 'dicevano'],
    futuro: ['dirò', 'dirai', 'dirà', 'diremo', 'direte', 'diranno'],
    participio: 'detto',
    gerundio: 'dicendo'
  },
  potere: {
    present: ['posso', 'puoi', 'può', 'possiamo', 'potete', 'possono'],
    passato_prossimo: 'ho potuto',
    imperfetto: ['potevo', 'potevi', 'poteva', 'potevamo', 'potevate', 'potevano'],
    futuro: ['potrò', 'potrai', 'potrà', 'potremo', 'potrete', 'potranno'],
    participio: 'potuto',
    gerundio: 'potendo'
  },
  volere: {
    present: ['voglio', 'vuoi', 'vuole', 'vogliamo', 'volete', 'vogliono'],
    passato_prossimo: 'ho voluto',
    imperfetto: ['volevo', 'volevi', 'voleva', 'volevamo', 'volevate', 'volevano'],
    futuro: ['vorrò', 'vorrai', 'vorrà', 'vorremo', 'vorrete', 'vorranno'],
    participio: 'voluto',
    gerundio: 'volendo'
  },
  dovere: {
    present: ['devo', 'devi', 'deve', 'dobbiamo', 'dovete', 'devono'],
    passato_prossimo: 'ho dovuto',
    imperfetto: ['dovevo', 'dovevi', 'doveva', 'dovevamo', 'dovevate', 'dovevano'],
    futuro: ['dovrò', 'dovrai', 'dovrà', 'dovremo', 'dovrete', 'dovranno'],
    participio: 'dovuto',
    gerundio: 'dovendo'
  }
};

// French Irregulars (frequent)
const FRENCH_IRREGULARS = {
  être: {
    present: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'],
    passe_compose: 'été',
    imparfait: ['étais', 'étais', 'était', 'étions', 'étiez', 'étaient'],
    futur: ['serai', 'seras', 'sera', 'serons', 'serez', 'seront'],
    participe: 'été',
    gerondif: 'étant'
  },
  avoir: {
    present: ['ai', 'as', 'a', 'avons', 'avez', 'ont'],
    passe_compose: 'eu',
    imparfait: ['avais', 'avais', 'avait', 'avions', 'aviez', 'avaient'],
    futur: ['aurai', 'auras', 'aura', 'aurons', 'aurez', 'auront'],
    participe: 'eu',
    gerondif: 'ayant'
  },
  faire: {
    present: ['fais', 'fais', 'fait', 'faisons', 'faites', 'font'],
    passe_compose: 'fait',
    imparfait: ['faisais', 'faisais', 'faisait', 'faisions', 'faisiez', 'faisaient'],
    futur: ['ferai', 'feras', 'fera', 'ferons', 'ferez', 'feront'],
    participe: 'fait',
    gerondif: 'faisant'
  },
  aller: {
    present: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
    passe_compose: 'allé',
    imparfait: ['allais', 'allais', 'allait', 'allions', 'alliez', 'allaient'],
    futur: ['irai', 'iras', 'ira', 'irons', 'irez', 'iront'],
    participe: 'allé',
    gerondif: 'allant'
  },
  voir: {
    present: ['vois', 'vois', 'voit', 'voyons', 'voyez', 'voient'],
    passe_compose: 'vu',
    imparfait: ['voyais', 'voyais', 'voyait', 'voyions', 'voyiez', 'voyaient'],
    futur: ['verrai', 'verras', 'verra', 'verrons', 'verrez', 'verront'],
    participe: 'vu',
    gerondif: 'voyant'
  }
};

// German Irregulars
const GERMAN_IRREGULARS = {
  sein: {
    praesens: ['bin', 'bist', 'ist', 'sind', 'seid', 'sind'],
    praeteritum: ['war', 'warst', 'war', 'waren', 'wart', 'waren'],
    partizip2: 'gewesen',
    futur1: 'werde sein'
  },
  haben: {
    praesens: ['habe', 'hast', 'hat', 'haben', 'habt', 'haben'],
    praeteritum: ['hatte', 'hattest', 'hatte', 'hatten', 'hattet', 'hatten'],
    partizip2: 'gehabt',
    futur1: 'werde haben'
  },
  werden: {
    praesens: ['werde', 'wirst', 'wird', 'werden', 'werdet', 'werden'],
    praeteritum: ['wurde', 'wurdest', 'wurde', 'wurden', 'wurdet', 'wurden'],
    partizip2: 'geworden',
    futur1: 'werde werden'
  },
  sehen: {
    praesens: ['sehe', 'siehst', 'sieht', 'sehen', 'seht', 'sehen'],
    praeteritum: ['sah', 'sahst', 'sah', 'sahen', 'saht', 'sahen'],
    partizip2: 'gesehen',
    futur1: 'werde sehen'
  }
};

export function getVerbConjugations(lang, originalWord, lemma) {
  const l = (lang || '').toLowerCase().trim();
  const word = (originalWord || '').toLowerCase().trim();
  const base = (lemma || word).toLowerCase().trim();

  const result = {
    isVerb: false,
    lemma: base,
    currentFormDetected: null,
    tenses: {},
    links: {
      reverso: getReversoLink(l, base),
      wordreference: getWordReferenceLink(l, base)
    }
  };

  if (l === 'en') {
    result.isVerb = true;
    const ir = ENGLISH_IRREGULARS[base];

    let past = ir ? ir.past : (base.endsWith('e') ? `${base}d` : `${base}ed`);
    let part = ir ? ir.part : (base.endsWith('e') ? `${base}d` : `${base}ed`);
    let pres3 = ir ? ir.pres3 : (base.endsWith('y') && !/[aeiou]y$/.test(base) ? `${base.slice(0, -1)}ies` : `${base}s`);
    let gerund = ir ? ir.gerund : (base.endsWith('e') && !base.endsWith('ee') ? `${base.slice(0, -1)}ing` : `${base}ing`);

    // Detect consonant doubling (e.g. plot -> plotted)
    if (!ir && /[bcdfghjklmnpqrstvwxyz][aeiou][bcdfghjklmnpqrstz]$/.test(base) && base.length <= 5) {
      const lastChar = base.slice(-1);
      past = `${base}${lastChar}ed`;
      part = `${base}${lastChar}ed`;
      gerund = `${base}${lastChar}ing`;
    }

    result.tenses = {
      'Infinitivo / Base': base,
      'Presente (I / You / We / They)': base,
      'Presente (He / She / It)': pres3,
      'Pasado simple (Past simple)': past,
      'Participio pasado (Past participle)': part,
      'Gerundio / Progresivo (-ing)': gerund
    };

    if (word === past && past === part) {
      result.currentFormDetected = 'Pasado simple / Participio';
    } else if (word === past) {
      result.currentFormDetected = 'Pasado simple';
    } else if (word === part) {
      result.currentFormDetected = 'Participio pasado';
    } else if (word === pres3) {
      result.currentFormDetected = 'Presente (3ª persona singular)';
    } else if (word === gerund) {
      result.currentFormDetected = 'Gerundio / Progresivo (-ing)';
    } else if (word === base) {
      result.currentFormDetected = 'Infinitivo / Presente';
    }
  } else if (l === 'it') {
    result.isVerb = true;
    const persons = ['io', 'tu', 'lui/lei', 'noi', 'voi', 'loro'];
    const ir = ITALIAN_IRREGULARS[base];

    if (ir) {
      result.tenses = {
        'Presente indicativo': persons.map((p, i) => `${p} ${ir.present[i]}`).join(', '),
        'Passato prossimo': ir.passato_prossimo,
        'Imperfetto': persons.map((p, i) => `${p} ${ir.imperfetto[i]}`).join(', '),
        'Futuro semplice': persons.map((p, i) => `${p} ${ir.futuro[i]}`).join(', '),
        'Participio passato': ir.participio,
        'Gerundio': ir.gerundio
      };
      if (ir.present.includes(word)) {
        const idx = ir.present.indexOf(word);
        result.currentFormDetected = `Presente (${persons[idx]})`;
      }
    } else if (base.endsWith('are') || base.endsWith('ere') || base.endsWith('ire')) {
      const stem = base.slice(0, -3);
      const isAre = base.endsWith('are');
      const isEre = base.endsWith('ere');

      const presEndings = isAre 
        ? ['o', 'i', 'a', 'iamo', 'ate', 'ano']
        : (isEre ? ['o', 'i', 'e', 'iamo', 'ete', 'ono'] : ['o', 'i', 'e', 'iamo', 'ite', 'ono']);

      const futEndings = isAre || isEre
        ? ['erò', 'erai', 'erà', 'eremo', 'erete', 'eranno']
        : ['irò', 'irai', 'irà', 'iremo', 'irete', 'iranno'];

      const impEndings = isAre
        ? ['avo', 'avi', 'ava', 'avamo', 'avate', 'avano']
        : (isEre ? ['evo', 'evi', 'eva', 'evamo', 'evate', 'evano'] : ['ivo', 'ivi', 'iva', 'ivamo', 'ivate', 'ivano']);

      const part = isAre ? `${stem}ato` : (isEre ? `${stem}uto` : `${stem}ito`);
      const ger = isAre ? `${stem}ando` : `${stem}endo`;

      result.tenses = {
        'Presente indicativo': persons.map((p, i) => `${p} ${stem}${presEndings[i]}`).join(', '),
        'Passato prossimo': `ho ${part}`,
        'Imperfetto': persons.map((p, i) => `${p} ${stem}${impEndings[i]}`).join(', '),
        'Futuro semplice': persons.map((p, i) => `${p} ${stem}${futEndings[i]}`).join(', '),
        'Participio passato': part,
        'Gerundio': ger
      };

      const presForms = presEndings.map(e => `${stem}${e}`);
      if (presForms.includes(word)) {
        const idx = presForms.indexOf(word);
        result.currentFormDetected = `Presente (${persons[idx]})`;
      }
    }
  } else if (l === 'fr') {
    result.isVerb = true;
    const persons = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles'];
    const ir = FRENCH_IRREGULARS[base];

    if (ir) {
      result.tenses = {
        'Présent': persons.map((p, i) => `${p} ${ir.present[i]}`).join(', '),
        'Passé composé': `j'ai / je suis ${ir.passe_compose}`,
        'Imparfait': persons.map((p, i) => `${p} ${ir.imparfait[i]}`).join(', '),
        'Futur simple': persons.map((p, i) => `${p} ${ir.futur[i]}`).join(', '),
        'Participe passé': ir.participe,
        'Gérondif': ir.gerondif
      };
      if (ir.present.includes(word)) {
        const idx = ir.present.indexOf(word);
        result.currentFormDetected = `Présent (${persons[idx]})`;
      }
    } else if (base.endsWith('er')) {
      const stem = base.slice(0, -2);
      const pres = ['e', 'es', 'e', 'ons', 'ez', 'ent'].map(e => `${stem}${e}`);
      const fut = ['erai', 'eras', 'era', 'erons', 'erez', 'eront'].map(e => `${stem}${e}`);
      const imp = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'].map(e => `${stem}${e}`);

      result.tenses = {
        'Présent': persons.map((p, i) => `${p} ${pres[i]}`).join(', '),
        'Passé composé': `j'ai ${stem}é`,
        'Imparfait': persons.map((p, i) => `${p} ${imp[i]}`).join(', '),
        'Futur simple': persons.map((p, i) => `${p} ${fut[i]}`).join(', '),
        'Participe passé': `${stem}é`,
        'Gérondif': `en ${stem}ant`
      };

      if (pres.includes(word)) {
        const idx = pres.indexOf(word);
        result.currentFormDetected = `Présent (${persons[idx]})`;
      }
    }
  } else if (l === 'de') {
    result.isVerb = true;
    const persons = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'];
    const ir = GERMAN_IRREGULARS[base];

    if (ir) {
      result.tenses = {
        'Präsens': persons.map((p, i) => `${p} ${ir.praesens[i]}`).join(', '),
        'Präteritum': persons.map((p, i) => `${p} ${ir.praeteritum[i]}`).join(', '),
        'Partizip II': ir.partizip2,
        'Futur I': ir.futur1
      };
      if (ir.praesens.includes(word)) {
        const idx = ir.praesens.indexOf(word);
        result.currentFormDetected = `Präsens (${persons[idx]})`;
      }
    } else if (base.endsWith('en') || base.endsWith('n')) {
      const stem = base.endsWith('en') ? base.slice(0, -2) : base.slice(0, -1);
      const pres = ['e', 'st', 't', 'en', 't', 'en'].map(e => `${stem}${e}`);
      const praet = ['te', 'test', 'te', 'ten', 'tet', 'ten'].map(e => `${stem}${e}`);
      const part2 = `ge${stem}t`;

      result.tenses = {
        'Präsens': persons.map((p, i) => `${p} ${pres[i]}`).join(', '),
        'Präteritum (Imperfekt)': persons.map((p, i) => `${p} ${praet[i]}`).join(', '),
        'Perfekt / Partizip II': part2,
        'Futur I': `werde ${base}`
      };

      if (pres.includes(word)) {
        const idx = pres.indexOf(word);
        result.currentFormDetected = `Präsens (${persons[idx]})`;
      }
    }
  } else if (l === 'pt') {
    result.isVerb = true;
    const persons = ['eu', 'tu', 'ele/ela', 'nós', 'eles/elas'];

    if (base.endsWith('ar') || base.endsWith('er') || base.endsWith('ir')) {
      const stem = base.slice(0, -2);
      const isAr = base.endsWith('ar');
      const isEr = base.endsWith('er');

      const presEndings = isAr 
        ? ['o', 'as', 'a', 'amos', 'am']
        : (isEr ? ['o', 'es', 'e', 'emos', 'em'] : ['o', 'es', 'e', 'imos', 'em']);

      const pretPerf = isAr
        ? ['ei', 'aste', 'ou', 'amos', 'aram']
        : (isEr ? ['i', 'este', 'eu', 'emos', 'eram'] : ['i', 'iste', 'iu', 'imos', 'iram']);

      const fut = isAr || isEr
        ? ['arei', 'arás', 'ará', 'aremos', 'arão']
        : ['irei', 'irás', 'irá', 'iremos', 'irão'];

      const part = isAr ? `${stem}ado` : `${stem}ido`;
      const ger = isAr ? `${stem}ando` : `${stem}endo`;

      result.tenses = {
        'Presente do indicativo': persons.map((p, i) => `${p} ${stem}${presEndings[i]}`).join(', '),
        'Pretérito perfeito': persons.map((p, i) => `${p} ${stem}${pretPerf[i]}`).join(', '),
        'Futuro do presente': persons.map((p, i) => `${p} ${stem}${fut[i]}`).join(', '),
        'Particípio': part,
        'Gerúndio': ger
      };

      const presForms = presEndings.map(e => `${stem}${e}`);
      if (presForms.includes(word)) {
        const idx = presForms.indexOf(word);
        result.currentFormDetected = `Presente (${persons[idx]})`;
      } else if (pretPerf.map(e => `${stem}${e}`).includes(word)) {
        result.currentFormDetected = 'Pretérito perfeito';
      }
    }
  }

  return result;
}

function getReversoLink(lang, verb) {
  const langNames = {
    en: 'english',
    fr: 'french',
    de: 'german',
    it: 'italian',
    pt: 'portuguese'
  };
  const name = langNames[lang] || 'english';
  return `https://conjugator.reverso.net/conjugation-${name}-verb-${encodeURIComponent(verb)}.html`;
}

function getWordReferenceLink(lang, verb) {
  const codes = {
    en: 'en',
    fr: 'fr',
    it: 'it',
    pt: 'pt',
    de: 'de'
  };
  const code = codes[lang] || 'en';
  return `https://www.wordreference.com/conj/${code}verbs.aspx?v=${encodeURIComponent(verb)}`;
}
