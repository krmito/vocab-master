// VocabMaster Single Page Application

const STATE = {
  currentTab: 'dashboard',
  stats: null,
  studyCards: [],
  currentCardIndex: 0,
  cardRevealed: false,
  studyLang: null, // null: must select language/tag first
  studyTag: '',    // optional tag filter
  isListening: false,
  pronunciationResult: null,
  wordsList: [],
  wordsTotal: 0,
  wordsPage: 1,
  wordsLimit: 30,
  filterLang: 'all',
  filterSearch: '',
  filterTag: '',
  selectedWord: null,
  wikiLoading: false,
  wikiData: null,
  showConjugations: false,
  settings: null,
  notification: null
};

// Language configuration
const LANGS = {
  en: { name: 'Inglés', code: 'en-US', youglish: 'english' },
  fr: { name: 'Francés', code: 'fr-FR', youglish: 'french' },
  de: { name: 'Alemán', code: 'de-DE', youglish: 'german' },
  it: { name: 'Italiano', code: 'it-IT', youglish: 'italian' },
  pt: { name: 'Portugués', code: 'pt-BR', youglish: 'portuguese' }
};

// Voice Recognition & Pronunciation Evaluator
function evaluatePronunciation(targetWord, spokenText) {
  const cleanTarget = targetWord.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, '').trim();
  const cleanSpoken = spokenText.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, '').trim();

  if (cleanTarget === cleanSpoken) {
    return { score: 100, label: '¡Perfecto! 🎯', color: '#10b981', spoken: spokenText };
  }

  // Levenshtein distance for similarity ratio
  const lenT = cleanTarget.length;
  const lenS = cleanSpoken.length;
  const matrix = Array.from({ length: lenT + 1 }, () => Array(lenS + 1).fill(0));

  for (let i = 0; i <= lenT; i++) matrix[i][0] = i;
  for (let j = 0; j <= lenS; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenT; i++) {
    for (let j = 1; j <= lenS; j++) {
      const cost = cleanTarget[i - 1] === cleanSpoken[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[lenT][lenS];
  const maxLen = Math.max(lenT, lenS);
  const score = Math.max(0, Math.round(((maxLen - distance) / maxLen) * 100));

  if (score >= 85) {
    return { score, label: '¡Muy bien pronunciado! ✨', color: '#34d399', spoken: spokenText };
  } else if (score >= 60) {
    return { score, label: 'Cerca, pero revisa la dicción ⚠️', color: '#fbbf24', spoken: spokenText };
  } else {
    return { score, label: 'Necesitas practicarla un poco más ❌', color: '#f87171', spoken: spokenText };
  }
}

let activeRecognition = null;

async function startSpeechRecognition(targetWord, lang) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    notify('Tu navegador no soporta reconocimiento de voz (prueba en Chrome o Edge)', 'error');
    return;
  }

  // If already listening, stop it
  if (activeRecognition) {
    try { activeRecognition.abort(); } catch (e) {}
    activeRecognition = null;
    STATE.isListening = false;
    renderApp();
    return;
  }

  // Request microphone permission explicitly first
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    }
  } catch (err) {
    console.warn('Microphone permission check error:', err);
    notify('Por favor permite el acceso al micrófono en tu navegador', 'error');
    return;
  }

  STATE.isListening = true;
  STATE.pronunciationResult = null;
  renderApp();

  try {
    const recognition = new SpeechRecognition();
    recognition.lang = LANGS[lang]?.code || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    activeRecognition = recognition;

    recognition.onresult = (event) => {
      if (event.results && event.results.length > 0) {
        const spoken = event.results[0][0].transcript;
        STATE.pronunciationResult = evaluatePronunciation(targetWord, spoken);
      }
      STATE.isListening = false;
      activeRecognition = null;
      renderApp();
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      STATE.isListening = false;
      activeRecognition = null;
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        notify(`Aviso de micrófono: ${event.error}`, 'error');
      }
      renderApp();
    };

    recognition.onend = () => {
      STATE.isListening = false;
      activeRecognition = null;
      renderApp();
    };

    // Small delay to let browser finish DOM updates and mic allocation
    setTimeout(() => {
      if (activeRecognition === recognition) {
        try {
          recognition.start();
        } catch (e) {
          console.error('Error starting recognition:', e);
        }
      }
    }, 100);
  } catch (err) {
    console.error('Speech initialization error:', err);
    STATE.isListening = false;
    activeRecognition = null;
    notify('No se pudo iniciar el micrófono', 'error');
    renderApp();
  }
}

function toggleConjugations() {
  STATE.showConjugations = !STATE.showConjugations;
  renderApp();
}

function renderConjugationSection(wikiData, currentWord, lang) {
  if (!wikiData) return '';
  const conj = wikiData.conjugation;
  const isVerb = wikiData.partsOfSpeech?.includes('Verb') ||
                 wikiData.forms?.some(f => /verb|past|participle|pres|pret|fut|ind|pasado|presente|futuro/i.test(f)) ||
                 (conj && Object.keys(conj.tenses || {}).length > 0);

  if (!isVerb) return '';

  const lemma = wikiData.lemma || currentWord;
  const detected = conj?.currentFormDetected || (wikiData.forms?.length ? wikiData.forms.join(', ') : null);
  const tenses = conj?.tenses || {};
  const hasTenses = Object.keys(tenses).length > 0;

  return `
    <div style="margin-top:14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:0.75rem;font-weight:800;background:rgba(16,185,129,0.25);color:#34d399;padding:3px 8px;border-radius:6px;text-transform:uppercase;">
            ⚡ Verbo
          </span>
          <span style="font-size:0.95rem;font-weight:700;color:white;">
            Infinitivo / Base: <span style="color:#38bdf8;">${lemma}</span>
          </span>
          ${detected ? `<span style="font-size:0.8rem;color:#a7f3d0;background:rgba(16,185,129,0.18);padding:3px 8px;border-radius:6px;">Tiempo actual: <b>${detected}</b></span>` : ''}
        </div>
        <button class="btn btn-outline" onclick="toggleConjugations()" style="padding:6px 12px;font-size:0.85rem;color:#34d399;border-color:rgba(16,185,129,0.4);background:rgba(16,185,129,0.08);">
          ${STATE.showConjugations ? '▲ Ocultar conjugaciones' : '📖 Ver conjugaciones (Presente, Pasado, Futuro)'}
        </button>
      </div>

      ${STATE.showConjugations ? `
        <div class="animate-fade-in" style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;display:flex;flex-direction:column;gap:10px;">
          ${hasTenses ? `
            <div style="display:grid;grid-template-columns:1fr;gap:8px;">
              ${Object.entries(tenses).map(([tenseName, tenseValue]) => {
                const isCurrent = currentWord && tenseValue.toLowerCase().split(/[,\s]+/).includes(currentWord.toLowerCase());
                return `
                  <div style="display:flex;flex-direction:column;gap:3px;background:${isCurrent ? 'rgba(16,185,129,0.16)' : 'rgba(0,0,0,0.25)'};padding:10px 14px;border-radius:10px;border:1px solid ${isCurrent ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.05)'};">
                    <div style="font-size:0.75rem;font-weight:700;color:${isCurrent ? '#34d399' : 'var(--text-muted)'};text-transform:uppercase;letter-spacing:0.04em;">
                      ${isCurrent ? '👉 [FORMA ACTUAL] ' : ''}${tenseName}
                    </div>
                    <div style="font-size:0.95rem;font-weight:600;color:${isCurrent ? '#a7f3d0' : 'white'};">
                      ${tenseValue}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div style="font-size:0.85rem;color:var(--text-muted);">Tabla automática resumida no disponible. Consulta las matrices completas abajo:</div>'}

          <!-- External conjugator links -->
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            ${conj?.links?.reverso ? `
              <a href="${conj.links.reverso}" target="_blank" class="btn btn-outline" style="padding:6px 12px;font-size:0.8rem;text-decoration:none;color:#60a5fa;border-color:rgba(96,165,250,0.3);">
                🌐 Tabla completa en Reverso Conjugator ↗
              </a>
            ` : ''}
            ${conj?.links?.wordreference ? `
              <a href="${conj.links.wordreference}" target="_blank" class="btn btn-outline" style="padding:6px 12px;font-size:0.8rem;text-decoration:none;color:#a78bfa;border-color:rgba(167,139,250,0.3);">
                📖 WordReference Conjugador ↗
              </a>
            ` : ''}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// Notification toast helper
function notify(msg, type = 'info') {
  STATE.notification = { msg, type };
  renderNotification();
  setTimeout(() => {
    STATE.notification = null;
    renderNotification();
  }, 4000);
}

function renderNotification() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(el);
  }

  if (!STATE.notification) {
    el.innerHTML = '';
    return;
  }

  const { msg, type } = STATE.notification;
  const bg = type === 'error' ? 'rgba(239, 68, 68, 0.95)' : type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(99, 102, 241, 0.95)';

  el.innerHTML = `
    <div style="background:${bg};color:white;padding:12px 20px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.4);font-weight:600;font-size:0.95rem;display:flex;align-items:center;gap:10px;animation:fadeIn 0.2s ease;">
      <span>${msg}</span>
    </div>
  `;
}

// Text to speech
function speak(text, lang = 'en') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANGS[lang]?.code || 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

// Fetch APIs
async function apiGet(endpoint) {
  const res = await fetch(endpoint);
  return await res.json();
}

async function apiPost(endpoint, body = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

// Initial Load
async function init() {
  setupKeyboardShortcuts();
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    switchTab(hash);
  });

  const initialTab = window.location.hash.replace('#', '') || 'dashboard';
  await loadStats();
  await loadSettings();
  switchTab(initialTab);
}

async function loadStats() {
  try {
    const res = await apiGet('/api/stats');
    if (res.success) {
      STATE.stats = res;
    }
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

async function loadSettings() {
  try {
    const res = await apiGet('/api/settings');
    if (res.success) {
      STATE.settings = res;
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

function switchTab(tab) {
  STATE.currentTab = tab;
  window.location.hash = tab;
  renderApp();

  if (tab === 'study') {
    if (STATE.studyLang) {
      startStudySession(STATE.studyLang);
    } else {
      renderApp();
    }
  } else if (tab === 'words') {
    loadWords();
  } else if (tab === 'dashboard') {
    loadStats().then(() => renderApp());
  }
}

// Main Render
function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Top Navigation -->
    <nav>
      <div class="container" style="display:flex;align-items:center;justify-content:space-between;height:70px;">
        <div style="display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="window.location.hash='dashboard'">
          <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#06b6d4);display:flex;align-items:center;justify-content:center;font-size:1.3rem;">
            ⚡
          </div>
          <div>
            <div style="font-weight:800;font-size:1.15rem;letter-spacing:-0.02em;">VocabMaster</div>
            <div style="font-size:0.75rem;color:var(--text-dim);line-height:1;">5 Idiomas · Repetición Espaciada</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:6px;">
          <a href="#dashboard" class="nav-link ${STATE.currentTab === 'dashboard' ? 'active' : ''}">
            📊 Resumen
          </a>
          <a href="#study" class="nav-link ${STATE.currentTab === 'study' ? 'active' : ''}">
            🎯 Repasar
          </a>
          <a href="#words" class="nav-link ${STATE.currentTab === 'words' ? 'active' : ''}">
            📖 Diccionario
          </a>
          <a href="#settings" class="nav-link ${STATE.currentTab === 'settings' ? 'active' : ''}">
            ⚙️ Ajustes
          </a>
        </div>
      </div>
    </nav>

    <!-- Main Content Container -->
    <main class="container" style="padding-top:32px;padding-bottom:60px;">
      ${renderCurrentTab()}
    </main>

    <!-- Word Detail Modal -->
    ${STATE.selectedWord ? renderWordModal() : ''}
  `;
}

function renderCurrentTab() {
  switch (STATE.currentTab) {
    case 'dashboard':
      return renderDashboard();
    case 'study':
      return renderStudy();
    case 'words':
      return renderWords();
    case 'settings':
      return renderSettings();
    default:
      return renderDashboard();
  }
}

// ================= DASHBOARD =================
function renderDashboard() {
  const stats = STATE.stats || { totals: [], due: [], states: [], totalReviews: 0 };
  const totalWords = stats.totals.reduce((acc, r) => acc + Number(r.count), 0);
  const totalDue = stats.due.reduce((acc, r) => acc + Number(r.count), 0);

  const langOrder = ['en', 'fr', 'de', 'it', 'pt'];

  return `
    <div class="animate-fade-in" style="display:flex;flex-direction:column;gap:28px;">
      <!-- Hero Welcome -->
      <div class="glass" style="padding:32px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:20px;background:linear-gradient(135deg,rgba(99,102,241,0.15) 0%,rgba(6,182,212,0.1) 100%);">
        <div>
          <h1 style="font-size:2rem;font-weight:800;letter-spacing:-0.03em;margin-bottom:8px;">
            ¡Bienvenido de vuelta! 👋
          </h1>
          <p style="color:var(--text-muted);font-size:1.05rem;max-width:600px;">
            Tienes <b style="color:#60a5fa;">${totalDue} palabras</b> listas para repasar hoy según el algoritmo de repetición espaciada.
          </p>
        </div>
        <div style="display:flex;gap:12px;">
          <button class="btn btn-primary" onclick="window.location.hash='study'" style="padding:14px 28px;font-size:1.05rem;">
            🎯 Comenzar Repaso Diario
          </button>
          <button class="btn btn-secondary" onclick="syncLocalExcel()">
            🔄 Sincronizar Excel
          </button>
        </div>
      </div>

      <!-- Quick Stats Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
        <div class="glass" style="padding:22px;">
          <div style="font-size:0.85rem;color:var(--text-muted);font-weight:600;margin-bottom:4px;">TOTAL PALABRAS</div>
          <div style="font-size:2.2rem;font-weight:800;letter-spacing:-0.02em;">${totalWords.toLocaleString()}</div>
          <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;">Importadas de tu Excel</div>
        </div>
        <div class="glass" style="padding:22px;border-color:rgba(239,68,68,0.3);">
          <div style="font-size:0.85rem;color:#f87171;font-weight:600;margin-bottom:4px;">PENDIENTES HOY</div>
          <div style="font-size:2.2rem;font-weight:800;color:#f87171;letter-spacing:-0.02em;">${totalDue}</div>
          <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;">Programadas para hoy</div>
        </div>
        <div class="glass" style="padding:22px;">
          <div style="font-size:0.85rem;color:var(--text-muted);font-weight:600;margin-bottom:4px;">REPASOS COMPLETADOS</div>
          <div style="font-size:2.2rem;font-weight:800;letter-spacing:-0.02em;color:#34d399;">${stats.totalReviews}</div>
          <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;">Tarjetas calificadas</div>
        </div>
        <div class="glass" style="padding:22px;">
          <div style="font-size:0.85rem;color:var(--text-muted);font-weight:600;margin-bottom:4px;">ÚLTIMA SINCRONIZACIÓN</div>
          <div style="font-size:1.1rem;font-weight:700;margin-top:8px;word-break:break-all;">${stats.lastFileName || 'export.xls'}</div>
          <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px;">${stats.lastSync ? new Date(stats.lastSync).toLocaleString() : 'Reciente'}</div>
        </div>
      </div>

      <!-- Languages Breakdown -->
      <h2 style="font-size:1.3rem;font-weight:700;margin-top:10px;">Progreso por Idioma</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
        ${langOrder.map(lang => {
          const total = stats.totals.find(t => t.lang === lang)?.count || 0;
          const due = stats.due.find(d => d.lang === lang)?.count || 0;
          const info = LANGS[lang] || { name: lang.toUpperCase() };

          return `
            <div class="glass" style="padding:20px;cursor:pointer;transition:transform 0.2s;" onclick="startStudyLanguage('${lang}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <span class="lang-badge ${lang}">${lang}</span>
                <span style="font-size:0.85rem;font-weight:700;color:${due > 0 ? '#f87171' : '#34d399'};">
                  ${due > 0 ? `⏰ ${due} pendientes` : '✅ Al día'}
                </span>
              </div>
              <div style="font-size:1.25rem;font-weight:800;">${info.name}</div>
              <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">${total} palabras en total</div>
              <div style="margin-top:16px;">
                <button class="btn btn-outline" style="width:100%;padding:8px;font-size:0.85rem;">
                  Repasar ${info.name} →
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ================= STUDY MODE =================
async function startStudySession(lang = 'all', tag = '') {
  STATE.studyLang = lang;
  STATE.studyTag = tag;
  STATE.currentCardIndex = 0;
  STATE.cardRevealed = false;
  STATE.wikiData = null;
  STATE.pronunciationResult = null;
  STATE.isListening = false;

  try {
    const params = new URLSearchParams({ lang, limit: 50 });
    if (tag) params.append('tag', tag);
    const res = await apiGet(`/api/study/due?${params.toString()}`);
    if (res.success) {
      STATE.studyCards = res.cards;
    }
  } catch (err) {
    notify('Error cargando tarjetas para repasar', 'error');
  }
  renderApp();
}

function startStudyLanguage(lang, tag = '') {
  STATE.studyLang = lang;
  STATE.studyTag = tag;
  window.location.hash = 'study';
}

function chooseDifferentLanguage() {
  STATE.studyLang = null;
  STATE.studyTag = '';
  STATE.pronunciationResult = null;
  STATE.isListening = false;
  renderApp();
}

function renderStudy() {
  // If no language has been selected yet, show the Language & Tag Selection Screen
  if (!STATE.studyLang) {
    const stats = STATE.stats || { totals: [], due: [], tags: [] };
    const langOrder = ['en', 'fr', 'de', 'it', 'pt'];
    const totalDueAll = stats.due.reduce((acc, r) => acc + Number(r.count), 0);
    const totalWordsAll = stats.totals.reduce((acc, r) => acc + Number(r.count), 0);
    const tags = stats.tags || [];

    return `
      <div class="animate-fade-in" style="max-width:850px;margin:0 auto;display:flex;flex-direction:column;gap:28px;">
        <div style="text-align:center;padding:10px 0 6px 0;">
          <h1 style="font-size:2.2rem;font-weight:800;letter-spacing:-0.03em;margin-bottom:8px;">
            ¿Qué deseas repasar hoy? 🌍
          </h1>
          <p style="color:var(--text-muted);font-size:1.05rem;">
            Elige un idioma o filtra por tus etiquetas y listas favoritas.
          </p>
        </div>

        <!-- Languages Selection Grid -->
        <div>
          <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">
            Por Idioma
          </h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
            <!-- All Languages Card -->
            <div class="glass" style="padding:22px;border-radius:20px;cursor:pointer;transition:all 0.2s;display:flex;flex-direction:column;justify-content:space-between;border:1px solid rgba(99,102,241,0.35);background:linear-gradient(135deg,rgba(99,102,241,0.18),rgba(6,182,212,0.12));" onclick="startStudySession('all')" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='translateY(0)'">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                  <span class="glass-pill" style="font-size:0.75rem;font-weight:700;color:#818cf8;background:rgba(99,102,241,0.25);">TODOS</span>
                  <span style="font-size:0.85rem;font-weight:700;color:${totalDueAll > 0 ? '#f87171' : '#34d399'};">
                    ${totalDueAll > 0 ? `⏰ ${totalDueAll} pendientes` : '✅ Al día'}
                  </span>
                </div>
                <div style="font-size:1.4rem;font-weight:800;margin-bottom:4px;">Todos los idiomas</div>
                <div style="color:var(--text-muted);font-size:0.9rem;">${totalWordsAll.toLocaleString()} palabras en total</div>
              </div>
              <button class="btn btn-primary" style="margin-top:16px;width:100%;font-size:0.9rem;">
                Repasar Todo →
              </button>
            </div>

            <!-- Individual Language Cards -->
            ${langOrder.map(lang => {
              const total = stats.totals.find(t => t.lang === lang)?.count || 0;
              const due = stats.due.find(d => d.lang === lang)?.count || 0;
              const info = LANGS[lang] || { name: lang.toUpperCase() };

              return `
                <div class="glass" style="padding:22px;border-radius:20px;cursor:pointer;transition:all 0.2s;display:flex;flex-direction:column;justify-content:space-between;" onclick="startStudySession('${lang}')" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='translateY(0)'">
                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                      <span class="lang-badge ${lang}">${lang}</span>
                      <span style="font-size:0.85rem;font-weight:700;color:${due > 0 ? '#f87171' : '#34d399'};">
                        ${due > 0 ? `⏰ ${due} pendientes` : '✅ Al día'}
                      </span>
                    </div>
                    <div style="font-size:1.4rem;font-weight:800;margin-bottom:4px;">${info.name}</div>
                    <div style="color:var(--text-muted);font-size:0.9rem;">${total} palabras</div>
                  </div>
                  <button class="btn btn-secondary" style="margin-top:16px;width:100%;font-size:0.9rem;">
                    Repasar ${info.name} →
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Tags / Categories Selection Section -->
        ${tags.length > 0 ? `
          <div class="glass" style="padding:24px;border-radius:20px;">
            <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
              🏷️ Repasar por Etiquetas / Temas
            </h3>
            <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px;">
              Haz clic en cualquiera de tus listas temáticas para repasar exclusivamente ese tema:
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${tags.map(t => `
                <button class="btn btn-outline" style="padding:6px 14px;font-size:0.85rem;border-radius:9999px;background:rgba(255,255,255,0.03);" onclick="startStudySession('all', '${t.replace(/'/g, "\\'")}')">
                  🏷️ ${t}
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  const cards = STATE.studyCards || [];
  const card = cards[STATE.currentCardIndex];

  return `
    <div class="animate-fade-in" style="max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:20px;">
      <!-- Language & Tag Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;gap:6px;align-items:center;overflow-x:auto;padding-bottom:4px;">
          <button class="btn btn-outline" style="padding:6px 12px;font-size:0.85rem;" onclick="chooseDifferentLanguage()" title="Volver a elegir idioma o tag">
            ← Cambiar idioma/tag
          </button>
          <button class="btn ${STATE.studyLang === 'all' && !STATE.studyTag ? 'btn-primary' : 'btn-outline'}" style="padding:6px 14px;font-size:0.85rem;" onclick="startStudySession('all')">
            Todos
          </button>
          ${Object.keys(LANGS).map(l => `
            <button class="btn ${STATE.studyLang === l ? 'btn-primary' : 'btn-outline'}" style="padding:6px 14px;font-size:0.85rem;" onclick="startStudySession('${l}')">
              ${LANGS[l].name}
            </button>
          `).join('')}
        </div>
        <div style="font-size:0.9rem;color:var(--text-muted);font-weight:600;">
          ${STATE.studyTag ? `<span class="glass-pill" style="margin-right:8px;color:#818cf8;">🏷️ ${STATE.studyTag}</span>` : ''}
          ${cards.length > 0 ? `Tarjeta ${STATE.currentCardIndex + 1} de ${cards.length}` : '0 tarjetas'}
        </div>
      </div>

      <!-- Main Study Card -->
      ${!card ? `
        <div class="glass" style="padding:60px 30px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:12px;">🎉</div>
          <h2 style="font-size:1.6rem;font-weight:800;margin-bottom:8px;">¡Completaste tu sesión de repaso!</h2>
          <p style="color:var(--text-muted);max-width:450px;margin:0 auto 24px auto;">
            Has repasado todas las palabras pendientes para este filtro. ¡Excelente constancia!
          </p>
          <div style="display:flex;justify-content:center;gap:12px;">
            <button class="btn btn-primary" onclick="startStudySession('all')">Repasar todos los idiomas</button>
            <button class="btn btn-secondary" onclick="window.location.hash='words'">Explorar diccionario</button>
          </div>
        </div>
      ` : `
        <div class="glass" style="padding:36px;border-radius:24px;box-shadow:0 20px 40px -10px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:24px;">
          <!-- Card Top Bar -->
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="lang-badge ${card.lang}">${card.lang}</span>
              ${card.tags ? `<span class="glass-pill" style="font-size:0.75rem;color:var(--text-muted);">${card.tags}</span>` : ''}
            </div>
            <div style="font-size:0.8rem;color:var(--text-dim);font-weight:600;">
              Repasos: ${card.reps || 0} ${card.scheduled_days ? `· Intervalo: ${card.scheduled_days}d` : ''}
            </div>
          </div>

          <!-- Target Word Front -->
          <div style="text-align:center;padding:20px 0;">
            <h1 style="font-size:2.8rem;font-weight:800;letter-spacing:-0.03em;margin-bottom:8px;">
              ${card.word}
            </h1>
            ${card.transcription ? `
              <div style="font-family:var(--font-mono);color:#818cf8;font-size:1.15rem;margin-bottom:12px;">
                /${card.transcription}/
              </div>
            ` : ''}

            <!-- Pronunciation Action Buttons -->
            <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px;flex-wrap:wrap;">
              <button class="btn btn-secondary" onclick="speak('${card.word.replace(/'/g, "\\'")}', '${card.lang}')" title="Escuchar pronunciación nativa por voz (R)" style="padding:8px 16px;">
                🔊 Escuchar
              </button>
              <button class="btn ${STATE.isListening ? 'btn-primary' : 'btn-secondary'}" onclick="startSpeechRecognition('${card.word.replace(/'/g, "\\'")}', '${card.lang}')" style="padding:8px 16px;background:${STATE.isListening ? '#ef4444' : ''};" title="Habla por el micrófono y el sistema evaluará tu pronunciación">
                ${STATE.isListening ? '🎙️ Escuchándote...' : '🎤 Calificar mi pronunciación'}
              </button>
              <a href="https://youglish.com/pronounce/${encodeURIComponent(card.word)}/${LANGS[card.lang]?.youglish || 'english'}" target="_blank" class="btn btn-outline" style="padding:8px 16px;text-decoration:none;" title="Ver personas pronunciando esta palabra en videos de YouTube">
                🎬 YouGlish
              </a>
              <a href="https://forvo.com/word/${encodeURIComponent(card.word)}/#${card.lang}" target="_blank" class="btn btn-outline" style="padding:8px 16px;text-decoration:none;" title="Grabaciones de pronunciación de nativos en Forvo">
                🎙️ Forvo
              </a>
              <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(card.word + ' pronunciation ' + (LANGS[card.lang]?.name || card.lang))}" target="_blank" class="btn btn-outline" style="padding:8px 16px;text-decoration:none;">
                ▶️ YouTube
              </a>
            </div>

            <!-- Pronunciation Feedback Result -->
            ${STATE.pronunciationResult ? `
              <div class="animate-fade-in" style="margin-top:18px;padding:14px 20px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid ${STATE.pronunciationResult.color};display:inline-flex;flex-direction:column;align-items:center;gap:6px;">
                <div style="font-size:1.15rem;font-weight:800;color:${STATE.pronunciationResult.color};">
                  ${STATE.pronunciationResult.label} (${STATE.pronunciationResult.score}%)
                </div>
                <div style="font-size:0.85rem;color:var(--text-muted);">
                  Detectado: <b style="color:white;">"${STATE.pronunciationResult.spoken}"</b> · Objetivo: <b style="color:white;">"${card.word}"</b>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Divider / Flip Action -->
          ${!STATE.cardRevealed ? `
            <div style="text-align:center;padding-top:10px;">
              <button class="btn btn-primary" onclick="revealCard()" style="padding:14px 40px;font-size:1.05rem;border-radius:14px;">
                👁️ Mostrar Traducción y Ejemplos (Espacio)
              </button>
            </div>
          ` : `
            <!-- Card Back Revealed -->
            <div class="animate-fade-in" style="border-top:1px solid var(--border-subtle);padding-top:24px;display:flex;flex-direction:column;gap:20px;">
              <!-- Translation Section -->
              <div>
                <div style="font-size:0.8rem;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Traducción al español</div>
                <div style="font-size:1.4rem;font-weight:700;color:#34d399;">
                  ${card.translation || 'Sin traducción registrada'}
                </div>
                ${card.additional_translation ? `
                  <div style="font-size:0.95rem;color:var(--text-muted);margin-top:4px;">
                    ➕ <i>${card.additional_translation}</i>
                  </div>
                ` : ''}
              </div>

              <!-- Examples Section -->
              ${card.examples && card.examples.length > 0 ? `
                <div>
                  <div style="font-size:0.8rem;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Ejemplos prácticos</div>
                  <div style="display:flex;flex-direction:column;gap:10px;">
                    ${card.examples.map(ex => `
                      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);padding:14px;border-radius:12px;">
                        <div style="font-size:1rem;color:white;font-weight:500;margin-bottom:4px;">
                          "${ex.source}"
                          <button onclick="speak('${ex.source.replace(/'/g, "\\'")}', '${card.lang}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);margin-left:6px;" title="Escuchar frase">🔊</button>
                        </div>
                        ${ex.translation ? `<div style="font-size:0.9rem;color:var(--text-muted);">↳ ${ex.translation}</div>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <!-- Lemma / Root form / Wiktionary Inspector -->
              <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:14px;padding:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                  <span style="font-size:0.8rem;font-weight:700;color:#818cf8;text-transform:uppercase;letter-spacing:0.05em;">
                    🔍 Forma Original y Lema (Wiktionary)
                  </span>
                  ${!STATE.wikiData && !STATE.wikiLoading ? `
                    <button class="btn btn-outline" onclick="loadWiktionary(${card.id})" style="padding:4px 10px;font-size:0.8rem;">
                      Inspeccionar verbo/origen
                    </button>
                  ` : ''}
                </div>

                ${STATE.wikiLoading ? `
                  <div style="font-size:0.9rem;color:var(--text-muted);">Consultando Wiktionary para ${card.word}...</div>
                ` : STATE.wikiData ? `
                  <div>
                    ${STATE.wikiData.lemma && STATE.wikiData.lemma !== card.word ? `
                      <div style="font-size:1rem;font-weight:700;margin-bottom:6px;">
                        Forma base / Infinitivo: <span style="color:#38bdf8;">${STATE.wikiData.lemma}</span>
                        ${STATE.wikiData.forms?.length ? `<span style="font-size:0.85rem;color:var(--text-muted);font-weight:400;">(${STATE.wikiData.forms.join(', ')})</span>` : ''}
                      </div>
                    ` : ''}
                    ${STATE.wikiData.partsOfSpeech?.length ? `
                      <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:6px;">
                        Categoría: <b>${STATE.wikiData.partsOfSpeech.join(', ')}</b>
                      </div>
                    ` : ''}
                    ${STATE.wikiData.definitions?.length ? `
                      <div style="font-size:0.85rem;color:var(--text-muted);display:flex;flex-direction:column;gap:4px;">
                        ${STATE.wikiData.definitions.slice(0, 3).map(d => `
                          <div>• <b style="color:#a5b4fc;">[${d.pos}]</b> ${d.definition}</div>
                        `).join('')}
                      </div>
                    ` : '<div style="font-size:0.85rem;color:var(--text-muted);">Forma estándar confirmada.</div>'}
                    ${renderConjugationSection(STATE.wikiData, card.word, card.lang)}
                  </div>
                ` : `
                  <div style="font-size:0.85rem;color:var(--text-dim);">
                    ¿Es un verbo conjugado o palabra derivada? Haz clic arriba para ver el infinitivo y otras acepciones.
                  </div>
                `}
              </div>

              <!-- Rating Buttons (Spaced Repetition SM-2/FSRS) -->
              <div>
                <div style="font-size:0.8rem;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;text-align:center;">
                  ¿Cómo te resultó recordarla?
                </div>
                <div style="display:flex;gap:10px;">
                  <button class="btn-rating again" onclick="submitRating(${card.id}, 1)">
                    <div>🔄 Otra vez</div>
                    <span class="shortcut">10 min · [1]</span>
                  </button>
                  <button class="btn-rating hard" onclick="submitRating(${card.id}, 2)">
                    <div>😓 Difícil</div>
                    <span class="shortcut">+1 día · [2]</span>
                  </button>
                  <button class="btn-rating good" onclick="submitRating(${card.id}, 3)">
                    <div>👍 Bien</div>
                    <span class="shortcut">Graduar · [3]</span>
                  </button>
                  <button class="btn-rating easy" onclick="submitRating(${card.id}, 4)">
                    <div>⭐ Fácil</div>
                    <span class="shortcut">+3 días · [4]</span>
                  </button>
                </div>
              </div>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}

function revealCard() {
  STATE.cardRevealed = true;
  renderApp();
  // Auto load wiktionary for card
  const card = STATE.studyCards[STATE.currentCardIndex];
  if (card) {
    loadWiktionary(card.id);
  }
}

async function loadWiktionary(wordId) {
  STATE.wikiLoading = true;
  renderApp();
  try {
    const res = await apiGet(`/api/words/${wordId}/wiktionary`);
    if (res.success) {
      STATE.wikiData = res.data;
    }
  } catch (err) {
    console.error('Wiktionary load error:', err);
  } finally {
    STATE.wikiLoading = false;
    renderApp();
  }
}

async function submitRating(wordId, rating) {
  try {
    await apiPost('/api/study/review', { wordId, rating });
    STATE.currentCardIndex++;
    STATE.cardRevealed = false;
    STATE.wikiData = null;
    STATE.pronunciationResult = null;
    STATE.isListening = false;
    STATE.showConjugations = false;
    renderApp();
  } catch (err) {
    notify('Error guardando calificación', 'error');
  }
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (STATE.currentTab !== 'study') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const cards = STATE.studyCards || [];
    const card = cards[STATE.currentCardIndex];
    if (!card) return;

    if (e.code === 'Space' || e.code === 'Enter') {
      if (!STATE.cardRevealed) {
        e.preventDefault();
        revealCard();
      }
    } else if (e.key === 'r' || e.key === 'R') {
      speak(card.word, card.lang);
    } else if (STATE.cardRevealed) {
      if (e.key === '1') submitRating(card.id, 1);
      if (e.key === '2') submitRating(card.id, 2);
      if (e.key === '3') submitRating(card.id, 3);
      if (e.key === '4') submitRating(card.id, 4);
    }
  });
}

// ================= VOCABULARY EXPLORER =================
async function loadWords() {
  const params = new URLSearchParams({
    lang: STATE.filterLang,
    search: STATE.filterSearch,
    tag: STATE.filterTag,
    page: STATE.wordsPage,
    limit: STATE.wordsLimit
  });

  try {
    const res = await apiGet(`/api/words?${params.toString()}`);
    if (res.success) {
      STATE.wordsList = res.words;
      STATE.wordsTotal = res.total;
    }
  } catch (err) {
    notify('Error al cargar lista de palabras', 'error');
  }
  renderApp();
}

function renderWords() {
  return `
    <div class="animate-fade-in" style="display:flex;flex-direction:column;gap:20px;">
      <!-- Search & Filters Bar -->
      <div class="glass" style="padding:20px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <input 
            type="text" 
            placeholder="Buscar por palabra, traducción o ejemplo..." 
            value="${STATE.filterSearch}" 
            oninput="handleSearch(this.value)"
            style="flex:1;min-width:260px;background:rgba(0,0,0,0.3);border:1px solid var(--border-subtle);color:white;padding:12px 16px;border-radius:10px;font-family:inherit;font-size:0.95rem;outline:none;"
          >
          <div style="display:flex;gap:8px;">
            <select 
              onchange="handleFilterLang(this.value)" 
              style="background:#1e293b;border:1px solid var(--border-subtle);color:white;padding:12px 16px;border-radius:10px;font-family:inherit;cursor:pointer;outline:none;"
            >
              <option value="all" ${STATE.filterLang === 'all' ? 'selected' : ''}>Todos los idiomas</option>
              <option value="en" ${STATE.filterLang === 'en' ? 'selected' : ''}>Inglés (EN)</option>
              <option value="fr" ${STATE.filterLang === 'fr' ? 'selected' : ''}>Francés (FR)</option>
              <option value="de" ${STATE.filterLang === 'de' ? 'selected' : ''}>Alemán (DE)</option>
              <option value="it" ${STATE.filterLang === 'it' ? 'selected' : ''}>Italiano (IT)</option>
              <option value="pt" ${STATE.filterLang === 'pt' ? 'selected' : ''}>Portugués (PT)</option>
            </select>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.85rem;color:var(--text-muted);">
          <div>Total encontrados: <b>${STATE.wordsTotal.toLocaleString()}</b> palabras</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-outline" style="padding:4px 10px;" ${STATE.wordsPage <= 1 ? 'disabled' : ''} onclick="changePage(-1)">← Anterior</button>
            <span>Pág. ${STATE.wordsPage}</span>
            <button class="btn btn-outline" style="padding:4px 10px;" ${(STATE.wordsPage * STATE.wordsLimit) >= STATE.wordsTotal ? 'disabled' : ''} onclick="changePage(1)">Siguiente →</button>
          </div>
        </div>
      </div>

      <!-- Words Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;">
        ${STATE.wordsList.map(w => `
          <div class="glass" style="padding:20px;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;transition:transform 0.2s;" onclick="openWordModal(${w.id})" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <span class="lang-badge ${w.lang}">${w.lang}</span>
                ${w.tags ? `<span class="glass-pill" style="font-size:0.75rem;color:var(--text-muted);">${w.tags}</span>` : ''}
              </div>
              <div style="display:flex;align-items:baseline;gap:8px;">
                <span style="font-size:1.3rem;font-weight:800;letter-spacing:-0.02em;">${w.word}</span>
                ${w.transcription ? `<span style="font-family:var(--font-mono);font-size:0.85rem;color:#818cf8;">/${w.transcription}/</span>` : ''}
              </div>
              <div style="color:#34d399;font-weight:600;font-size:0.95rem;margin-top:6px;">
                ${w.translation}
              </div>
            </div>

            <div style="border-top:1px solid var(--border-subtle);margin-top:14px;padding-top:10px;display:flex;align-items:center;justify-content:space-between;font-size:0.8rem;color:var(--text-dim);">
              <span>${w.examples?.length ? `💬 ${w.examples.length} ejemplos` : 'Sin ejemplos'}</span>
              <span style="color:${w.reps > 0 ? '#60a5fa' : 'var(--text-dim)'};">${w.reps > 0 ? `Repasado ${w.reps}x` : 'Nueva'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

let searchTimer;
function handleSearch(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.filterSearch = val;
    STATE.wordsPage = 1;
    loadWords();
  }, 300);
}

function handleFilterLang(lang) {
  STATE.filterLang = lang;
  STATE.wordsPage = 1;
  loadWords();
}

function changePage(delta) {
  STATE.wordsPage += delta;
  loadWords();
}

// Word Inspection Modal
async function openWordModal(wordId) {
  const found = STATE.wordsList.find(w => w.id === wordId);
  if (!found) return;

  STATE.selectedWord = found;
  STATE.wikiData = null;
  renderApp();

  // Load wiktionary
  STATE.wikiLoading = true;
  renderApp();
  try {
    const res = await apiGet(`/api/words/${wordId}/wiktionary`);
    if (res.success) {
      STATE.wikiData = res.data;
    }
  } catch (err) {}
  finally {
    STATE.wikiLoading = false;
    renderApp();
  }
}

function closeWordModal() {
  STATE.selectedWord = null;
  STATE.wikiData = null;
  renderApp();
}

function renderWordModal() {
  const w = STATE.selectedWord;
  if (!w) return '';

  return `
    <div class="modal-overlay" onclick="closeWordModal()">
      <div class="modal-content" onclick="event.stopPropagation()" style="padding:28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="lang-badge ${w.lang}">${w.lang}</span>
            <span style="font-size:1.6rem;font-weight:800;">${w.word}</span>
            ${w.transcription ? `<span style="font-family:var(--font-mono);color:#818cf8;">/${w.transcription}/</span>` : ''}
          </div>
          <button onclick="closeWordModal()" class="btn btn-outline" style="padding:4px 10px;font-size:1.1rem;">✕</button>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="speak('${w.word.replace(/'/g, "\\'")}', '${w.lang}')" style="padding:6px 14px;font-size:0.85rem;">
            🔊 Escuchar
          </button>
          <a href="https://youglish.com/pronounce/${encodeURIComponent(w.word)}/${LANGS[w.lang]?.youglish || 'english'}" target="_blank" class="btn btn-outline" style="padding:6px 14px;font-size:0.85rem;text-decoration:none;">
            🎬 YouGlish
          </a>
          <a href="https://forvo.com/word/${encodeURIComponent(w.word)}/#${w.lang}" target="_blank" class="btn btn-outline" style="padding:6px 14px;font-size:0.85rem;text-decoration:none;">
            🎙️ Forvo
          </a>
          <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(w.word + ' pronunciation ' + (LANGS[w.lang]?.name || w.lang))}" target="_blank" class="btn btn-outline" style="padding:6px 14px;font-size:0.85rem;text-decoration:none;">
            ▶️ YouTube
          </a>
        </div>

        <!-- Translation -->
        <div style="margin-bottom:20px;">
          <div style="font-size:0.8rem;color:var(--text-dim);font-weight:700;text-transform:uppercase;">Traducción</div>
          <div style="font-size:1.3rem;font-weight:700;color:#34d399;margin-top:2px;">${w.translation}</div>
          ${w.additional_translation ? `<div style="color:var(--text-muted);font-size:0.95rem;margin-top:4px;">➕ ${w.additional_translation}</div>` : ''}
        </div>

        <!-- Wiktionary Root Lemma Analysis -->
        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:14px;padding:16px;margin-bottom:20px;">
          <div style="font-size:0.8rem;font-weight:700;color:#818cf8;text-transform:uppercase;margin-bottom:8px;">
            Forma original y lema (Wiktionary)
          </div>
          ${STATE.wikiLoading ? `
            <div style="font-size:0.9rem;color:var(--text-muted);">Consultando Wiktionary...</div>
          ` : STATE.wikiData ? `
            <div>
              ${STATE.wikiData.lemma ? `
                <div style="font-size:1.05rem;font-weight:700;margin-bottom:6px;">
                  Forma base: <span style="color:#38bdf8;">${STATE.wikiData.lemma}</span>
                  ${STATE.wikiData.forms?.length ? `<span style="font-size:0.85rem;color:var(--text-muted);font-weight:400;">(${STATE.wikiData.forms.join(', ')})</span>` : ''}
                </div>
              ` : ''}
              ${STATE.wikiData.partsOfSpeech?.length ? `
                <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:6px;">
                  Categoría gramatical: <b>${STATE.wikiData.partsOfSpeech.join(', ')}</b>
                </div>
              ` : ''}
              ${STATE.wikiData.definitions?.length ? `
                <div style="font-size:0.85rem;color:var(--text-muted);display:flex;flex-direction:column;gap:4px;">
                  ${STATE.wikiData.definitions.map(d => `
                    <div>• <b style="color:#a5b4fc;">[${d.pos}]</b> ${d.definition}</div>
                  `).join('')}
                </div>
              ` : '<div style="font-size:0.85rem;color:var(--text-muted);">Forma estándar confirmada.</div>'}
              ${renderConjugationSection(STATE.wikiData, w.word, w.lang)}
            </div>
          ` : `
            <div style="font-size:0.85rem;color:var(--text-dim);">No se encontraron desgloses gramaticales adicionales.</div>
          `}
        </div>

        <!-- Examples -->
        ${w.examples && w.examples.length > 0 ? `
          <div>
            <div style="font-size:0.8rem;color:var(--text-dim);font-weight:700;text-transform:uppercase;margin-bottom:8px;">Ejemplos</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${w.examples.map(ex => `
                <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);padding:12px;border-radius:10px;">
                  <div style="font-weight:500;">"${ex.source}" <button onclick="speak('${ex.source.replace(/'/g, "\\'")}', '${w.lang}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);">🔊</button></div>
                  ${ex.translation ? `<div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px;">↳ ${ex.translation}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ================= SETTINGS & INTEGRATIONS =================
function renderSettings() {
  const s = STATE.settings || {};

  return `
    <div class="animate-fade-in" style="max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:24px;">
      <h1 style="font-size:1.8rem;font-weight:800;letter-spacing:-0.02em;">Ajustes e Integraciones</h1>

      <!-- Google Drive Sync Section -->
      <div class="glass" style="padding:24px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:1.8rem;">📁</div>
          <div>
            <h2 style="font-size:1.2rem;font-weight:700;">Google Drive — Sincronización Automática</h2>
            <p style="font-size:0.85rem;color:var(--text-muted);">
              Detecta automáticamente cuando subas o actualices tu archivo Excel (.xls o .xlsx).
            </p>
          </div>
        </div>

        <div style="background:rgba(0,0,0,0.25);border:1px solid var(--border-subtle);padding:14px;border-radius:10px;font-size:0.85rem;color:var(--text-muted);">
          Estado de credenciales: ${s.hasServiceAccount ? '<b style="color:#34d399;">✅ Cuenta de servicio configurada</b>' : '<b style="color:#fbbf24;">⚠️ Falta GOOGLE_SERVICE_ACCOUNT_KEY en variables de entorno</b>'}
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <input 
            type="text" 
            id="cfgFolderId" 
            placeholder="ID de la carpeta de Google Drive (ej: 1AbCdEf...)" 
            value="${s.folderId || ''}"
            style="flex:1;background:rgba(0,0,0,0.3);border:1px solid var(--border-subtle);color:white;padding:10px 14px;border-radius:10px;font-family:inherit;font-size:0.9rem;"
          >
          <button class="btn btn-secondary" onclick="saveDriveFolder()">Guardar ID</button>
        </div>

        <div style="display:flex;gap:10px;">
          <button class="btn btn-primary" onclick="syncDriveNow()">
            ⚡ Sincronizar desde Google Drive
          </button>
          <button class="btn btn-secondary" onclick="syncLocalExcel()">
            💻 Sincronizar archivo local
          </button>
        </div>
      </div>

      <!-- Upload Excel Directly -->
      <div class="glass" style="padding:24px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:1.8rem;">📤</div>
          <div>
            <h2 style="font-size:1.2rem;font-weight:700;">Cargar Archivo Excel Directamente</h2>
            <p style="font-size:0.85rem;color:var(--text-muted);">
              También puedes arrastrar o seleccionar tu archivo .xls o .xlsx aquí en cualquier momento.
            </p>
          </div>
        </div>

        <input type="file" id="excelFileInput" accept=".xls,.xlsx" onchange="uploadExcelFile(this.files[0])" style="background:#1e293b;padding:12px;border-radius:10px;color:white;cursor:pointer;">
      </div>

      <!-- Google Calendar & Telegram Reminders -->
      <div class="glass" style="padding:24px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:1.8rem;">📅 💬</div>
          <div>
            <h2 style="font-size:1.2rem;font-weight:700;">Recordatorios (Google Calendar & Telegram)</h2>
            <p style="font-size:0.85rem;color:var(--text-muted);">
              Crea un evento en tu Google Calendar y te avisa por Telegram con un mini quiz diario.
            </p>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Hora del recordatorio diario:</label>
            <select id="cfgReminderHour" onchange="saveReminderHour(this.value)" style="width:100%;background:#1e293b;border:1px solid var(--border-subtle);color:white;padding:10px;border-radius:10px;cursor:pointer;">
              ${Array.from({length: 24}).map((_, i) => `
                <option value="${i}" ${parseInt(s.reminderHour || 9, 10) === i ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>
              `).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Telegram Bot Status:</label>
            <div style="padding:10px;background:rgba(0,0,0,0.3);border-radius:10px;font-size:0.85rem;">
              ${s.hasTelegram ? '<span style="color:#34d399;">✅ Bot activo</span>' : '<span style="color:#fbbf24;">⚠️ Falta TELEGRAM_BOT_TOKEN</span>'}
            </div>
          </div>
        </div>

        <div style="margin-top:10px;">
          <button class="btn btn-secondary" onclick="testRemindersNow()">
            🔔 Probar recordatorio ahora (Calendar + Telegram)
          </button>
        </div>
      </div>
    </div>
  `;
}

// Action Handlers
async function syncLocalExcel() {
  notify('Sincronizando archivo local del proyecto...', 'info');
  try {
    const res = await apiPost('/api/sync/local');
    if (res.success) {
      notify(`¡Éxito! Importadas ${res.stats.totalWords} palabras (${res.stats.added} nuevas, ${res.stats.updated} actualizadas).`, 'success');
      await loadStats();
      renderApp();
    } else {
      notify(res.error || 'No se pudo sincronizar el archivo local', 'error');
    }
  } catch (err) {
    notify('Error en la llamada de sincronización', 'error');
  }
}

async function syncDriveNow() {
  notify('Consultando Google Drive...', 'info');
  try {
    const res = await apiPost('/api/sync/drive');
    if (res.success) {
      if (res.updated) {
        notify(`¡Sincronizado desde Drive! Archivo: ${res.fileName}`, 'success');
      } else {
        notify(res.message || 'El archivo en Drive ya estaba al día.', 'info');
      }
      await loadStats();
      renderApp();
    } else {
      notify(res.reason || res.error || 'Error al conectar con Google Drive', 'error');
    }
  } catch (err) {
    notify('Error en sincronización con Drive', 'error');
  }
}

async function uploadExcelFile(file) {
  if (!file) return;
  notify('Subiendo e importando archivo Excel...', 'info');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const res = await fetch('/api/sync/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: arrayBuffer
    });
    const data = await res.json();
    if (data.success) {
      notify(`¡Subida completada! ${data.stats.totalWords} palabras procesadas.`, 'success');
      await loadStats();
      renderApp();
    } else {
      notify(data.error || 'Error al procesar archivo', 'error');
    }
  } catch (err) {
    notify('Error al subir archivo', 'error');
  }
}

async function saveDriveFolder() {
  const folderId = document.getElementById('cfgFolderId')?.value;
  await apiPost('/api/settings', { folderId });
  notify('ID de carpeta de Drive guardado', 'success');
  await loadSettings();
}

async function saveReminderHour(val) {
  await apiPost('/api/settings', { reminderHour: val });
  notify(`Hora configurada para las ${String(val).padStart(2, '0')}:00`, 'success');
  await loadSettings();
}

async function testRemindersNow() {
  notify('Disparando prueba de recordatorios...', 'info');
  try {
    const res = await apiPost('/api/remind/now');
    if (res.success) {
      notify('¡Prueba completada! Revisa tu Google Calendar y Telegram.', 'success');
    } else {
      notify(res.error || 'No se pudo completar la prueba', 'error');
    }
  } catch (err) {
    notify('Error al probar recordatorios', 'error');
  }
}

// Global exposure for inline HTML event handlers
window.startStudySession = startStudySession;
window.startStudyLanguage = startStudyLanguage;
window.chooseDifferentLanguage = chooseDifferentLanguage;
window.startSpeechRecognition = startSpeechRecognition;
window.toggleConjugations = toggleConjugations;
window.revealCard = revealCard;
window.submitRating = submitRating;
window.speak = speak;
window.loadWiktionary = loadWiktionary;
window.handleSearch = handleSearch;
window.handleFilterLang = handleFilterLang;
window.changePage = changePage;
window.openWordModal = openWordModal;
window.closeWordModal = closeWordModal;
window.syncLocalExcel = syncLocalExcel;
window.syncDriveNow = syncDriveNow;
window.uploadExcelFile = uploadExcelFile;
window.saveDriveFolder = saveDriveFolder;
window.saveReminderHour = saveReminderHour;
window.testRemindersNow = testRemindersNow;

// Boot
init();
