
// ══════════════════════════════════════════════
// LİDERLİK TABLOSU (ONLINE LEADERBOARD) — Firebase Firestore + Anonymous Auth
// ══════════════════════════════════════════════
// GÜVENLİK NOTU: Firebase Web API anahtarı ("apiKey") gizli bir sır DEĞİLDİR;
// istemci tarafında herkese açık olması normaldir (Google'ın kendi dokümantasyonu
// bunu doğrular). Gerçek güvenlik, aşağıdaki Firestore GÜVENLİK KURALLARI ile
// sağlanır — anahtarı "gizlemek" spam/bot koruması sağlamaz, kurallar sağlar.
//
// 1) https://console.firebase.google.com adresinden ücretsiz bir proje oluştur.
// 2) Build > Authentication > Sign-in method -> "Anonymous" sağlayıcısını AÇ.
//    (Bot korumasının temeli budur: her ziyaretçiye sunucu tarafında doğrulanan,
//    sahtesi kolay üretilemeyen bir kimlik (uid) verir.)
// 3) Build > Firestore Database -> Create database (production mode).
// 4) Firestore kurallarını (Rules sekmesi) şu şekilde ayarla:
//
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{database}/documents {
//          match /{collection}/{doc} {
//            allow read: if true;
//            // Sadece anonim de olsa GİRİŞ YAPMIŞ (auth.uid dolu) istemciler
//            // skor gönderebilir; ayrıca gönderdiği "uid" alanı kendi kimliğiyle
//            // eşleşmeli (başkası adına sahte kayıt atılamaz).
//            allow create: if request.auth != null
//                          && request.resource.data.uid == request.auth.uid
//                          && request.resource.data.nickname is string
//                          && request.resource.data.nickname.size() >= 1
//                          && request.resource.data.nickname.size() <= 16
//                          && request.resource.data.score is number
//                          && request.resource.data.score >= 0
//                          && request.resource.data.score <= 100000;
//            allow update, delete: if false;
//          }
//        }
//      }
//
//    İSTEĞE BAĞLI EK KORUMA: Daha güçlü bot/spam koruması için Firebase
//    App Check (reCAPTCHA v3 tabanlı) eklemeni öneririz — konsoldan
//    "App Check" bölümünden birkaç adımda etkinleştirilir, kod tarafında
//    ek bir script + site key eklemek yeterlidir.
//
// 5) Proje Ayarları > Genel > "Web uygulaması ekle" ile bir web app oluştur,
//    sana verilen firebaseConfig objesini aşağıya yapıştır.
const firebaseConfig = {
  apiKey: "AIzaSyAdXHwXM4GNS7UPsGr_FqSyEtDE_6UMzXc",
  authDomain: "thegeographers-5b9d0.firebaseapp.com",
  projectId: "thegeographers-5b9d0",
  storageBucket: "thegeographers-5b9d0.firebasestorage.app",
  messagingSenderId: "53933741066",
  appId: "1:53933741066:web:3f6090804c80ef0e3e7bf3"
};

let lbDb = null;
let lbAuthUid = null;          // Anonim oturumun uid'si — hazır olunca dolar
let lbAuthReady = null;        // signInAnonymously() promise'i (skor göndermeden önce beklenir)

try {
  if (firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('BURAYA_') === -1 && window.firebase) {
    firebase.initializeApp(firebaseConfig);
    lbDb = firebase.firestore();
    if (firebase.auth) {
      lbAuthReady = firebase.auth().signInAnonymously()
        .then(cred => { lbAuthUid = cred.user.uid; })
        .catch(err => {
          console.warn('Anonim oturum açılamadı (liderlik tablosuna skor gönderilemeyecek):', err);
          lbAuthUid = null;
        });
      firebase.auth().onAuthStateChanged(user => { lbAuthUid = user ? user.uid : null; });
    } else {
      console.warn('Firebase Auth SDK yüklenmemiş — liderlik tablosu salt-okunur çalışacak.');
    }
  }
} catch (e) { console.warn('Firebase başlatılamadı:', e); }

// Her oyun modu İÇİN + süre ayarı İÇİN ayrı Firestore koleksiyonu.
// Örn: "Haritada Bul" + 2 Dakika -> lb_find_120, "Haritada Bul" + 5 Dakika -> lb_find_300
// Kronometre (-1) modu skor mantığı farklı olduğu için liderlik tablosuna dahil değil.
const LB_VALID_DURATIONS = {
  search:  [300, 900, 1200],
  find:    [60, 120, 180, 300],
  capital: [60, 120, 180, 300],
  guess:   [60, 120, 180, 300],
  flag:    [300, 600],
  tabu2:   null // tabu2 süre bazlı değil, tek tablo
};
const LB_DURATION_LABELS = {
  60: '1 DK', 120: '2 DK', 180: '3 DK', 300: '5 DK',
  600: '10 DK', 900: '15 DK', 1200: '20 DK'
};
function lbCollectionName(modeKey, duration) {
  if (modeKey === 'tabu2') return 'lb_tabu2';
  const valid = LB_VALID_DURATIONS[modeKey] || [];
  const d = valid.includes(duration) ? duration : valid[0];
  return 'lb_' + modeKey + '_' + d;
}
function lbDurationLabel(duration) {
  return LB_DURATION_LABELS[duration] || '';
}

const LB_TITLES_TR = {
  search:  '🏆 İSİM → HARİTA — LİDERLİK',
  find:    '🏆 HARİTADA BUL — LİDERLİK',
  capital: '🏆 BAŞKENTİ BUL — LİDERLİK',
  guess:   '🏆 ÜLKE TAHMİN ET — LİDERLİK',
  flag:    '🏆 BAYRAK BUL — LİDERLİK',
  tabu2:   '🏆 ÖZEL TABU — LİDERLİK'
};
function lbGetTitle(modeKey) {
  let base;
  if (typeof t !== 'function') base = LB_TITLES_TR[modeKey] || '🏆 LİDERLİK TABLOSU';
  else {
    const key = 'lb_title_' + modeKey;
    const val = t(key);
    base = (val && val !== key) ? val : (LB_TITLES_TR[modeKey] || '🏆 LİDERLİK TABLOSU');
  }
  const label = lbDurationLabel(lbCurrentDuration);
  return label ? base + ' (' + label + ')' : base;
}

let lbCurrentMode = null;
let lbCurrentScore = 0;
let lbCurrentPct = null;
let lbCurrentDuration = null;
let lbAlreadySubmitted = false;

function lbGetNickname() {
  return localStorage.getItem('geo_nickname') || '';
}
function lbSaveNickname(name) {
  localStorage.setItem('geo_nickname', name);
}

// Bir oyun modu bittiğinde bu fonksiyon çağrılır: modalı açmadan sadece
// "skoru gönder" state'ini hazırlar; buton her end-ekranına eklenir.
function lbPrepare(modeKey, score, pct, duration) {
  lbCurrentMode = modeKey;
  lbCurrentScore = Math.max(0, Math.round(score));
  lbCurrentPct = (typeof pct === 'number' && !isNaN(pct)) ? Math.max(0, Math.min(100, Math.round(pct))) : null;
  lbCurrentDuration = (typeof duration === 'number') ? duration : null;
  lbAlreadySubmitted = false;
}

function lbOpenModal(modeKey, score, pct, duration) {
  if (typeof score === 'number') lbPrepare(modeKey, score, pct, duration);
  else lbCurrentMode = modeKey;
  document.getElementById('lb-title').textContent = lbGetTitle(lbCurrentMode);
  document.getElementById('lb-nickname-input').value = lbGetNickname();
  const submitBtn = document.getElementById('lb-submit-btn');
  submitBtn.style.display = (typeof lbCurrentScore === 'number' && !lbAlreadySubmitted) ? 'block' : 'none';
  document.getElementById('lb-status').textContent = '';
  document.getElementById('lb-overlay').style.display = 'flex';
  lbRenderList();
}

function lbCloseModal() {
  document.getElementById('lb-overlay').style.display = 'none';
}

function lbRenderList() {
  const list = document.getElementById('lb-list');
  const empty = document.getElementById('lb-empty');
  const status = document.getElementById('lb-status');
  if (!lbDb) {
    list.innerHTML = '';
    empty.style.display = 'none';
    status.textContent = t('lb_not_connected');
    return;
  }
  status.textContent = t('lb_loading');
  const myNick = lbGetNickname();
  lbDb.collection(lbCollectionName(lbCurrentMode, lbCurrentDuration))
    .orderBy('score', 'desc')
    .limit(10)
    .get()
    .then(snap => {
      status.textContent = '';
      if (snap.empty) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      let i = 0;
      list.innerHTML = snap.docs.map(doc => {
        i++;
        const d = doc.data();
        const isMe = myNick && d.nickname === myNick;
        const cls = 'lb-row' + (i === 1 ? ' lb-first' : '') + (isMe ? ' lb-me' : '');
        const medal = i === 1 ? '🥇' : i === 2 ? '🥈' : i === 3 ? '🥉' : i;
        const pctHtml = (typeof d.pct === 'number') ? '<span class="lb-pct">' + d.pct + '%</span>' : '';
        return '<li class="' + cls + '">' +
          '<span class="lb-rank">' + medal + '</span>' +
          '<span class="lb-nick">' + lbEscape(d.nickname || '???') + '</span>' +
          pctHtml +
          '<span class="lb-score">' + d.score + '</span></li>';
      }).join('');
    })
    .catch(err => {
      console.error(err);
      status.textContent = t('lb_error_load');
    });
}

function lbEscape(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function lbSubmitCurrentScore() {
  const input = document.getElementById('lb-nickname-input');
  const nickname = (input.value || '').trim().slice(0, 16);
  const status = document.getElementById('lb-status');
  if (!nickname) {
    status.textContent = t('lb_error_nickname');
    input.focus();
    return;
  }
  if (!lbDb) {
    status.textContent = t('lb_not_connected');
    return;
  }
  lbSaveNickname(nickname);
  const submitBtn = document.getElementById('lb-submit-btn');
  submitBtn.disabled = true;
  status.textContent = t('lb_sending');

  // Skoru göndermeden önce anonim oturumun hazır olduğundan emin ol.
  // (Firestore kuralları request.auth != null şartını arıyor — bkz. yukarıdaki yorum.)
  Promise.resolve(lbAuthReady).then(() => {
    if (!lbAuthUid) throw new Error('no-auth-uid');
    const docData = {
      uid: lbAuthUid,
      nickname: nickname,
      score: lbCurrentScore,
      ts: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (typeof lbCurrentPct === 'number') docData.pct = lbCurrentPct;
    return lbDb.collection(lbCollectionName(lbCurrentMode, lbCurrentDuration)).add(docData);
  }).then(() => {
    lbAlreadySubmitted = true;
    submitBtn.style.display = 'none';
    status.textContent = t('lb_sent');
    lbRenderList();
  }).catch(err => {
    console.error(err);
    submitBtn.disabled = false;
    status.textContent = t('lb_error_send');
  });
}

// ══════════════════════════════════════════════
// TÜM LİDERLİK TABLOLARI TARAYICISI
// (mod seç → o modun süre bazlı tablolarını göster)
// ══════════════════════════════════════════════
const LB_BROWSER_MODES = [
  { key: 'search',  icon: '📍' },
  { key: 'find',    icon: '🗺' },
  { key: 'capital', icon: '🏛' },
  { key: 'guess',   icon: '🌍' },
  { key: 'flag',    icon: '🏳' },
  { key: 'tabu2',   icon: '🎲' }
];

let lbBrowserMode = null;
let lbBrowserDuration = null;

function lbBrowserModeLabel(modeKey) {
  const key = 'mode_' + modeKey;
  const val = (typeof t === 'function') ? t(key) : null;
  return (val && val !== key) ? val : modeKey.toUpperCase();
}

function lbBrowserOpen() {
  lbBrowserMode = null;
  lbBrowserDuration = null;
  document.getElementById('lb-browser-title').textContent = t('lb_browser_title');
  document.getElementById('lb-browser-back-btn').style.display = 'none';
  document.getElementById('lb-browser-subtitle').style.display = 'block';
  document.getElementById('lb-browser-modes').style.display = 'grid';
  document.getElementById('lb-browser-durations').style.display = 'none';
  lbBrowserRenderModes();
  document.getElementById('lb-browser-overlay').style.display = 'flex';
}

function lbBrowserRenderModes() {
  const container = document.getElementById('lb-browser-modes');
  container.innerHTML = LB_BROWSER_MODES.map(m =>
    '<button class="lb-mode-btn" onclick="lbBrowserSelectMode(\'' + m.key + '\')">' +
      '<div style="font-size:22px;margin-bottom:6px;">' + m.icon + '</div>' +
      lbEscape(lbBrowserModeLabel(m.key)) +
    '</button>'
  ).join('');
}

function lbBrowserSelectMode(modeKey) {
  lbBrowserMode = modeKey;
  document.getElementById('lb-browser-title').textContent = lbBrowserModeLabel(modeKey);
  document.getElementById('lb-browser-back-btn').style.display = 'block';
  document.getElementById('lb-browser-subtitle').style.display = 'none';
  document.getElementById('lb-browser-modes').style.display = 'none';
  document.getElementById('lb-browser-durations').style.display = 'flex';

  const valid = LB_VALID_DURATIONS[modeKey];
  const tabsEl = document.getElementById('lb-browser-duration-tabs');
  if (!valid) {
    // tabu2: süre bazlı değil, tek tablo
    tabsEl.innerHTML = '';
    tabsEl.style.display = 'none';
    lbBrowserDuration = null;
    lbBrowserLoadTable();
    return;
  }
  tabsEl.style.display = 'flex';
  lbBrowserDuration = valid[0];
  tabsEl.innerHTML = valid.map(d =>
    '<button class="lb-dur-tab' + (d === lbBrowserDuration ? ' active' : '') + '" data-dur="' + d + '" onclick="lbBrowserSelectDuration(' + d + ')">' +
      lbEscape(lbDurationLabel(d)) +
    '</button>'
  ).join('');
  lbBrowserLoadTable();
}

function lbBrowserSelectDuration(d) {
  lbBrowserDuration = d;
  document.querySelectorAll('#lb-browser-duration-tabs .lb-dur-tab').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.dur) === d);
  });
  lbBrowserLoadTable();
}

function lbBrowserLoadTable() {
  const list = document.getElementById('lb-browser-list');
  const empty = document.getElementById('lb-browser-empty');
  const status = document.getElementById('lb-browser-status');
  if (!lbDb) {
    list.innerHTML = '';
    empty.style.display = 'none';
    status.textContent = t('lb_not_connected');
    return;
  }
  status.textContent = t('lb_loading');
  list.innerHTML = '';
  empty.style.display = 'none';
  const myNick = lbGetNickname();
  lbDb.collection(lbCollectionName(lbBrowserMode, lbBrowserDuration))
    .orderBy('score', 'desc')
    .limit(10)
    .get()
    .then(snap => {
      status.textContent = '';
      if (snap.empty) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      let i = 0;
      list.innerHTML = snap.docs.map(doc => {
        i++;
        const d = doc.data();
        const isMe = myNick && d.nickname === myNick;
        const cls = 'lb-row' + (i === 1 ? ' lb-first' : '') + (isMe ? ' lb-me' : '');
        const medal = i === 1 ? '🥇' : i === 2 ? '🥈' : i === 3 ? '🥉' : i;
        const pctHtml = (typeof d.pct === 'number') ? '<span class="lb-pct">' + d.pct + '%</span>' : '';
        return '<li class="' + cls + '">' +
          '<span class="lb-rank">' + medal + '</span>' +
          '<span class="lb-nick">' + lbEscape(d.nickname || '???') + '</span>' +
          pctHtml +
          '<span class="lb-score">' + d.score + '</span></li>';
      }).join('');
    })
    .catch(err => {
      console.error(err);
      status.textContent = t('lb_error_load');
    });
}

function lbBrowserBack() {
  lbBrowserMode = null;
  lbBrowserDuration = null;
  document.getElementById('lb-browser-title').textContent = t('lb_browser_title');
  document.getElementById('lb-browser-back-btn').style.display = 'none';
  document.getElementById('lb-browser-subtitle').style.display = 'block';
  document.getElementById('lb-browser-modes').style.display = 'grid';
  document.getElementById('lb-browser-durations').style.display = 'none';
}

function lbBrowserClose() {
  document.getElementById('lb-browser-overlay').style.display = 'none';
}

// ══════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════
/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */

;
;

/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


// ══════════════════════════════════════════════
// FİZİKİ HARİTA VERİLERİ
// ══════════════════════════════════════════════
/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */



/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */


// ══════════════════════════════════════════════
// ŞEHİR FONKSİYONLARI MODU — VERİ SETİ
// ══════════════════════════════════════════════
// Her fonksiyon tipi için renk, ikon ve çeviri anahtarı
/* -> moved to data.js / translations.js */


// Her şehir: id, ad (TR/EN), ülke (TR/EN), koordinat, fonksiyon(lar), açıklama (TR/EN)
/* -> moved to data.js / translations.js */


/* -> moved to data.js / translations.js */



// ══════════════════════════════════════════════
// BAYRAK EMOJI HARİTASI (ISO 3166-1 numeric → alpha-2 → emoji)
// ══════════════════════════════════════════════
/* -> moved to data.js / translations.js */


function getFlag(numericId) {
  const alpha2 = FLAG_MAP[numericId];
  if (!alpha2) return '🏳';
  return alpha2.toUpperCase().replace(/./g, c =>
    String.fromCodePoint(c.charCodeAt(0) + 127397)
  );
}

// Windows/masaüstü tarayıcılarda bayrak emojileri genelde ülke kodu harfleri
// (örn. "TR") olarak görünüyor çünkü sistem fontunda renkli bayrak glifi yok.
// Bunun yerine flagcdn.com üzerinden gerçek bayrak GÖRSELİ (PNG) kullanıyoruz;
// görsel yüklenemezse emoji bayrağa geri dönülür.
function handleFlagImgError(imgEl) {
  const span = document.createElement('span');
  span.textContent = imgEl.dataset.emoji || '🏳';
  span.style.fontSize = imgEl.dataset.emojiSize || '52px';
  span.style.lineHeight = '1';
  imgEl.replaceWith(span);
}
function getFlagImgHtml(numericId, sizePx, inline) {
  const alpha2raw = FLAG_MAP[numericId];
  const emojiFallback = getFlag(numericId);
  if (!alpha2raw) return emojiFallback;
  const alpha2 = alpha2raw.toLowerCase();
  const w = sizePx || 64;
  const displayStyle = inline
    ? 'display:inline-block;vertical-align:middle;margin:0 2px;border-radius:2px;'
    : 'display:block;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  return '<img src="https://flagcdn.com/w160/' + alpha2 + '.png" ' +
    'alt="' + alpha2.toUpperCase() + '" data-emoji="' + emojiFallback + '" data-emoji-size="' + w + 'px" ' +
    'style="width:' + w + 'px;height:auto;' + displayStyle + '" ' +
    'loading="lazy" onerror="handleFlagImgError(this)">';
}

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let currentMode = 'search';
let currentRegion = 'all';
let foundCountries = new Set();
let searchHighlighted = null;

let quizCorrect = 0, quizWrong = 0, quizStreak = 0, quizMaxStreak = 0;
let currentQuestion = null;
let waitingNext = false;
let usedIds = new Set();

// Timer state (search modu)
let timerSeconds = 0;       // seçili süre (0 = süresiz, -1 = kronometre)
let timerRemaining = 0;
let timerInterval = null;
let timerRunning = false;
let timerChronoElapsed = 0; // kronometre modu için geçen süre

// Quiz Timer state (find/guess modları)
let quizTimerSeconds = 300;
let quizTimerRemaining = 0;
let quizTimerInterval = null;
let quizTimerRunning = false;

let svg, g, path, zoom, projection;
let countryPaths = {};
let baseStroke = 0.6; // vector-effect:non-scaling-stroke sayesinde her zoom seviyesinde sabit kalır

// ══════════════════════════════════════════════
// HATA YÖNETİMİ — Harita verisi yükleme
// ══════════════════════════════════════════════
// Dünya sınır verisi (world-atlas) birden fazla modda (klasik harita,
// Türkiye haritası, interaktif harita) kullanılıyor. Bunu TEK bir yerden,
// önbellekli ve hataya dayanıklı şekilde yüklüyoruz: ağ hatası olursa
// uygulama beyaz ekranda kalmak yerine kullanıcıya "Tekrar Dene" butonlu
// bir uyarı gösterir; aynı veri birden fazla kez indirilmez.
const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
let _worldAtlasPromise = null;

function loadWorldAtlas() {
  if (window._worldData) return Promise.resolve(window._worldData);
  if (_worldAtlasPromise) return _worldAtlasPromise;
  _worldAtlasPromise = fetch(WORLD_ATLAS_URL)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(world => {
      window._worldData = world;
      hideDataErrorBanner();
      return world;
    })
    .catch(err => {
      _worldAtlasPromise = null; // bir sonraki denemede tekrar fetch edilsin
      console.error('Harita verisi yüklenemedi:', err);
      showDataErrorBanner();
      throw err;
    });
  return _worldAtlasPromise;
}

// Kullanıcıya gösterilen, sayfayı beyaz ekranda bırakmayan hata bandı.
function showDataErrorBanner() {
  let banner = document.getElementById('data-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'data-error-banner';
    banner.setAttribute('role', 'alert');
    banner.innerHTML =
      '<span>⚠ Harita verileri yüklenemedi. İnternet bağlantınızı kontrol edin.</span>' +
      '<button type="button" id="data-error-retry">Tekrar Dene</button>';
    document.body.appendChild(banner);
    document.getElementById('data-error-retry').addEventListener('click', () => {
      hideDataErrorBanner();
      loadWorldAtlas().then(() => {
        if (typeof initMap === 'function' && document.getElementById('world-svg') && !g) initMap();
      }).catch(() => {});
    });
  }
  banner.classList.add('show');
}
function hideDataErrorBanner() {
  const banner = document.getElementById('data-error-banner');
  if (banner) banner.classList.remove('show');
}

// Son çare güvenlik ağı: beklenmeyen bir JS hatası ya da yakalanmamış promise
// reddi olduğunda konsola düşsün, uygulama sessizce "donmuş" görünmesin.
window.addEventListener('error', (e) => {
  console.error('Beklenmeyen hata:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Yakalanmamış promise hatası:', e.reason);
});

// ══════════════════════════════════════════════
// INIT MAP
// ══════════════════════════════════════════════
function initMap() {
  const w = window.innerWidth, h = window.innerHeight;
  svg = d3.select('#world-svg');
  projection = d3.geoNaturalEarth1().scale(w / 6.2).translate([w/2, h/2 - 120]);
  path = d3.geoPath().projection(projection);

  // Sınır kalınlığı: vector-effect:non-scaling-stroke ile zoom'dan bağımsız sabit kalınlık
  baseStroke = 0.6;

  zoom = d3.zoom().scaleExtent([0.4, 80]).on('zoom', (e) => {
    g.attr('transform', e.transform);
    const k = e.transform.k;
    // vector-effect:non-scaling-stroke sayesinde stroke-width artık zoom'dan bağımsız sabit kalıyor
    g.selectAll('.small-country-dot').attr('r', 2/Math.sqrt(k)).attr('stroke-width', Math.max(0.3, 0.5/k));
    g.selectAll('.graticule').attr('stroke-width', Math.max(baseStroke * 0.5, (baseStroke * 3.5) / k));
    document.getElementById('zoom-val').textContent = k.toFixed(1) + '×';
    updateCapitalDotPosition();
    updatePhysicalOverlay();
    updateCityFuncOverlay();
  });
  svg.call(zoom);
  const mc = document.getElementById('map-container');
  svg.on('mousedown', () => mc.classList.add('dragging'));
  window.addEventListener('mouseup', () => mc.classList.remove('dragging'));

  g = svg.append('g');
  g.append('rect').attr('class','ocean').attr('x',-w*10).attr('y',-h*10).attr('width',w*20).attr('height',h*20);
  g.append('path').datum(d3.geoGraticule()()).attr('class','graticule').attr('d',path);

  loadWorldAtlas()
    .then(world => {
      const countries = topojson.feature(world, world.objects.countries);

      g.selectAll('.country')
        .data(countries.features)
        .join('path')
          .attr('class', 'country')
          .attr('d', path)
          .attr('stroke-width', baseStroke)
          .each(function(d) {
            const id = +d.id;
            const area = path.area(d);
            if (!countryPaths[id] || area > (countryPaths[id].__area || 0)) {
              this.__area = area;
              countryPaths[id] = this;
            }
          })
          .on('click', (event, d) => { handleCountryClick(event, +d.id); });

      // Küçük ülkeler: haritada poligon olarak görünmeyenler nokta olarak gösterilir
      window._smallCountries = {
        674: { name: 'San Marino',     lon: 12.46,  lat: 43.94 },
        438: { name: 'Liechtenstein',  lon: 9.55,   lat: 47.14 },
        428: { name: 'Letonya',        lon: 24.60,  lat: 56.88 },
        470: { name: 'Malta',          lon: 14.37,  lat: 35.90 },
        462: { name: 'Maldivler',      lon: 73.22,  lat: 1.97  },
        192: { name: 'Küba',           lon: -79.0,  lat: 21.5  },
      };
      const SMALL_COUNTRIES = window._smallCountries;

      // Hangi küçük ülkelerin poligonu yok? (bbox alanı çok küçük olanlar)
      const missingSmall = {};
      countries.features.forEach(f => {
        const id = +f.id;
        if (SMALL_COUNTRIES[id]) {
          const bounds = path.bounds(f);
          const w = bounds[1][0] - bounds[0][0];
          const h = bounds[1][1] - bounds[0][1];
          if (w < 2 && h < 2) missingSmall[id] = SMALL_COUNTRIES[id];
        }
        if (!countryPaths[id] || path.area(f) < 1) {
          if (SMALL_COUNTRIES[id]) missingSmall[id] = SMALL_COUNTRIES[id];
        }
      });
      // Hiç feature'ı olmayanları da ekle
      Object.keys(SMALL_COUNTRIES).forEach(id => {
        if (!countryPaths[+id]) missingSmall[+id] = SMALL_COUNTRIES[+id];
      });

      // Nokta olarak çiz
      Object.entries(missingSmall).forEach(([id, info]) => {
        const [x, y] = projection([info.lon, info.lat]);
        const circle = g.append('circle')
          .attr('class', 'country small-country-dot')
          .attr('cx', x).attr('cy', y)
          .attr('r', 2)
          .attr('data-id', id)
          .style('fill', 'var(--land)')
          .style('stroke', 'var(--border)')
          .style('stroke-width', '0.5')
          .style('cursor', 'pointer')
          .on('click', (event) => { handleCountryClick(event, +id); });
        countryPaths[+id] = circle.node();
      });

      updateStats();
      document.getElementById('stat-total').textContent = Object.keys(COUNTRY_NAMES).length;
    })
    .catch(() => {
      // Hata zaten loadWorldAtlas() içinde kullanıcıya banner ile gösterildi.
    });
}

// ══════════════════════════════════════════════
// MODE & REGION
// ══════════════════════════════════════════════
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach(b => {
    const isActive = b.dataset.mode === mode;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const lp = document.getElementById('left-panel');
  const qp = document.getElementById('quiz-panel');
  const ip = document.getElementById('info-panel');
  const panelArea = document.getElementById('panel-area');
  panelArea.classList.remove('panel-area-full');

  if (mode === 'search') {
    stopFlagTimer();
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftb=document.getElementById('flag-timed-bottom'); if(_ftb) _ftb.style.display='none';
    lp.setAttribute('style', 'display:flex');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    panelArea.classList.remove('quiz-mode');
    clearQuizHighlights();
    hideInfoMode();
    hidePhysicalMode();
    hideCityFuncMode();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'flex';
  } else if (mode === 'info') {
    stopFlagTimer();
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftb=document.getElementById('flag-timed-bottom'); if(_ftb) _ftb.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:flex');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    panelArea.classList.remove('quiz-mode');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hidePhysicalMode();
    hideCityFuncMode();
    hideInfoMode();
  } else if (mode === 'physical') {
    stopFlagTimer();
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftb=document.getElementById('flag-timed-bottom'); if(_ftb) _ftb.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:flex');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    panelArea.classList.remove('quiz-mode');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hideInfoMode();
    initPhysicalMode();
  } else if (mode === 'flag') {
    stopFlagTimer();
    document.getElementById('flag-timer-end').style.display = 'none';
    // Başlangıç durumu: süresiz layout
    document.getElementById('flag-timed-block').style.display = 'none';
    document.getElementById('flag-free-block').style.display = 'flex';
    const _ftb=document.getElementById('flag-timed-bottom'); if(_ftb) _ftb.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    document.getElementById('flag-panel').style.display = 'flex';
    panelArea.classList.remove('quiz-mode');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hideInfoMode();
    hidePhysicalMode();
    hideCityFuncMode();
    quizCorrect = 0; quizWrong = 0; quizStreak = 0; quizMaxStreak = 0;
    usedIds.clear();
    waitingNext = false;
    updateQuizStats();
    nextFlagQuestion();
  } else if (mode === 'tabu') {
    stopFlagTimer();
    clearInterval(tabuInterval);
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftb2=document.getElementById('flag-timed-bottom'); if(_ftb2) _ftb2.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'flex';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = 'none';
    panelArea.classList.remove('quiz-mode');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hideInfoMode();
    hidePhysicalMode();
    hideCityFuncMode();
    initTabuMode();
  } else if (mode === 'tabu2') {
    stopFlagTimer();
    clearInterval(tabuInterval);
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftb3=document.getElementById('flag-timed-bottom'); if(_ftb3) _ftb3.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'flex';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = 'none';
    panelArea.classList.remove('quiz-mode');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hideInfoMode();
    hidePhysicalMode();
    hideCityFuncMode();
    initT2Mode();
  } else if (mode === 'cografya') {
    stopFlagTimer();
    clearInterval(tabuInterval);
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftbCg=document.getElementById('flag-timed-bottom'); if(_ftbCg) _ftbCg.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'flex';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = 'none';
    panelArea.classList.remove('quiz-mode');
    panelArea.classList.add('panel-area-full');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hideInfoMode();
    hidePhysicalMode();
    hideCityFuncMode();
    initCografyaMode();
  } else if (mode === 'cityfunc') {
    stopFlagTimer();
    clearInterval(tabuInterval);
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftbCf=document.getElementById('flag-timed-bottom'); if(_ftbCf) _ftbCf.style.display='none';
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:none');
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'flex';
    document.getElementById('map-container').style.display = '';
    panelArea.classList.remove('quiz-mode');
    stopTimer();
    stopQuizTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    clearQuizHighlights();
    hideInfoMode();
    hidePhysicalMode();
    initCityFuncMode();
  } else {
    stopFlagTimer();
    document.getElementById('flag-timer-end').style.display = 'none';
    document.getElementById('flag-panel').style.display = 'none';
    const _ftb=document.getElementById('flag-timed-bottom'); if(_ftb) _ftb.style.display='none';
    ip.setAttribute('style', 'display:none');
    document.getElementById('physical-panel').setAttribute('style', 'display:none');
    document.getElementById('tabu-panel').style.display = 'none';
    document.getElementById('tabu2-panel').style.display = 'none';
    document.getElementById('cografya-panel').style.display = 'none';
    document.getElementById('cityfunc-panel').style.display = 'none';
    document.getElementById('map-container').style.display = '';
    panelArea.classList.add('quiz-mode');
    hideInfoMode();
    hidePhysicalMode();
    hideCityFuncMode();
    // Diğer modlara geçince timer'ı durdur ve kutusunu gizle
    stopTimer();
    document.getElementById('timer-select-box').style.display = 'none';
    document.getElementById('timer-display').classList.remove('active','warning');
    lp.setAttribute('style', 'display:none');
    qp.setAttribute('style', 'display:flex;');
    quizCorrect = 0; quizWrong = 0; quizStreak = 0; quizMaxStreak = 0;
    usedIds.clear();
    waitingNext = false;
    updateQuizStats();
    clearQuizHighlights();
    // Quiz timer sıfırla
    stopQuizTimer();
    quizTimerRunning = false;
    if (quizTimerSeconds > 0) {
      quizTimerRemaining = quizTimerSeconds;
      updateQuizTimerDisplay();
      document.getElementById('quiz-timer-display').style.display = 'flex';
    }
    nextQuestion();
  }
}

// Bölge zoom ayarları: [lon_merkez, lat_merkez, scale_çarpanı]
/* -> moved to data.js / translations.js */


function zoomToRegion(region) {
  const [lon, lat, scaleMult] = REGION_ZOOM[region] || REGION_ZOOM.all;
  const w = window.innerWidth, h = window.innerHeight;
  const baseScale = w / 6.2;
  const [cx, cy] = projection([lon, lat]);
  const k = baseScale / (w / 6.2) * scaleMult * (w / 960);
  // D3 zoomIdentity: translate sonra scale
  const scale = scaleMult;
  svg.transition().duration(600).call(
    zoom.transform,
    d3.zoomIdentity.translate(w/2, h/2).scale(scale).translate(-cx, -cy)
  );
}

function highlightRegionBorder(region) {
  g.select('#region-outline').remove();

  g.selectAll('.country').each(function(d) {
    const el = d3.select(this);
    if (!d || d.id === undefined) return;
    const id = +d.id;
    if (region === 'all') {
      el.classed('out-of-region', false).classed('in-region', false);
    } else {
      const inRegion = (REGIONS[region] || []).includes(id);
      el.classed('in-region', inRegion).classed('out-of-region', !inRegion);
    }
  });
}

function setRegion(region) {
  currentRegion = region;
  document.querySelectorAll('.region-btn').forEach(b => b.classList.toggle('active', b.dataset.region === region));
  usedIds.clear();
  clearQuizHighlights();
  highlightRegionBorder(region);
  zoomToRegion(region);
  if (currentMode !== 'search') nextQuestion();
}

function getRegionIds() {
  if (currentRegion === 'all') return Object.keys(COUNTRY_NAMES).map(Number);
  return (REGIONS[currentRegion] || []).filter(id => COUNTRY_NAMES[id]);
}

// ══════════════════════════════════════════════
// SEARCH MODE
// ══════════════════════════════════════════════
function normalize(s) {
  // Türkçe büyük harfler önce elle dönüştürülmeli (toLowerCase() İ→i yapmaz)
  s = s.replace(/İ/g,'i').replace(/I/g,'i')
       .replace(/Ğ/g,'g').replace(/Ü/g,'u').replace(/Ş/g,'s')
       .replace(/Ö/g,'o').replace(/Ç/g,'c');
  return s.toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
    .replace(/â/g,'a').replace(/î/g,'i').replace(/û/g,'u')
    .replace(/é/g,'e').replace(/è/g,'e').replace(/ê/g,'e').replace(/ë/g,'e')
    .replace(/à/g,'a').replace(/á/g,'a').replace(/ä/g,'a').replace(/ã/g,'a')
    .replace(/ô/g,'o').replace(/ó/g,'o').replace(/õ/g,'o')
    .replace(/ú/g,'u').replace(/ù/g,'u')
    .replace(/í/g,'i').replace(/ì/g,'i')
    .replace(/ñ/g,'n').replace(/ß/g,'ss')
    .replace(/[''´`]/g,"'")
    // Kısaltmalardaki noktaları kaldır: O.A.C. → oac, U.S.A. → usa
    .replace(/\b([a-z])\.([a-z])\.([a-z])\./g,'$1$2$3')
    .replace(/\b([a-z])\.([a-z])\./g,'$1$2')
    .replace(/\b([a-z])\.([a-z])\.([a-z])([a-z])\./g,'$1$2$3$4')
    .replace(/\s+/g,' ').trim();
}

// Metinden "cumhuriyeti", "republic", "demokratik" gibi kelimeleri çıkarıp özü bul
function extractCore(s) {
  return normalize(s)
    .replace(/\b(cumhuriyeti?|republic|demokratik|democratic|federal|islami?|united|arab|emirate[s]?|kingdom|norte|sur|nord|sud|north|south|kuzey|guney|dogu|bati|east|west|del?|de|du|der|des|von|van|of|the|ve|and|und|et|y|e)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

function isMatch(guess, answer) {
  const ng = normalize(guess);
  const na = normalize(answer);

  // 1. Tam eşleşme
  if (ng === na) return true;

  // 2. Alias → ID kontrolü: alias'ın ID'si currentQuestion.id ile eşleşiyor mu?
  const langAliases = COUNTRY_ALIASES[currentLang] || {};
  const aliasId = langAliases[ng] || langAliases[ng.replace(/\s/g,'')] || langAliases[guess.toLowerCase().trim()];
  if (aliasId && currentQuestion) {
    if (String(aliasId) === String(currentQuestion.id)) return true;
  }
  // Alias → isim karşılaştırması (search modunda currentQuestion olmayabilir)
  if (aliasId) {
    const names = getCountryNamesForLang();
    const aliasName = normalize(names[aliasId] || names[String(aliasId)] || COUNTRY_NAMES[aliasId] || COUNTRY_NAMES[String(aliasId)] || '');
    if (aliasName && aliasName === na) return true;
  }

  // 2b. Ters alias
  const allAliases = Object.entries(COUNTRY_ALIASES[currentLang] || {});
  for (const [key, id] of allAliases) {
    if (!id) continue;
    const names = getCountryNamesForLang();
    const aliasName = normalize(names[id] || COUNTRY_NAMES[id] || '');
    if (aliasName === na && normalize(key) === ng) return true;
  }

  // 3. Birinin diğerini içermesi (min 4 karakter)
  if (ng.length >= 4 && na.includes(ng)) return true;
  if (na.length >= 4 && ng.includes(na)) return true;

  // 4. Öz kelime eşleşmesi
  const cg = extractCore(ng);
  const ca = extractCore(na);
  if (cg.length >= 3 && ca.length >= 3 && (cg === ca || ca.includes(cg) || cg.includes(ca))) return true;

  // 5. Kelime bazlı eşleşme
  const wordsA = na.split(' ').filter(w => w.length > 2);
  const wordsG = ng.split(' ').filter(w => w.length > 2);
  if (wordsA.length >= 2 && wordsG.length >= 1) {
    const matched = wordsA.filter(w => wordsG.some(g => g === w || g.includes(w) || w.includes(g)));
    if (matched.length >= Math.ceil(wordsA.length * 0.6)) return true;
  }

  return false;
}

function getMatches(query) {
  if (!query || query.length < 1) return [];
  const q = normalize(query);
  const names = getCountryNamesForLang();
  const langAliases = COUNTRY_ALIASES[currentLang] || {};

  // Alias kontrolü — tam eşleşme
  const aliasId = langAliases[q] || langAliases[q.replace(/\s/g,'')] || langAliases[query.toLowerCase()];
  if (aliasId && COUNTRY_NAMES[aliasId]) {
    return [[String(aliasId), names[aliasId] || COUNTRY_NAMES[aliasId]]];
  }

  // Öz kelime araması da dene
  const cq = extractCore(q);

  return Object.entries(names)
    .filter(([id, name]) => {
      const nn = normalize(name);
      const cn = extractCore(nn);
      return nn.includes(q) || (cq.length >= 3 && cn.includes(cq));
    })
    .sort((a, b) => {
      const na = normalize(a[1]), nb = normalize(b[1]);
      return na.indexOf(q) - nb.indexOf(q);
    })
    .slice(0, 8);
}

function onSearchInput() {
  document.getElementById('autocomplete') && (document.getElementById('autocomplete').style.display = 'none');
}

function onSearchKey(e) {
  if (e.key === 'Enter') doSearch();
}

function isInRegion(id) {
  if (currentRegion === 'all') return true;
  return (REGIONS[currentRegion] || []).includes(+id);
}

function getRegionName(id) {
  const labels = {
    europe: t('region_europe'), asia: t('region_asia'),
    africa: t('region_africa'), americas: t('region_americas'), oceania: t('region_oceania')
  };
  const found = [];
  for (const [region, ids] of Object.entries(REGIONS)) {
    if (ids.includes(+id)) found.push(labels[region] || region);
  }
  return found.length > 0 ? found.join('/') : null;
}

function doSearch() {
  const val = document.getElementById('country-search').value.trim();
  if (!val) return;
  const matches = getMatches(val);
  if (matches.length > 0) {
    const id = parseInt(matches[0][0]);
    const name = matches[0][1];
    document.getElementById('country-search').value = name;

    const warning = document.getElementById('search-result-warning');
    const label = document.getElementById('search-result-label');

    if (!isInRegion(id)) {
      // Kıtada değil — uyar ve göster
      const regionName = getRegionName(id);
      warning.style.display = 'block';
      warning.textContent = regionName
        ? t('not_in_region') + regionName
        : t('not_in_region2');
      label.style.color = 'var(--danger)';
    } else {
      warning.style.display = 'none';
      label.style.color = '';
      const wasNew = !foundCountries.has(id);
      foundCountries.add(id);
      updateStats();
      applyFoundHighlights();
      // Süreli modda veya kronometre modunda: ilk aramada timer'ı başlat
      if (wasNew && (timerSeconds > 0 || timerSeconds === -1) && !timerRunning) startTimer();
      // Arama çubuğunu temizle
      document.getElementById('country-search').value = '';
    }
    highlightAndZoom(id, name);
  }
}

function highlightAndZoom(id, name) {
  if (searchHighlighted) {
    const prevEl = countryPaths[searchHighlighted];
    if (prevEl && !prevEl.classList.contains('found')) prevEl.classList.remove('search-found');
  }
  searchHighlighted = id;
  const el = countryPaths[id];
  if (el) el.classList.add('search-found');
  document.getElementById('search-result').style.display = 'block';
  document.getElementById('search-result-name').textContent = name;
}

function applyFoundHighlights() {
  foundCountries.forEach(fid => {
    const el = countryPaths[fid];
    if (el) { el.classList.remove('search-found'); el.classList.add('found'); }
  });
}

// ══════════════════════════════════════════════
// CLICK HANDLER
// ══════════════════════════════════════════════
function handleCountryClick(event, id) {
  event.stopPropagation();

  // SEARCH MODU
  if (currentMode === 'search') return;

  // EĞİTİCİ MOD
  if (currentMode === 'info') {
    showCountryInfo(id);
    return;
  }

  // FIND MODU: doğru ülkeyi tıkla
  if (currentMode === 'find' || currentMode === 'capital') {
    if (!currentQuestion || waitingNext) return;
    // İlk cevap verilince timer başlat
    if ((quizTimerSeconds > 0 || quizTimerSeconds === -1) && !quizTimerRunning) startQuizTimer();
    if (id === currentQuestion.id) {
      // Doğru!
      const el = countryPaths[id];
      if (el) { el.classList.remove('target-highlight'); el.classList.add('found'); }
      quizCorrect++; quizStreak++; if (quizStreak > quizMaxStreak) quizMaxStreak = quizStreak;
      waitingNext = true;
      showFeedback('correct', t('feedback_correct') + currentQuestion.name);
      updateQuizStats();
      document.getElementById('btn-next').style.display = 'block';
    } else {
      // Yanlış — tıklanan ülke adını bul
      const wrongEl = countryPaths[id];
      if (wrongEl) {
        wrongEl.classList.add('wrong-flash');
        setTimeout(() => wrongEl.classList.remove('wrong-flash'), 700);
      }
      const correctEl = countryPaths[currentQuestion.id];
      if (correctEl) { correctEl.classList.remove('target-highlight'); correctEl.classList.add('found'); }
      quizWrong++; quizStreak = 0;
      waitingNext = true;
      const clickedName = getCountryName(id) || '?';
      const notStr = t('feedback_not') || '≠';
      showFeedback('wrong', `✗ ${clickedName} ${notStr} ${currentQuestion.name}`);
      updateQuizStats();
      document.getElementById('btn-next').style.display = 'block';
    }
    return;
  }

  // FLAG MODU
  if (currentMode === 'flag') {
    if (!currentQuestion || waitingNext) return;
    if ((flagTimerSeconds > 0 || flagTimerSeconds === -1) && !flagTimerRunning) startFlagTimer();
    if (id === currentQuestion.id) {
      const el = countryPaths[id];
      if (el) { el.classList.remove('target-highlight'); el.classList.add('found'); }
      quizCorrect++; quizStreak++; if (quizStreak > quizMaxStreak) quizMaxStreak = quizStreak;
      waitingNext = true;
      showFlagFeedback('correct', '✓ ' + currentQuestion.name);
      updateFlagStats();
      setTimeout(() => { if (currentMode === 'flag') nextFlagQuestion(); }, 900);
    } else {
      const wrongEl = countryPaths[id];
      if (wrongEl) {
        wrongEl.classList.add('wrong-flash');
        setTimeout(() => wrongEl.classList.remove('wrong-flash'), 700);
      }
      const correctEl = countryPaths[currentQuestion.id];
      if (correctEl) { correctEl.classList.remove('target-highlight'); correctEl.classList.add('found'); }
      quizWrong++; quizStreak = 0;
      waitingNext = true;
      showFlagFeedback('wrong', '✗ ' + currentQuestion.name);
      updateFlagStats();
      setTimeout(() => { if (currentMode === 'flag') nextFlagQuestion(); }, 1400);
    }
    return;
  }

  // GUESS MODU: tıklamak hiçbir şey yapmaz
}

// ══════════════════════════════════════════════
// QUIZ — GUESS MODE
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// BAYRAK MODU
// ══════════════════════════════════════════════

function showFlagFeedback(type, msg) {
  playSound(type);
  const color = type === 'correct' ? 'var(--accent)' : 'var(--danger)';
  const fb = document.getElementById('flag-feedback');
  if (fb) { fb.textContent = msg; fb.style.color = color; }
  const fbs = document.getElementById('flag-feedback-small');
  if (fbs) { fbs.textContent = msg; fbs.style.color = color; }
  const fbt = document.getElementById('flag-feedback-timed');
  if (fbt) { fbt.textContent = msg; fbt.style.color = color; }
}

function updateFlagStats() {
  const c = document.getElementById('flag-correct');
  const w = document.getElementById('flag-wrong');
  const s = document.getElementById('flag-streak');
  if (c) c.textContent = quizCorrect;
  if (w) w.textContent = quizWrong;
  if (s) s.textContent = quizStreak;
  // Kronometre hedefine ulaşıldıysa durdur ve sonucu göster
  if (flagTimerSeconds === -1 && flagTimerRunning && chronoTarget > 0 && (quizCorrect + quizWrong) >= chronoTarget) {
    stopFlagTimer();
    endFlagTimedGame();
  }
}

function nextFlagQuestion() {
  waitingNext = false;
  document.getElementById('feedback').style.display = 'none';
  const fb = document.getElementById('flag-feedback');
  if (fb) { fb.textContent = ''; fb.className = ''; }
  if (document.getElementById('flag-timer-end') && document.getElementById('flag-timer-end').style.display === 'flex') return;

  const ids = getRegionIds().filter(id => countryPaths[id] && FLAG_MAP[id]);
  if (ids.length === 0) return;

  if (currentQuestion) {
    const prev = countryPaths[currentQuestion.id];
    if (prev) prev.classList.remove('target-highlight', 'wrong-flash', 'found');
  }

  let pool = ids.filter(id => !usedIds.has(id));
  if (pool.length === 0) { usedIds.clear(); pool = ids; }
  const id = pool[Math.floor(Math.random() * pool.length)];
  usedIds.add(id);

  const name = getCountryName(id);
  currentQuestion = { id, name };

  const flagStr = getFlagImgHtml(id, 84);
  document.getElementById('flag-emoji').innerHTML = flagStr;
  document.getElementById('flag-question-label').textContent = t('flag_find_label');
  const emojiSmall = document.getElementById('flag-emoji-small');
  if (emojiSmall) emojiSmall.innerHTML = flagStr;
  const emojiTimed = document.getElementById('flag-emoji-timed');
  if (emojiTimed) emojiTimed.innerHTML = getFlagImgHtml(id, 84);
  const fbSmall = document.getElementById('flag-feedback-small');
  if (fbSmall) fbSmall.textContent = '';
  const fbTimed = document.getElementById('flag-feedback-timed');
  if (fbTimed) fbTimed.textContent = '';

  // Haritayı sıfırla
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
}

function clearQuizHighlights() {
  Object.values(countryPaths).forEach(el => {
    el.classList.remove('target-highlight', 'wrong-flash', 'found', 'search-found', 'region-border');
  });
  // Restore region border after clear
  highlightRegionBorder(currentRegion);
}

function nextQuestion() {
  waitingNext = false;
  document.getElementById('btn-next').style.display = 'none';
  document.getElementById('feedback').style.display = 'none';

  const ids = getRegionIds().filter(id => countryPaths[id]);
  if (ids.length === 0) return;

  // Önceki soruyu temizle
  if (currentQuestion) {
    const prev = countryPaths[currentQuestion.id];
    if (prev) prev.classList.remove('target-highlight', 'wrong-flash', 'found');
  }

  let pool = ids.filter(id => !usedIds.has(id));
  if (pool.length === 0) { usedIds.clear(); pool = ids; }
  const id = pool[Math.floor(Math.random() * pool.length)];
  usedIds.add(id);

  const name = getCountryName(id);
  currentQuestion = { id, name };

  if (currentMode === 'find' || currentMode === 'capital') {
    document.getElementById('question-mode-label').textContent =
      currentMode === 'capital' ? t('mode_capital') : t('quiz_find_label');

    if (currentMode === 'capital') {
      // Başkent bilgisini al
      const info = COUNTRY_INFO[id];
      const capI18n = info && CAPITAL_I18N[info.cap];
      const capName = info ? ((capI18n && capI18n[currentLang]) ? capI18n[currentLang] : info.cap) : '?';
      // Başkenti göster, ülkenin adını sakla
      document.getElementById('question-text').textContent =
        capName + ' ' + (t('capital_find_q') || t('quiz_find_q') || 'nerede?');
    } else {
      document.getElementById('question-text').textContent = name + ' ' + t('quiz_find_q');
    }
    document.getElementById('answer-wrap').style.display = 'none';
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  } else {
    // guess modu
    document.getElementById('question-mode-label').textContent = t('quiz_guess_label');
    document.getElementById('question-text').textContent = t('quiz_guess_q');
    document.getElementById('answer-wrap').style.display = 'flex';
    document.getElementById('answer-input').value = '';
    document.getElementById('answer-autocomplete').style.display = 'none';

    const el = countryPaths[id];
    if (el) el.classList.add('target-highlight');

    const centroid = path.centroid(el.__data__);
    if (!isNaN(centroid[0])) {
      const w = window.innerWidth, h = window.innerHeight;
      svg.transition().duration(600).call(
        zoom.transform,
        d3.zoomIdentity.translate(w/2, h/2).scale(4).translate(-centroid[0], -centroid[1])
      );
    }
    setTimeout(() => document.getElementById('answer-input').focus(), 400);
  }

  updateQuizProgress(ids.length);
}

function onAnswerInput() {
  document.getElementById('answer-autocomplete').style.display = 'none';
}

function onAnswerKey(e) {
  if (e.key === 'Enter') submitAnswer();
  if (e.key === 'Escape') document.getElementById('answer-autocomplete').style.display = 'none';
}

function selectAnswer(name) {
  document.getElementById('answer-input').value = name;
  document.getElementById('answer-autocomplete').style.display = 'none';
  submitAnswer();
}

function submitAnswer() {
  if (!currentQuestion || waitingNext) return;
  const val = document.getElementById('answer-input').value.trim();
  if (!val) return;
  document.getElementById('answer-autocomplete').style.display = 'none';
  // İlk cevap verilince timer başlat
  if ((quizTimerSeconds > 0 || quizTimerSeconds === -1) && !quizTimerRunning) startQuizTimer();

  const isCorrect = isMatch(val, currentQuestion.name);

  const el = countryPaths[currentQuestion.id];
  if (isCorrect) {
    if (el) { el.classList.remove('target-highlight'); el.classList.add('found'); }
    quizCorrect++; quizStreak++; if (quizStreak > quizMaxStreak) quizMaxStreak = quizStreak;
    waitingNext = true;
    showFeedback('correct', t('feedback_correct') + currentQuestion.name);
    updateQuizStats();
    document.getElementById('btn-next').style.display = 'block';
  } else {
    if (el) {
      el.classList.add('wrong-flash');
      setTimeout(() => { el.classList.remove('wrong-flash'); }, 700);
    }
    quizWrong++; quizStreak = 0;
    waitingNext = true;
    showFeedback('wrong', t('feedback_wrong') + currentQuestion.name);
    updateQuizStats();
    document.getElementById('btn-next').style.display = 'block';
  }
}

function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (type === 'correct') {
      // İki tonlu yükseliş sesi
      [523, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.18);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.18);
      });
    } else {
      // Tek alçak kısa ses
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    }
  } catch(e) {}
}

function showFeedback(type, msg) {
  playSound(type);
  const el = document.getElementById('feedback');
  el.className = type;
  el.textContent = msg;
  el.style.display = 'block';
}

function updateQuizStats() {
  document.getElementById('q-correct').textContent = quizCorrect;
  document.getElementById('q-wrong').textContent = quizWrong;
  document.getElementById('q-streak').textContent = quizStreak;
  // Kronometre hedefine ulaşıldıysa durdur
  if (quizTimerSeconds === -1 && quizTimerRunning && chronoTarget > 0 && (quizCorrect + quizWrong) >= chronoTarget) {
    stopQuizTimer();
    endQuizTimedGame();
  }
}

function updateQuizProgress(total) {
  const done = quizCorrect + quizWrong;
  const pct = Math.round((quizCorrect / Math.max(1, done)) * 100) || 0;
  document.getElementById('progress-bar-inner-quiz').style.width = pct + '%';
  document.getElementById('progress-text-quiz').textContent =
    t('quiz_progress').replace('{n}', done+1).replace('{pct}', pct);
}

// ══════════════════════════════════════════════
// SEARCH STATS
// ══════════════════════════════════════════════
function updateStats() {
  const regionIds = getRegionIds();
  const total = regionIds.length;
  const found = [...foundCountries].filter(id => regionIds.includes(id)).length;
  const pct = Math.round((found / Math.max(1, total)) * 100);
  document.getElementById('stat-found').textContent = found;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pct').textContent = pct + '%';
  document.getElementById('progress-bar-inner').style.width = pct + '%';
  document.getElementById('progress-text').textContent = t('progress_found').replace('{found}', found).replace('{total}', total);
  // Tüm ülkeler bulunduysa süreli modda da tebrikler
  if (timerSeconds > 0 && timerRunning && found === total) {
    stopTimer();
    endTimedGame();
  }
  // Kronometre modunda tüm ülkeler bulununca durdur
  if (timerSeconds === -1 && timerRunning && found === total) {
    stopTimer();
    endTimedGame();
  }
  // Kronometre hedefine ulaşıldıysa durdur
  if (timerSeconds === -1 && timerRunning && chronoTarget > 0 && found >= chronoTarget) {
    stopTimer();
    endTimedGame();
  }
}

// ══════════════════════════════════════════════
// MAP CONTROLS
// ══════════════════════════════════════════════
function resetZoom() { svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity); }

// Resize sırasında (özellikle mobilde ekran döndürme/klavye açılması gibi art arda
// tetiklenen olaylarda) her karede TÜM ülke path'lerini yeniden hesaplamak kasmaya
// yol açabiliyordu. Bunu debounce + requestAnimationFrame ile hafifletiyoruz:
// resize olayları art arda geldiğinde sadece SONUNCUSU işlenir.
let _resizeDebounceTimer = null;
function _performMapResize() {
  const w = window.innerWidth, h = window.innerHeight;
  projection.scale(w/6.2).translate([w/2, h/2 - 120]);
  if (g) {
    // stroke-width artık vector-effect:non-scaling-stroke ile sabit (CSS'ten geliyor),
    // resize'da yeniden ayarlamaya gerek yok — sadece geometriyi (d, cx/cy) güncelle.
    g.selectAll('.country:not(.small-country-dot)').attr('d', path);
    g.selectAll('.graticule').attr('d', path);
    g.selectAll('.small-country-dot').each(function() {
      const el = d3.select(this);
      const id = +el.attr('data-id');
      const info = window._smallCountries && window._smallCountries[id];
      if (info) {
        const [x, y] = projection([info.lon, info.lat]);
        el.attr('cx', x).attr('cy', y);
      }
    });
  }
}
window.addEventListener('resize', () => {
  clearTimeout(_resizeDebounceTimer);
  _resizeDebounceTimer = setTimeout(() => {
    requestAnimationFrame(_performMapResize);
  }, 150);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#answer-wrap') && !e.target.closest('#answer-autocomplete'))
    document.getElementById('answer-autocomplete').style.display = 'none';
});


// ══════════════════════════════════════════════
// TIMER (İSİM → HARİTA MODU)
// ══════════════════════════════════════════════
function setTimerMode(sec) {
  timerSeconds = sec;
  if (sec !== -1) chronoTarget = 0; // sadece kronometre modunda hedef aktif
  document.querySelectorAll('.timer-opt[data-sec]').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.sec) === sec)
  );
  stopTimer();
  timerRunning = false;
  timerChronoElapsed = 0;
  const disp = document.getElementById('timer-display');
  if (sec === 0) {
    disp.classList.remove('active', 'warning');
  } else if (sec === -1) {
    // Kronometre modu: 0'dan saymaya başlar, ilk arama başlatır
    disp.classList.add('active');
    disp.classList.remove('warning');
    document.getElementById('timer-time').textContent = '0:00';
    document.getElementById('timer-bar-inner').style.width = '100%';
    document.getElementById('timer-lbl').textContent = t('timer_chrono') || 'Kronometre';
  } else {
    timerRemaining = sec;
    updateTimerDisplay();
    disp.classList.add('active');
    disp.classList.remove('warning');
    document.getElementById('timer-lbl').textContent = t('timer_remaining') || 'Kalan Süre';
  }
  // Oyunu sıfırla
  foundCountries.clear();
  updateStats();
  applyFoundHighlights();
  clearSearchHighlights();
  document.getElementById('search-result').style.display = 'none';
  document.getElementById('country-search').value = '';
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerRunning = true;
  timerInterval = setInterval(timerTick, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerRunning = false;
}

function timerTick() {
  if (timerSeconds === -1) {
    // Kronometre modu: yukarı say
    timerChronoElapsed++;
    updateChronoDisplay();
  } else {
    timerRemaining--;
    updateTimerDisplay();
    if (timerRemaining <= 0) {
      stopTimer();
      endTimedGame();
    }
  }
}

function updateChronoDisplay() {
  const mins = Math.floor(timerChronoElapsed / 60);
  const secs = timerChronoElapsed % 60;
  document.getElementById('timer-time').textContent =
    mins + ':' + String(secs).padStart(2, '0');
  // bar her zaman dolu göster
  document.getElementById('timer-bar-inner').style.width = '100%';
  document.getElementById('timer-display').classList.remove('warning');
}

function updateTimerDisplay() {
  const mins = Math.floor(timerRemaining / 60);
  const secs = timerRemaining % 60;
  document.getElementById('timer-time').textContent =
    mins + ':' + String(secs).padStart(2, '0');
  const pct = (timerRemaining / timerSeconds) * 100;
  document.getElementById('timer-bar-inner').style.width = pct + '%';
  const disp = document.getElementById('timer-display');
  if (timerRemaining <= Math.min(10, timerSeconds * 0.1)) {
    disp.classList.add('warning');
  } else {
    disp.classList.remove('warning');
  }
}

function endTimedGame() {
  const regionIds = getRegionIds();
  const total = regionIds.length;
  const found = [...foundCountries].filter(id => regionIds.includes(id)).length;
  const pct = Math.round((found / total) * 100);
  const allFound = found === total;
  const hitTarget = chronoTarget > 0 && found >= chronoTarget;
  const titleEl = document.querySelector('#search-timer-end h2');
  if (titleEl) titleEl.textContent = (allFound || hitTarget) ? t('timer_end_congrats') : t('timer_end_title');
  document.getElementById('end-found').textContent = found;
  document.getElementById('end-total').textContent = total;
  document.getElementById('end-pct').textContent = pct + '%';
  // Kronometre modunda geçen süreyi de göster
  if (timerSeconds === -1) {
    const mins = Math.floor(timerChronoElapsed / 60);
    const secs = timerChronoElapsed % 60;
    const timeStr = mins + ':' + String(secs).padStart(2, '0');
    document.getElementById('end-pct').textContent = pct + '%  (' + timeStr + ')';
  }
  document.getElementById('search-timer-end').style.display = 'flex';
  const lbBtn = document.getElementById('btn-lb-search');
  if (lbBtn) lbBtn.style.display = (timerSeconds === -1) ? 'none' : 'block';
}

function closeSearchTimedEnd() {
  document.getElementById('search-timer-end').style.display = 'none';
}

function restartTimedGame() {
  document.getElementById('search-timer-end').style.display = 'none';
  foundCountries.clear();
  updateStats();
  applyFoundHighlights();
  clearSearchHighlights();
  document.getElementById('search-result').style.display = 'none';
  document.getElementById('country-search').value = '';
  if (timerSeconds === -1) {
    // Kronometre: sıfırla
    timerChronoElapsed = 0;
    document.getElementById('timer-time').textContent = '0:00';
    document.getElementById('timer-bar-inner').style.width = '100%';
    document.getElementById('timer-lbl').textContent = t('timer_chrono') || 'Kronometre';
  } else {
    timerRemaining = timerSeconds;
    updateTimerDisplay();
    document.getElementById('timer-display').classList.remove('warning');
  }
  timerRunning = false;
}

function clearSearchHighlights() {
  Object.values(countryPaths).forEach(el => {
    el.classList.remove('found', 'search-found');
  });
}

// ══════════════════════════════════════════════
// QUIZ TIMER (HAR. BUL / ÜLKE TAHMİN MODU)
// ══════════════════════════════════════════════
function setQuizTimerMode(sec) {
  quizTimerSeconds = sec;
  if (sec !== -1) chronoTarget = 0;
  document.querySelectorAll('.timer-opt[data-qsec]').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.qsec) === sec)
  );
  stopQuizTimer();
  quizChronoElapsed = 0;
  const disp = document.getElementById('quiz-timer-display');
  if (sec === 0) {
    disp.style.display = 'none';
  } else if (sec === -1) {
    // Kronometre modu: yukarı say, mavi renk
    disp.style.display = 'flex';
    document.getElementById('quiz-timer-time').textContent = '0:00';
    document.getElementById('quiz-timer-time').style.color = 'var(--accent2)';
    document.getElementById('quiz-timer-time').style.animation = '';
    document.getElementById('quiz-timer-bar').style.width = '100%';
    document.getElementById('quiz-timer-bar').style.background = 'var(--accent2)';
    if (document.getElementById('quiz-timer-lbl'))
      document.getElementById('quiz-timer-lbl').textContent = 'Kronometre';
  } else {
    quizTimerRemaining = sec;
    updateQuizTimerDisplay();
    disp.style.display = 'flex';
    document.getElementById('quiz-timer-bar').style.background = 'var(--accent3)';
    if (document.getElementById('quiz-timer-lbl'))
      document.getElementById('quiz-timer-lbl').textContent = 'Kalan Süre';
  }
  // Quiz'i sıfırla ve yeni soruya geç
  quizCorrect = 0; quizWrong = 0; quizStreak = 0; quizMaxStreak = 0;
  usedIds.clear();
  waitingNext = false;
  updateQuizStats();
  clearQuizHighlights();
  if (currentMode === 'find' || currentMode === 'guess') {
    document.getElementById('btn-next').style.display = 'none';
    document.getElementById('feedback').style.display = 'none';
    nextQuestion();
  }
}

function startQuizTimer() {
  if (quizTimerInterval) clearInterval(quizTimerInterval);
  quizTimerRunning = true;
  quizTimerInterval = setInterval(quizTimerTick, 1000);
}

function stopQuizTimer() {
  if (quizTimerInterval) { clearInterval(quizTimerInterval); quizTimerInterval = null; }
  quizTimerRunning = false;
}

let quizChronoElapsed = 0;

function quizTimerTick() {
  if (quizTimerSeconds === -1) {
    // Kronometre: yukarı say
    quizChronoElapsed++;
    const mins = Math.floor(quizChronoElapsed / 60);
    const secs = quizChronoElapsed % 60;
    document.getElementById('quiz-timer-time').textContent =
      mins + ':' + String(secs).padStart(2, '0');
    document.getElementById('quiz-timer-bar').style.width = '100%';
  } else {
    quizTimerRemaining--;
    updateQuizTimerDisplay();
    if (quizTimerRemaining <= 0) {
      stopQuizTimer();
      endQuizTimedGame();
    }
  }
}

function updateQuizTimerDisplay() {
  const mins = Math.floor(quizTimerRemaining / 60);
  const secs = quizTimerRemaining % 60;
  document.getElementById('quiz-timer-time').textContent =
    mins + ':' + String(secs).padStart(2, '0');
  const pct = (quizTimerRemaining / quizTimerSeconds) * 100;
  const bar = document.getElementById('quiz-timer-bar');
  bar.style.width = pct + '%';
  if (quizTimerRemaining <= Math.min(10, quizTimerSeconds * 0.1)) {
    bar.style.background = 'var(--danger)';
    document.getElementById('quiz-timer-time').style.color = 'var(--danger)';
    document.getElementById('quiz-timer-time').style.animation = 'timerPulse 0.5s ease-in-out infinite';
  } else {
    bar.style.background = 'var(--accent3)';
    document.getElementById('quiz-timer-time').style.color = 'var(--accent3)';
    document.getElementById('quiz-timer-time').style.animation = '';
  }
}


// ══════════════════════════════════════════════
// BAYRAK TIMER
// ══════════════════════════════════════════════
let flagTimerSeconds = 600;
let flagTimerRemaining = 0;
let flagTimerInterval = null;
let flagTimerRunning = false;
let flagChronoElapsed = 0; // kronometre modu için

function setFlagTimerMode(sec) {
  flagTimerSeconds = sec;
  if (sec !== -1) chronoTarget = 0;
  document.querySelectorAll('.timer-opt[data-fsec]').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.fsec) === sec)
  );
  stopFlagTimer();
  flagChronoElapsed = 0;

  const timedBlock  = document.getElementById('flag-timed-block');
  const freeBlock   = document.getElementById('flag-free-block');
  const timedBottom = document.getElementById('flag-timed-bottom');

  if (sec === 0) {
    // SÜRESİZ: büyük bayrak ortada, alt çubuk gizli
    timedBlock.style.display  = 'none';
    freeBlock.style.display   = 'flex';
    if(timedBottom) timedBottom.style.display = 'none';
  } else if (sec === -1) {
    // KRONOMETREse: timer göster, yukarı say
    timedBlock.style.display  = 'flex';
    freeBlock.style.display   = 'none';
    if (window.innerWidth > 600) {
      if(timedBottom) timedBottom.style.display = 'flex';
    } else {
      if(timedBottom) timedBottom.style.display = 'none';
    }
    document.getElementById('flag-timer-time').textContent = '0:00';
    document.getElementById('flag-timer-bar').style.width = '100%';
    document.getElementById('flag-timer-bar').style.background = 'var(--accent2)';
    document.getElementById('flag-timer-time').style.color = 'var(--accent2)';
  } else {
    // SÜRELİ: üstte timer+stats, altta küçük bayrak çubuğu (sadece masaüstü)
    timedBlock.style.display  = 'flex';
    freeBlock.style.display   = 'none';
    if (window.innerWidth > 600) {
      if(timedBottom) timedBottom.style.display = 'flex';
    } else {
      if(timedBottom) timedBottom.style.display = 'none';
    }
    flagTimerRemaining = sec;
    updateFlagTimerDisplay();
    document.getElementById('flag-timer-bar').style.background = 'var(--accent3)';
    document.getElementById('flag-timer-time').style.color = 'var(--accent3)';
  }

  // Sıfırla
  quizCorrect = 0; quizWrong = 0; quizStreak = 0; quizMaxStreak = 0;
  usedIds.clear(); waitingNext = false;
  updateFlagStats();
  clearQuizHighlights();
  document.getElementById('flag-feedback').textContent = '';
  const fbs = document.getElementById('flag-feedback-small');
  if (fbs) fbs.textContent = '';
  nextFlagQuestion();
}

function startFlagTimer() {
  if (flagTimerInterval) clearInterval(flagTimerInterval);
  flagTimerRunning = true;
  flagTimerInterval = setInterval(flagTimerTick, 1000);
}

function stopFlagTimer() {
  if (flagTimerInterval) { clearInterval(flagTimerInterval); flagTimerInterval = null; }
  flagTimerRunning = false;
}

function flagTimerTick() {
  if (flagTimerSeconds === -1) {
    // Kronometre: yukarı say
    flagChronoElapsed++;
    const mins = Math.floor(flagChronoElapsed / 60);
    const secs = flagChronoElapsed % 60;
    const timeEl = document.getElementById('flag-timer-time');
    if (timeEl) timeEl.textContent = mins + ':' + String(secs).padStart(2, '0');
    const bar = document.getElementById('flag-timer-bar');
    if (bar) bar.style.width = '100%';
  } else {
    flagTimerRemaining--;
    updateFlagTimerDisplay();
    if (flagTimerRemaining <= 0) {
      stopFlagTimer();
      endFlagTimedGame();
    }
  }
}

function updateFlagTimerDisplay() {
  const mins = Math.floor(flagTimerRemaining / 60);
  const secs = flagTimerRemaining % 60;
  const timeEl = document.getElementById('flag-timer-time');
  const bar = document.getElementById('flag-timer-bar');
  if (!timeEl) return;
  timeEl.textContent = mins + ':' + String(secs).padStart(2, '0');
  const pct = (flagTimerRemaining / flagTimerSeconds) * 100;
  bar.style.width = pct + '%';
  if (flagTimerRemaining <= Math.min(10, flagTimerSeconds * 0.1)) {
    bar.style.background = 'var(--danger)';
    timeEl.style.color = 'var(--danger)';
  } else {
    bar.style.background = 'var(--accent3)';
    timeEl.style.color = 'var(--accent3)';
  }
}

function endFlagTimedGame() {
  const total = quizCorrect + quizWrong;
  const pct = Math.round((quizCorrect / Math.max(1, total)) * 100);
  let titleText = (quizWrong === 0 && total > 0) ? (t('timer_end_congrats') || 'TEBRİKLER! 🎉') : (t('flag_timer_end_title') || 'SÜRE DOLDU!');
  // Kronometre modunda her zaman tebrik göster (oyuncu isteyince durdurur)
  if (flagTimerSeconds === -1) titleText = t('timer_end_congrats') || 'TEBRİKLER! 🎉';
  document.getElementById('flag-end-title').textContent = titleText;
  document.getElementById('fend-correct').textContent = quizCorrect;
  document.getElementById('fend-wrong').textContent = quizWrong;
  document.getElementById('fend-streak').textContent = quizMaxStreak;
  if (flagTimerSeconds === -1) {
    const mins = Math.floor(flagChronoElapsed / 60);
    const secs = flagChronoElapsed % 60;
    document.getElementById('fend-pct').textContent = pct + '%  (' + mins + ':' + String(secs).padStart(2,'0') + ')';
  } else {
    document.getElementById('fend-pct').textContent = pct + '%';
  }
  document.getElementById('flag-timer-end').style.display = 'flex';
  const lbBtnF = document.getElementById('btn-lb-flag');
  if (lbBtnF) lbBtnF.style.display = (flagTimerSeconds === -1) ? 'none' : 'block';
}

function closeFlagTimedEnd() {
  document.getElementById('flag-timer-end').style.display = 'none';
}

function restartFlagTimedGame() {
  document.getElementById('flag-timer-end').style.display = 'none';
  quizCorrect = 0; quizWrong = 0; quizStreak = 0; quizMaxStreak = 0;
  usedIds.clear(); waitingNext = false;
  updateFlagStats();
  clearQuizHighlights();
  document.getElementById('flag-feedback').textContent = '';
  const fbs = document.getElementById('flag-feedback-small');
  if (fbs) fbs.textContent = '';
  flagChronoElapsed = 0;
  if (flagTimerSeconds === -1) {
    document.getElementById('flag-timer-time').textContent = '0:00';
    document.getElementById('flag-timer-bar').style.width = '100%';
  } else {
    flagTimerRemaining = flagTimerSeconds;
    updateFlagTimerDisplay();
  }
  document.getElementById('flag-timer-bar').style.background = flagTimerSeconds === -1 ? 'var(--accent2)' : 'var(--accent3)';
  document.getElementById('flag-timer-time').style.color = flagTimerSeconds === -1 ? 'var(--accent2)' : 'var(--accent3)';
  flagTimerRunning = false;
  nextFlagQuestion();
}

function endQuizTimedGame() {
  const total = quizCorrect + quizWrong;
  const pct = Math.round((quizCorrect / Math.max(1, total)) * 100);
  const allCorrect = total > 0 && quizWrong === 0;
  const hitTarget = quizTimerSeconds === -1 && chronoTarget > 0 && (quizCorrect + quizWrong) >= chronoTarget;
  document.getElementById('quiz-end-title').textContent =
    (allCorrect || hitTarget) ? (t('timer_end_congrats') || 'TEBRİKLER! 🎉') : (t('timer_end_title') || 'SÜRE DOLDU!');
  document.getElementById('qend-correct').textContent = quizCorrect;
  document.getElementById('qend-wrong').textContent = quizWrong;
  document.getElementById('qend-streak').textContent = quizMaxStreak;
  if (quizTimerSeconds === -1) {
    const mins = Math.floor(quizChronoElapsed / 60);
    const secs = quizChronoElapsed % 60;
    document.getElementById('qend-pct').textContent = pct + '%  (' + mins + ':' + String(secs).padStart(2,'0') + ')';
  } else {
    document.getElementById('qend-pct').textContent = pct + '%';
  }
  document.getElementById('quiz-timer-end').style.display = 'flex';
  const lbBtnQ = document.getElementById('btn-lb-quiz');
  if (lbBtnQ) lbBtnQ.style.display = (quizTimerSeconds === -1) ? 'none' : 'block';
}

function closeQuizTimedEnd() {
  document.getElementById('quiz-timer-end').style.display = 'none';
}

function restartQuizTimedGame() {
  document.getElementById('quiz-timer-end').style.display = 'none';
  quizCorrect = 0; quizWrong = 0; quizStreak = 0; quizMaxStreak = 0;
  usedIds.clear();
  waitingNext = false;
  updateQuizStats();
  clearQuizHighlights();
  document.getElementById('btn-next').style.display = 'none';
  document.getElementById('feedback').style.display = 'none';
  quizChronoElapsed = 0;
  if (quizTimerSeconds === -1) {
    document.getElementById('quiz-timer-time').textContent = '0:00';
    document.getElementById('quiz-timer-time').style.color = 'var(--accent2)';
    document.getElementById('quiz-timer-time').style.animation = '';
    document.getElementById('quiz-timer-bar').style.width = '100%';
    document.getElementById('quiz-timer-bar').style.background = 'var(--accent2)';
  } else {
    quizTimerRemaining = quizTimerSeconds;
    updateQuizTimerDisplay();
  }
  quizTimerRunning = false;
  nextQuestion();
}



// ══════════════════════════════════════════════
// FİZİKİ HARİTA MODU
// ══════════════════════════════════════════════
let physicalInitialized = false;
let physOverlay = null;
let physSvgLayer = null; // nehirler için SVG katmanı

function initPhysicalMode() {
  // Harita konteynerine overlay ekle (bir kez)
  if (!physOverlay) {
    const mc = document.getElementById('map-container');
    physOverlay = document.createElement('div');
    physOverlay.id = 'physical-overlay';
    mc.appendChild(physOverlay);
  }
  renderPhysicalFeatures();
}

function hidePhysicalMode() {
  if (physOverlay) physOverlay.innerHTML = '';
  // Nehir çizgilerini her durumda temizle
  if (typeof g !== 'undefined' && g) {
    g.selectAll('.phys-river').remove();
    g.selectAll('.phys-river-hit').remove();
  }
  if (physSvgLayer) { physSvgLayer.selectAll('*').remove(); }
  const po = document.getElementById('physical-overlay');
  if (po) po.innerHTML = '';
  document.getElementById('physical-hint').style.display = 'block';
  document.getElementById('physical-feature-name').textContent = '';
  document.getElementById('physical-feature-type').textContent = '';
  document.getElementById('physical-feature-desc').textContent = '';
  document.getElementById('physical-stats').innerHTML = '';
}

function renderPhysicalFeatures() {
  if (!physOverlay) return;
  physOverlay.innerHTML = '';

  // SVG nehir katmanını temizle ve yeniden oluştur
  g.selectAll('.phys-river').remove();

  const mc = document.getElementById('map-container');
  const rect = mc.getBoundingClientRect();
  const transform = d3.zoomTransform(svg.node());

  // ─── NEHIRLER (SVG üzerine) ───
  RIVERS.forEach((river, idx) => {
    const pts = river.coords.map(([lon, lat]) => {
      const [px, py] = projection([lon, lat]);
      const sx = transform.x + px * transform.k;
      const sy = transform.y + py * transform.k;
      return [sx, sy];
    });
    const lineStr = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

    // Tıklama için geniş, görsel için ince çizgi
    g.append('path')
      .attr('class', 'phys-river')
      .attr('d', () => {
        const gpts = river.coords.map(([lon, lat]) => projection([lon, lat]));
        return 'M' + gpts.map(p => p.join(',')).join('L');
      })
      .attr('fill', 'none')
      .attr('stroke', '#4fc3f7')
      .attr('stroke-width', 2.5 / transform.k)
      .attr('stroke-opacity', 0.9)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .style('cursor', 'pointer')
      .style('pointer-events', 'stroke')
      .on('click', (event) => {
        event.stopPropagation();
        showPhysicalInfo('river', river);
      });

    // Geniş invisible hit alanı
    g.append('path')
      .attr('class', 'phys-river')
      .attr('d', () => {
        const gpts = river.coords.map(([lon, lat]) => projection([lon, lat]));
        return 'M' + gpts.map(p => p.join(',')).join('L');
      })
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 16 / transform.k)
      .style('cursor', 'pointer')
      .style('pointer-events', 'stroke')
      .on('click', (event) => {
        event.stopPropagation();
        showPhysicalInfo('river', river);
      });
  });

  // ─── DAĞLAR (HTML overlay nokta) ───
  MOUNTAINS.forEach((mountain) => {
    const [px, py] = projection([mountain.lon, mountain.lat]);
    const sx = transform.x + px * transform.k;
    const sy = transform.y + py * transform.k;

    if (sx < -20 || sx > rect.width + 20 || sy < -20 || sy > rect.height + 20) return;

    const el = document.createElement('div');
    el.className = 'phys-mountain-dot';
    el.style.left = sx + 'px';
    el.style.top  = sy + 'px';
    el.innerHTML = '<svg width="18" height="18" viewBox="0 0 14 14" style="overflow:visible"><polygon points="7,1 13,13 1,13" fill="#ff8c42" stroke="#ffcc00" stroke-width="1.2" opacity="0.9"/></svg>';
    el.title = mountain.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhysicalInfo('mountain', mountain);
    });
    physOverlay.appendChild(el);
  });

  // ─── GÖLLER (HTML overlay nokta) ───
  LAKES.forEach((lake) => {
    const [px, py] = projection([lake.lon, lake.lat]);
    const sx = transform.x + px * transform.k;
    const sy = transform.y + py * transform.k;

    if (sx < -20 || sx > rect.width + 20 || sy < -20 || sy > rect.height + 20) return;

    const size = Math.max(14, Math.min(28, Math.sqrt(lake.area) / 60));
    const el = document.createElement('div');
    el.className = 'phys-lake-dot';
    el.style.left = sx + 'px';
    el.style.top  = sy + 'px';
    el.innerHTML = `<div style="width:${size}px;height:${size}px;background:#1a6fa8;border:2.5px solid #4fc3f7;border-radius:4px;opacity:0.9;cursor:pointer;"></div>`;
    el.title = lake.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhysicalInfo('lake', lake);
    });
    physOverlay.appendChild(el);
  });

  // ─── ÇÖLLER (HTML overlay elmas işareti) ───
  DESERTS.forEach((desert) => {
    const [px, py] = projection([desert.lon, desert.lat]);
    const sx = transform.x + px * transform.k;
    const sy = transform.y + py * transform.k;

    if (sx < -40 || sx > rect.width + 40 || sy < -40 || sy > rect.height + 40) return;

    const size = Math.max(14, Math.min(26, Math.sqrt(desert.area) / 100));
    const el = document.createElement('div');
    el.className = 'phys-lake-dot';
    el.style.left = sx + 'px';
    el.style.top  = sy + 'px';
    el.style.zIndex = '147';
    el.innerHTML = `<div style="width:${size}px;height:${size}px;background:rgba(122,74,0,0.75);border:2px solid #d4820a;transform:rotate(45deg);cursor:pointer;" title="${desert.name}"></div>`;
    el.title = desert.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhysicalInfo('desert', desert);
    });
    physOverlay.appendChild(el);
  });
  SEAS.forEach((sea) => {
    const [px, py] = projection([sea.lon, sea.lat]);
    const sx = transform.x + px * transform.k;
    const sy = transform.y + py * transform.k;

    if (sx < -40 || sx > rect.width + 40 || sy < -40 || sy > rect.height + 40) return;

    const isOcean = sea.type === 'Okyanus';
    const baseSize = isOcean ? 28 : 18;
    const size = Math.max(baseSize, Math.min(isOcean ? 40 : 26, Math.sqrt(sea.area) / 350));
    const borderColor = isOcean ? '#00b4d8' : '#0077b6';
    const bgColor = isOcean ? 'rgba(0,60,100,0.75)' : 'rgba(0,40,80,0.7)';

    const el = document.createElement('div');
    el.className = 'phys-lake-dot';
    el.style.left = sx + 'px';
    el.style.top  = sy + 'px';
    el.style.zIndex = '148';
    el.innerHTML = `<div style="width:${size}px;height:${size}px;background:${bgColor};border:2px solid ${borderColor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${Math.max(7, size*0.38)}px;color:${borderColor};font-weight:700;cursor:pointer;" title="${sea.name}">${isOcean ? '◎' : '○'}</div>`;
    el.title = sea.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhysicalInfo('sea', sea);
    });
    physOverlay.appendChild(el);
  });
}

function showPhysicalInfo(type, feature) {
  document.getElementById('physical-hint').style.display = 'none';

  const nameEl = document.getElementById('physical-feature-name');
  const typeEl = document.getElementById('physical-feature-type');
  const descEl = document.getElementById('physical-feature-desc');
  const statsEl = document.getElementById('physical-stats');

  const nameI18n = PHYSICAL_NAMES_I18N[feature.name];
  nameEl.textContent = (nameI18n && nameI18n[currentLang]) ? nameI18n[currentLang] : feature.name;
  const physI18n = PHYSICAL_I18N[feature.name];
  const translatedDesc = (physI18n && physI18n[currentLang]) ? physI18n[currentLang] : feature.desc;
  descEl.textContent = translatedDesc;

  statsEl.innerHTML = '';

  if (type === 'mountain') {
    typeEl.textContent = t('physical_mountain');
    nameEl.style.color = '#ffcc00';
    addPhysRow(statsEl, t('physical_height'), feature.h.toLocaleString('tr-TR') + ' m');
    const cntryI18n = MOUNTAIN_COUNTRY_I18N[feature.country];
    const translatedCountry = (cntryI18n && cntryI18n[currentLang]) ? cntryI18n[currentLang] : feature.country;
    addPhysRow(statsEl, t('physical_location'), translatedCountry);
  } else if (type === 'river') {
    typeEl.textContent = t('physical_river');
    nameEl.style.color = '#4fc3f7';
    addPhysRow(statsEl, t('physical_length'), feature.length.toLocaleString('tr-TR') + ' km');
    const contI18n = CONTINENT_I18N[feature.continent];
    const translatedCont = (contI18n && contI18n[currentLang]) ? contI18n[currentLang] : feature.continent;
    addPhysRow(statsEl, t('physical_continent'), translatedCont);
  } else if (type === 'lake') {
    typeEl.textContent = t('physical_lake');
    nameEl.style.color = '#4fc3f7';
    addPhysRow(statsEl, t('physical_area_label'), feature.area.toLocaleString('tr-TR') + ' km²');
    const contI18n = CONTINENT_I18N[feature.continent];
    const translatedCont = (contI18n && contI18n[currentLang]) ? contI18n[currentLang] : feature.continent;
    addPhysRow(statsEl, t('physical_continent'), translatedCont);
  } else if (type === 'sea') {
    const icon = feature.type === 'Okyanus' || feature.type === 'Ocean' ? '◎' : '○';
    typeEl.textContent = icon + t('physical_sea');
    nameEl.style.color = '#00b4d8';
    addPhysRow(statsEl, t('physical_area_label'), feature.area.toLocaleString('tr-TR') + ' km²');
    const seaTypeI18n = PHYSICAL_TYPE_I18N[feature.type];
    addPhysRow(statsEl, t('physical_type'), (seaTypeI18n && seaTypeI18n[currentLang]) ? seaTypeI18n[currentLang] : feature.type);
  } else if (type === 'desert') {
    const desTypeI18n = PHYSICAL_TYPE_I18N[feature.type];
    const translatedDesType = (desTypeI18n && desTypeI18n[currentLang]) ? desTypeI18n[currentLang] : feature.type;
    typeEl.textContent = t('physical_desert') + translatedDesType;
    nameEl.style.color = '#d4820a';
    addPhysRow(statsEl, t('physical_area_label'), feature.area.toLocaleString('tr-TR') + ' km²');
    addPhysRow(statsEl, t('physical_type'), translatedDesType);
  }
}

function addPhysRow(container, label, value) {
  const row = document.createElement('div');
  row.className = 'physical-stat-row';
  row.innerHTML = `<span class="physical-stat-lbl">${label}</span><span class="physical-stat-val">${value}</span>`;
  container.appendChild(row);
}

function updatePhysicalOverlay() {
  if (currentMode === 'physical') renderPhysicalFeatures();
}

// ══════════════════════════════════════════════
// ŞEHİR FONKSİYONLARI MODU
// ══════════════════════════════════════════════
let cfInitialized = false;
let cfOverlay = null;
let cfCurrentView = 'map';
let cfActiveCityId = null;

function cfName(city)    { return currentLang === 'tr' ? city.nameTR    : (city.nameEN    || city.nameTR); }
function cfCountry(city) { return currentLang === 'tr' ? city.countryTR : (city.countryEN || city.countryTR); }
function cfDesc(city)    { return currentLang === 'tr' ? city.descTR    : (city.descEN    || city.descTR); }
function cfFuncLabel(key) {
  const meta = CITY_FUNC_TYPES[key];
  return meta ? t(meta.key) : key;
}

function initCityFuncMode() {
  if (!cfOverlay) {
    const mc = document.getElementById('map-container');
    cfOverlay = document.createElement('div');
    cfOverlay.id = 'cityfunc-overlay';
    mc.appendChild(cfOverlay);
  }
  if (!cfInitialized) {
    buildCityFuncLegend();
    buildCityFuncTable();
    cfInitialized = true;
  }
  cfSetView(cfCurrentView);
}

function hideCityFuncMode() {
  if (cfOverlay) cfOverlay.innerHTML = '';
  const tt = document.getElementById('cf-tooltip');
  if (tt) tt.style.display = 'none';
}

function cfSetView(view) {
  cfCurrentView = view;
  document.getElementById('cf-view-btn-map').classList.toggle('active', view === 'map');
  document.getElementById('cf-view-btn-table').classList.toggle('active', view === 'table');
  const panel = document.getElementById('cityfunc-panel');
  const mapView = document.getElementById('cityfunc-map-view');
  const tableView = document.getElementById('cityfunc-table-view');
  const mc = document.getElementById('map-container');
  const panelArea = document.getElementById('panel-area');

  if (view === 'map') {
    panel.classList.add('cf-map-active');
    panelArea.classList.remove('panel-area-full');
    mapView.style.display = 'flex';
    tableView.style.display = 'none';
    mc.style.display = '';
    renderCityFuncMarkers();
  } else {
    panel.classList.remove('cf-map-active');
    panelArea.classList.add('panel-area-full');
    mapView.style.display = 'none';
    tableView.style.display = 'flex';
    mc.style.display = 'none';
    if (cfOverlay) cfOverlay.innerHTML = '';
    const tt = document.getElementById('cf-tooltip');
    if (tt) tt.style.display = 'none';
  }
}

function buildCityFuncLegend() {
  const legend = document.getElementById('cityfunc-legend');
  legend.querySelectorAll('.legend-item').forEach(el => el.remove());
  Object.keys(CITY_FUNC_TYPES).forEach(key => {
    const meta = CITY_FUNC_TYPES[key];
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-dot" style="background:${meta.color};"></div><span>${meta.icon} ${cfFuncLabel(key)}</span>`;
    legend.appendChild(item);
  });
}

function renderCityFuncMarkers() {
  if (!cfOverlay) return;
  cfOverlay.innerHTML = '';
  const mc = document.getElementById('map-container');
  const rect = mc.getBoundingClientRect();
  const transform = d3.zoomTransform(svg.node());

  CITY_FUNCTIONS.forEach(city => {
    const [px, py] = projection([city.lon, city.lat]);
    const sx = transform.x + px * transform.k;
    const sy = transform.y + py * transform.k;
    if (sx < -20 || sx > rect.width + 20 || sy < -20 || sy > rect.height + 20) return;

    const mainColor = CITY_FUNC_TYPES[city.functions[0]] ? CITY_FUNC_TYPES[city.functions[0]].color : '#ffcc00';
    const el = document.createElement('div');
    el.className = 'cf-city-dot' + (cfActiveCityId === city.id ? ' active' : '');
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.innerHTML = `<div class="cf-city-dot-inner" style="background:${mainColor};"></div>`;

    el.addEventListener('mouseenter', (e) => cfShowTooltip(e, city));
    el.addEventListener('mousemove', (e) => cfMoveTooltip(e));
    el.addEventListener('mouseleave', () => cfHideTooltip());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      cfActiveCityId = city.id;
      showCityFuncCard(city);
      renderCityFuncMarkers();
    });
    cfOverlay.appendChild(el);
  });
}

function updateCityFuncOverlay() {
  if (currentMode === 'cityfunc' && cfCurrentView === 'map') renderCityFuncMarkers();
}

function cfShowTooltip(e, city) {
  const tt = document.getElementById('cf-tooltip');
  const funcLabels = city.functions.map(f => cfFuncLabel(f)).join(' / ');
  tt.innerHTML = `<div class="cf-tt-title">${cfName(city)}</div><div>${cfCountry(city)} — ${funcLabels}</div>`;
  tt.style.display = 'block';
  cfMoveTooltip(e);
}
function cfMoveTooltip(e) {
  const tt = document.getElementById('cf-tooltip');
  if (tt.style.display !== 'block') return;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + 230 > window.innerWidth) x = e.clientX - 234;
  if (y + 70 > window.innerHeight) y = e.clientY - 74;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}
function cfHideTooltip() {
  document.getElementById('cf-tooltip').style.display = 'none';
}

function showCityFuncCard(city) {
  document.getElementById('cityfunc-hint').style.display = 'none';
  document.getElementById('cityfunc-card-name').textContent = cfName(city);
  document.getElementById('cityfunc-card-country').textContent = cfCountry(city);
  document.getElementById('cityfunc-card-desc').textContent = cfDesc(city);
  const funcsEl = document.getElementById('cityfunc-card-funcs');
  funcsEl.innerHTML = '';
  city.functions.forEach(fk => {
    const meta = CITY_FUNC_TYPES[fk];
    const badge = document.createElement('span');
    badge.className = 'cf-func-badge';
    badge.style.background = 'rgba(4,8,12,0.88)';
    badge.style.border = '1px solid ' + (meta ? meta.color : '#ffcc00');
    badge.style.color = meta ? meta.color : '#ffcc00';
    badge.textContent = (meta ? meta.icon + ' ' : '') + cfFuncLabel(fk);
    funcsEl.appendChild(badge);
  });
}

function buildCityFuncTable() {
  const tbody = document.getElementById('cityfunc-table-body');
  tbody.innerHTML = '';
  CITY_FUNCTIONS.forEach(city => {
    const tr = document.createElement('tr');
    tr.dataset.cityId = city.id;
    const funcLabels = city.functions.map(f => cfFuncLabel(f)).join(' / ');
    tr.innerHTML = `
      <td class="cf-td-city">${cfName(city)}</td>
      <td data-label="${t('cf_col_country')}">${cfCountry(city)}</td>
      <td data-label="${t('cf_col_function')}">${city.functions.map(f => {
        const meta = CITY_FUNC_TYPES[f];
        return `<span class="cf-func-badge" style="background:rgba(4,8,12,0.88);border:1px solid ${meta.color};color:${meta.color};margin:1px 3px 1px 0;display:inline-block;">${meta.icon} ${cfFuncLabel(f)}</span>`;
      }).join('')}</td>
      <td class="cf-td-desc" data-label="${t('cf_col_desc')}">${cfDesc(city)}</td>`;
    tr.addEventListener('click', () => {
      cfActiveCityId = city.id;
      cfSetView('map');
      showCityFuncCard(city);
      cfFlyToCity(city);
    });
    tbody.appendChild(tr);
  });
  cfFilterTable();
}

function cfFilterTable() {
  const q = (document.getElementById('cityfunc-search').value || '').trim().toLocaleLowerCase('tr');
  const rows = document.querySelectorAll('#cityfunc-table-body tr');
  let visibleCount = 0;
  rows.forEach(row => {
    const city = CITY_FUNCTIONS.find(c => String(c.id) === row.dataset.cityId);
    if (!city) return;
    const haystack = [
      cfName(city), cfCountry(city), cfDesc(city),
      ...city.functions.map(f => cfFuncLabel(f))
    ].join(' ').toLocaleLowerCase('tr');
    const match = !q || haystack.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });
  document.getElementById('cf-table-empty').style.display = visibleCount === 0 ? 'block' : 'none';
}

function cfFlyToCity(city) {
  const w = window.innerWidth, h = window.innerHeight;
  const [cx, cy] = projection([city.lon, city.lat]);
  const k = 4;
  svg.transition().duration(600).call(
    zoom.transform,
    d3.zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-cx, -cy)
  );
}


// ══════════════════════════════════════════════
let infoActiveDot = null;

function formatPop(n) {
  if (n >= 1000000000) return (n / 1000000000).toFixed(2).replace('.', ',') + ' milyar';
  if (n >= 1000000)    return (n / 1000000).toFixed(1).replace('.', ',') + ' milyon';
  if (n >= 1000)       return (n / 1000).toFixed(0) + ' bin';
  return n.toString();
}

function formatArea(km2) {
  const areaUnits = {
    tr:[' milyon km²',' bin km²'], en:[' million km²','k km²'],
    zh:[' 百万km²',' 千km²'], ar:[' مليون كم²',' ألف كم²'],
    es:[' millones km²',' mil km²'], fr:[' million km²',' mille km²'],
    de:[' Mio. km²',' Tsd. km²']
  };
  const [unitM] = areaUnits[currentLang] || areaUnits['tr'];
  if (km2 >= 1000000) return (km2 / 1000000).toFixed(2).replace('.', ',') + unitM;
  return km2.toLocaleString('tr-TR') + ' km²';
}

function showCountryInfo(id) {
  const name = getCountryName(id);
  if (!name) return;

  // Önceki seçimi kaldır
  if (infoActiveDot && infoActiveDot !== id) {
    const prev = countryPaths[infoActiveDot];
    if (prev) prev.classList.remove('info-selected');
  }
  infoActiveDot = id;
  const el = countryPaths[id];
  if (el) {
    if (el.classList.contains('found')) { el.dataset.wasFound='1'; el.classList.remove('found'); }
    el.classList.add('info-selected');
  }

  // Kart güncelle
  document.getElementById('info-card-hint').style.display = 'none';
  document.getElementById('info-country-name').textContent = name;
  document.getElementById('info-flag-display').innerHTML = getFlagImgHtml(id, 84);
  document.getElementById('info-country-header').style.display = 'flex';

  const info = COUNTRY_INFO[id];
  if (info) {
    document.getElementById('info-rows').style.display = 'block';
    document.getElementById('info-no-data').style.display = 'none';
    const capI18n = CAPITAL_I18N[info.cap];
    const translatedCap = (capI18n && capI18n[currentLang]) ? capI18n[currentLang] : info.cap;
    document.getElementById('info-capital').textContent = translatedCap;
    document.getElementById('info-pop').textContent = formatPopL(info.pop) + t('info_pop_suffix');

    const popRank = COUNTRY_POP_RANK[id];
    const popSuffix = currentLang === 'en' ? getOrdinalSuffix(popRank) : t('info_rank_suffix');
    document.getElementById('info-pop-rank').textContent = popRank ? popRank + popSuffix : '—';

    const areaInfo = COUNTRY_AREA[id];
    document.getElementById('info-area').textContent = areaInfo ? formatArea(areaInfo.km2) : '—';
    document.getElementById('info-area-rank').textContent = areaInfo ? areaInfo.rank + (currentLang === 'en' ? getOrdinalSuffix(areaInfo.rank) : t('info_rank_suffix')) : '—';

    showCapitalDot(info.lon, info.lat, info.cap);
  } else {
    document.getElementById('info-rows').style.display = 'none';
    document.getElementById('info-no-data').style.display = 'block';
    document.getElementById('info-no-data').textContent = t('info_no_data');
    hideCapitalDot();
  }
}

function showCapitalDot(lon, lat, capName) {
  const [px, py] = projection([lon, lat]);
  const transform = d3.zoomTransform(svg.node());
  const sx = transform.x + px * transform.k;
  const sy = transform.y + py * transform.k;

  const dot = document.getElementById('capital-dot');
  const lbl = document.getElementById('capital-label');
  const mc = document.getElementById('map-container');
  const rect = mc.getBoundingClientRect();

  dot.style.left = (rect.left + sx) + 'px';
  dot.style.top  = (rect.top + sy) + 'px';
  dot.style.display = 'block';

  lbl.style.left = (rect.left + sx + 10) + 'px';
  lbl.style.top  = (rect.top + sy - 10) + 'px';
  const capI18nLabel = CAPITAL_I18N[capName];
  lbl.textContent = (capI18nLabel && capI18nLabel[currentLang]) ? capI18nLabel[currentLang] : capName;
  lbl.style.display = 'block';
}

function hideCapitalDot() {
  document.getElementById('capital-dot').style.display = 'none';
  document.getElementById('capital-label').style.display = 'none';
}

function hideInfoMode() {
  hideCapitalDot();
  document.getElementById('info-card-hint').style.display = 'block';
  document.getElementById('info-country-header').style.display = 'none';
  document.getElementById('info-country-name').textContent = '';
  document.getElementById('info-flag-display').textContent = '';
  document.getElementById('info-rows').style.display = 'none';
  document.getElementById('info-no-data').style.display = 'none';
  if (infoActiveDot) {
    const prev = countryPaths[infoActiveDot];
    if (prev) prev.classList.remove('info-selected');
    infoActiveDot = null;
  }
}

// Zoom değişince başkent noktasını yeniden konumlandır
function updateCapitalDotPosition() {
  if (currentMode !== 'info' || !infoActiveDot) return;
  const info = COUNTRY_INFO[infoActiveDot];
  if (!info) return;
  showCapitalDot(info.lon, info.lat, info.cap);
}


// ══════════════════════════════════════════════
// DİL SİSTEMİ
// ══════════════════════════════════════════════
let currentLang = 'tr';



function getOrdinalSuffix(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return s[(v-20)%10] || s[v] || s[0];
}

function getCountryNamesForLang() {
  if (currentLang === 'tr') return COUNTRY_NAMES;
  const names = COUNTRY_NAMES_I18N[currentLang];
  if (!names) return COUNTRY_NAMES;
  // Merge: TR names as fallback
  const merged = {};
  for (const id in COUNTRY_NAMES) {
    merged[id] = names[id] || COUNTRY_NAMES[id];
  }
  return merged;
}

function getCountryName(id) {
  if (currentLang === 'tr') return COUNTRY_NAMES[id];
  const names = COUNTRY_NAMES_I18N[currentLang];
  return (names && names[String(id)]) || COUNTRY_NAMES[id];
}

async function selectLang(lang) {
  const status = document.getElementById('lang-loading-status');
  const buttons = document.querySelectorAll('.lang-btn');

  // Varsayılan dil (tr) zaten translations.js içinde gömülü — anında geçilebilir.
  // Diğer diller ilk seçildiğinde translations/<lang>.json dosyasından lazy-fetch edilir.
  if (lang !== 'tr') {
    buttons.forEach(b => b.setAttribute('disabled', 'disabled'));
    if (status) { status.textContent = '⏳ Yükleniyor...'; status.classList.remove('error'); }
    try {
      await loadLanguagePack(lang);
    } catch (err) {
      if (status) {
        status.textContent = '⚠ Dil paketi yüklenemedi, bağlantınızı kontrol edip tekrar deneyin.';
        status.classList.add('error');
      }
      buttons.forEach(b => b.removeAttribute('disabled'));
      return; // Türkçe'de kalınır, kullanıcı tekrar deneyebilir
    }
    buttons.forEach(b => b.removeAttribute('disabled'));
    if (status) { status.textContent = ''; status.classList.remove('error'); }
  }

  currentLang = lang;
  document.getElementById('lang-overlay').style.display = 'none';
  document.getElementById('social-box').style.display = 'none';
  applyLang();
  // Intro overlay'i göster
  document.getElementById('intro-overlay').style.display = 'flex';
}

function t(key) {
  const tr = TRANSLATIONS[currentLang];
  return (tr && tr[key] !== undefined) ? tr[key] : (TRANSLATIONS['tr'][key] || key);
}

function applyLang() {
  const lang = currentLang;
  const isRTL = lang === 'ar';
  document.documentElement.setAttribute('dir', isRTL ? 'rtl' : 'ltr');

  document.getElementById('game-title').textContent = t('game_title');

  // Mod tabları
  document.querySelector('[data-mode="search"]').textContent = t('mode_search');
  document.querySelector('[data-mode="find"]').textContent = t('mode_find');
  document.querySelector('[data-mode="capital"]').textContent = t('mode_capital');
  document.querySelector('[data-mode="guess"]').textContent = t('mode_guess');
  document.querySelector('[data-mode="flag"]').textContent = t('mode_flag');
  document.querySelector('[data-mode="info"]').textContent = t('mode_info');
  document.querySelector('[data-mode="physical"]').textContent = t('mode_physical');
  document.querySelector('[data-mode="tabu"]').textContent = t('mode_tabu');
  document.querySelector('[data-mode="tabu2"]').textContent = t('mode_tabu2') || 'ÖZEL TABU';

  // Bölge butonları
  document.querySelector('[data-region="all"]').textContent = t('region_all');
  document.querySelector('[data-region="europe"]').textContent = t('region_europe');
  document.querySelector('[data-region="asia"]').textContent = t('region_asia');
  document.querySelector('[data-region="africa"]').textContent = t('region_africa');
  document.querySelector('[data-region="americas"]').textContent = t('region_americas');
  document.querySelector('[data-region="oceania"]').textContent = t('region_oceania');

  // Sol panel
  const sl = document.querySelector('#left-panel .panel-label');
  if (sl) sl.textContent = t('search_label');
  const si = document.getElementById('country-search');
  if (si) si.placeholder = t('search_placeholder');
  const srl = document.getElementById('search-result-label');
  if (srl) srl.textContent = t('search_found_label');

  // İstatistikler
  const lbls = document.querySelectorAll('.stat-lbl');
  lbls.forEach(el => {
    const prev = el.previousElementSibling;
    if (!prev) return;
    const id = prev.id;
    if (id === 'stat-found') el.textContent = t('stat_found');
    else if (id === 'stat-total') el.textContent = t('stat_total');
    else if (id === 'stat-pct') el.textContent = t('stat_success');
    else if (id === 'q-correct') el.textContent = t('stat_correct');
    else if (id === 'q-wrong') el.textContent = t('stat_wrong');
    else if (id === 'q-streak') el.textContent = t('stat_streak');
    else if (id === 'flag-correct') el.textContent = t('flag_correct');
    else if (id === 'flag-wrong') el.textContent = t('flag_wrong');
    else if (id === 'flag-streak') el.textContent = t('flag_streak');
  });

  // Bayrak modu etiketleri
  const flagFindLbl = document.getElementById('flag-question-label');
  if (flagFindLbl) flagFindLbl.textContent = t('flag_find_label');
  const flagTimedLbl = document.getElementById('flag-question-label-timed');
  if (flagTimedLbl) flagTimedLbl.textContent = t('flag_timed_label');
  const flagTimerSel = document.querySelector('#flag-panel .panel-label[data-i18n="timer_label"]');
  if (flagTimerSel) flagTimerSel.textContent = t('timer_label');

  // Quiz timer label
  const quizTimerLbl = document.getElementById('quiz-timer-lbl');
  if (quizTimerLbl) quizTimerLbl.textContent = quizTimerSeconds === -1 ? t('timer_chrono') : t('timer_remaining');
  const quizTimerSelLbl = document.getElementById('quiz-timer-label');
  if (quizTimerSelLbl) quizTimerSelLbl.textContent = t('timer_label');
  // Quiz timer unlimited/chrono buttons
  const quizUnlimBtn = document.querySelector('.timer-opt[data-qsec="0"]');
  if (quizUnlimBtn) quizUnlimBtn.textContent = t('timer_unlimited');
  const quizChronoBtn = document.querySelector('.timer-opt[data-qsec="-1"]');
  if (quizChronoBtn) quizChronoBtn.textContent = t('timer_chrono') || '⏱';
  // Quiz DK buttons
  const qMinAbbr = t('min_abbr') || 'min';
  const qsec60 = document.querySelector('.timer-opt[data-qsec="60"]');
  if (qsec60) qsec60.textContent = `1 ${qMinAbbr}`;
  const qsec120 = document.querySelector('.timer-opt[data-qsec="120"]');
  if (qsec120) qsec120.textContent = `2 ${qMinAbbr}`;
  const qsec180 = document.querySelector('.timer-opt[data-qsec="180"]');
  if (qsec180) qsec180.textContent = `3 ${qMinAbbr}`;
  const qsec300 = document.querySelector('.timer-opt[data-qsec="300"]');
  if (qsec300) qsec300.textContent = `5 ${qMinAbbr}`;

  // Butonlar
  const btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.textContent = t('btn_next');
  const btnRestart = document.getElementById('btn-restart-timer');
  if (btnRestart) btnRestart.textContent = t('timer_restart');

  // Timer
  const timerLbl = document.getElementById('timer-lbl');
  if (timerLbl) timerLbl.textContent = timerSeconds === -1 ? t('timer_chrono') : t('timer_remaining');
  const timerSel = document.querySelector('#timer-select-box .panel-label');
  if (timerSel) timerSel.textContent = t('timer_label');
  const unlimBtn = document.querySelector('.timer-opt[data-sec="0"]');
  if (unlimBtn) unlimBtn.textContent = t('timer_unlimited');
  const chronoBtn = document.querySelector('.timer-opt[data-sec="-1"]');
  if (chronoBtn) chronoBtn.textContent = t('timer_chrono') || 'Kronometre';
  // Search mode DK buttons
  const minAbbr = t('min_abbr') || 'min';
  const sec300 = document.querySelector('.timer-opt[data-sec="300"]');
  if (sec300) sec300.textContent = `5 ${minAbbr}`;
  const sec900 = document.querySelector('.timer-opt[data-sec="900"]');
  if (sec900) sec900.textContent = `15 ${minAbbr}`;
  const sec1200 = document.querySelector('.timer-opt[data-sec="1200"]');
  if (sec1200) sec1200.textContent = `20 ${minAbbr}`;
  // Flag panel timer buttons
  const flagUnlimBtn = document.querySelector('.timer-opt[data-fsec="0"]');
  if (flagUnlimBtn) flagUnlimBtn.textContent = t('timer_unlimited');
  const flagChronoBtn = document.querySelector('.timer-opt[data-fsec="-1"]');
  if (flagChronoBtn) flagChronoBtn.textContent = t('timer_chrono') || 'Kronometre';
  // Flag panel DK buttons
  const fsec300 = document.querySelector('.timer-opt[data-fsec="300"]');
  if (fsec300) fsec300.textContent = `5 ${minAbbr}`;
  const fsec600 = document.querySelector('.timer-opt[data-fsec="600"]');
  if (fsec600) fsec600.textContent = `10 ${minAbbr}`;
  // Chrono modal back button
  const chronoBackBtn = document.getElementById('chrono-target-cancel');
  if (chronoBackBtn) chronoBackBtn.textContent = t('chrono_back') || '← Geri Dön';

  // Progress
  document.getElementById('progress-text').textContent = t('progress_start');
  document.getElementById('progress-text-quiz').textContent = t('quiz_waiting');

  // Answer input
  const ai = document.getElementById('answer-input');
  if (ai) ai.placeholder = t('answer_placeholder');

  // Bitiş ekranı statik metinler
  const endStats = document.querySelectorAll('.end-stat');
  if (endStats[0]) endStats[0].innerHTML = t('timer_end_found') + ' <span id="end-found">0</span>';
  if (endStats[1]) endStats[1].innerHTML = t('timer_end_total') + ' <span id="end-total">0</span>';
  if (endStats[2]) endStats[2].innerHTML = t('timer_end_pct') + ' <span id="end-pct">0%</span>';

  // Info panel
  const infoHint = document.getElementById('info-card-hint');
  if (infoHint) infoHint.textContent = t('info_hint');
  const infoRows = document.querySelectorAll('.info-row .info-lbl');
  infoRows.forEach(el => {
    const valId = el.nextElementSibling?.id;
    if (valId === 'info-capital') el.textContent = t('info_capital');
    else if (valId === 'info-pop') el.textContent = t('info_pop');
    else if (valId === 'info-pop-rank') el.textContent = t('info_pop_rank');
    else if (valId === 'info-area') el.textContent = t('info_area');
    else if (valId === 'info-area-rank') el.textContent = t('info_area_rank');
  });

  // Physical panel
  const physHint = document.getElementById('physical-hint');
  if (physHint) physHint.textContent = t('physical_hint');
  const legendTitle = document.querySelector('#physical-legend .panel-label');
  if (legendTitle) legendTitle.textContent = t('legend_title');
  const legendItems = document.querySelectorAll('.legend-item');
  const legendKeys = ['legend_mountain','legend_river','legend_lake','legend_sea','legend_desert'];
  legendItems.forEach((el, i) => {
    const txt = el.querySelector('span') || el.lastChild;
    if (legendKeys[i]) {
      const span = el.querySelector('span');
      if (span) span.textContent = t(legendKeys[i]);
      else if (el.lastChild && el.lastChild.nodeType === 3) el.lastChild.textContent = ' ' + t(legendKeys[i]);
    }
  });

  // Intro overlay içeriğini güncelle
  const howTitle = document.querySelector('#intro-overlay [style*="Unbounded"]');
  if (howTitle) howTitle.textContent = t('how_to_play');
  const startBtn = document.querySelector('#intro-overlay button');
  if (startBtn) startBtn.textContent = t('intro_start');

  // Intro açıklama metinleri (data-i18n ile)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // Placeholder çevirisi
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // İnteraktif harita açıksa ülke labellarını yenile
  try {
    const imapWrap = document.getElementById('cg-interactive-map-wrap');
    const isOpen = imapWrap && imapWrap.classList.contains('active');
    if (isOpen && typeof cgiSvg !== 'undefined' && cgiSvg && typeof cgiG !== 'undefined' && cgiG && typeof cgInitInteractiveMap === 'function') {
      cgiG.selectAll('.cgi-label-layer').remove();
      window._cgiLabelData = [];
      window._cgiRedrawLabels = null;
      cgiInited = false;
      cgiG = null;
      if (cgiSvg && typeof cgiSvg.on === 'function') cgiSvg.on('.zoom', null);
      cgInitInteractiveMap();
    }
  } catch(e) { /* harita henüz hazır değil */ }

  // Şehir Fonksiyonları modunun dinamik içeriğini yenile
  if (cfInitialized) {
    buildCityFuncLegend();
    buildCityFuncTable();
    if (cfActiveCityId !== null) {
      const activeCity = CITY_FUNCTIONS.find(c => c.id === cfActiveCityId);
      if (activeCity) showCityFuncCard(activeCity);
    }
    if (currentMode === 'cityfunc' && cfCurrentView === 'map') renderCityFuncMarkers();
  }
}

// formatPop ve formatArea artık dil bilgisi kullanacak
function formatPopL(n) {
  if (n >= 1000000000) return (n / 1000000000).toFixed(2).replace('.', ',') + t('info_pop_unit_b');
  if (n >= 1000000)    return (n / 1000000).toFixed(1).replace('.', ',') + t('info_pop_unit_m');
  if (n >= 1000)       return (n / 1000).toFixed(0) + t('info_pop_unit_k');
  return n.toString();
}

// ══════════════════════════════════════════════
// SONUÇ KARTI PAYLAŞMA
// ══════════════════════════════════════════════
function shareResult(type) {
  const W = 720, H = 440;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // --- Arka plan ---
  ctx.fillStyle = '#0a0f0a';
  ctx.fillRect(0, 0, W, H);

  // --- Üst gradient şerit ---
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#39ff88');
  grad.addColorStop(0.5, '#00cfff');
  grad.addColorStop(1, '#ffcc00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 5);

  // --- Dış çerçeve ---
  ctx.strokeStyle = '#2a5a2e';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // --- Başlık ---
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#39ff88';
  ctx.textAlign = 'left';
  ctx.fillText('THEGEOGRAPHERS', 40, 50);

  // --- Link ---
  ctx.font = '12px monospace';
  ctx.fillStyle = '#00cfff';
  ctx.fillText('thegeographers.com', 40, 70);

  // --- Mod ve bölge ---
  let modeLabel, stats;
  const regionLabels = { all:'TUMU', europe:'AVRUPA', asia:'ASYA', africa:'AFRIKA', americas:'AMERIKA', oceania:'OKYANUSYA' };

  if (type === 'search') {
    const found = document.getElementById('end-found').textContent;
    const total = document.getElementById('end-total').textContent;
    const pctRaw = document.getElementById('end-pct').textContent;
    // Kronometre modunda pct "72%  (2:34)" şeklinde gelir — sadece % kısmını al
    const pct = pctRaw.includes('(') ? pctRaw.split('(')[0].trim() : pctRaw;
    const timeStr = pctRaw.includes('(') ? pctRaw.match(/\(([^)]+)\)/)?.[1] || '' : '';
    modeLabel = timerSeconds === -1 ? 'KRONOMETRE' : 'ISIM -> HARITA';
    stats = [
      { label: 'BULUNAN', value: found, color: '#39ff88' },
      { label: 'TOPLAM',  value: total, color: '#00cfff' },
      { label: timeStr ? 'SURE' : 'BASARI', value: timeStr || pct, color: '#ffcc00' },
    ];
  } else {
    const correctRaw = document.getElementById('qend-correct').textContent;
    const wrongRaw   = document.getElementById('qend-wrong').textContent;
    const pctRaw     = document.getElementById('qend-pct').textContent;
    const pct = pctRaw.includes('(') ? pctRaw.split('(')[0].trim() : pctRaw;
    const timeStr = pctRaw.includes('(') ? pctRaw.match(/\(([^)]+)\)/)?.[1] || '' : '';
    const isFlag = currentMode === 'flag';
    const isChrono = quizTimerSeconds === -1;
    modeLabel = isFlag ? 'BAYRAK BUL' : currentMode === 'find' ? 'HARITADA BUL' : 'ULKE TAHMIN ET';
    if (isChrono) modeLabel += ' (KRONO)';
    stats = [
      { label: 'DOGRU',  value: correctRaw, color: '#39ff88' },
      { label: 'YANLIS', value: wrongRaw,   color: '#ff4466' },
      { label: timeStr ? 'SURE' : 'BASARI', value: timeStr || pct, color: '#ffcc00' },
    ];
  }

  ctx.font = '12px monospace';
  ctx.fillStyle = '#7aaa7e';
  ctx.fillText('MOD: ' + modeLabel + '     BOLGE: ' + (regionLabels[currentRegion] || 'TUMU'), 40, 94);

  // --- Ayırıcı ---
  ctx.strokeStyle = '#2a5a2e';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, 110); ctx.lineTo(W - 40, 110); ctx.stroke();

  // --- İstatistik kutuları ---
  const boxW = 188, boxH = 150, boxY = 132, gap = 18;
  const totalBoxW = stats.length * boxW + (stats.length - 1) * gap;
  const startX = (W - totalBoxW) / 2;

  stats.forEach((s, i) => {
    const x = startX + i * (boxW + gap);

    // Kutu arka plan
    ctx.fillStyle = '#111a12';
    ctx.fillRect(x, boxY, boxW, boxH);

    // Kutu çerçeve (renkli)
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(x, boxY, boxW, boxH);
    ctx.globalAlpha = 1;

    // Üst renkli şerit
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, boxY, boxW, 4);
    ctx.globalAlpha = 1;

    // Değer — büyük ve parlak, uzunluğa göre font küçülür
    const valStr = String(s.value);
    const fontSize = valStr.length <= 4 ? 58 : valStr.length <= 7 ? 40 : 28;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    ctx.fillText(valStr, x + boxW / 2, boxY + 86);

    // Etiket — açık gri, net okunur
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#c8e8cc';
    ctx.fillText(s.label, x + boxW / 2, boxY + 118);
  });

  ctx.textAlign = 'left';

  // --- Ayırıcı ---
  ctx.strokeStyle = '#2a5a2e';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, boxY + boxH + 22); ctx.lineTo(W - 40, boxY + boxH + 22); ctx.stroke();

  // --- Alt imza ---
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#39ff88';
  ctx.globalAlpha = 0.9;
  ctx.fillText('thegeographers.com', 40, H - 20);
  ctx.textAlign = 'right';
  ctx.font = '11px monospace';
  ctx.fillStyle = '#7aaa7e';
  ctx.globalAlpha = 0.7;
  ctx.fillText(new Date().toLocaleDateString('tr-TR'), W - 40, H - 20);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';

  // --- Paylaş / Göster ---
  let dataURL;
  try { dataURL = canvas.toDataURL('image/png'); }
  catch(e) { alert('Gorsel olusturulamadi: ' + e.message); return; }

  function doOpenImage() {
    // Yeni sekmede görseli aç — kullanıcı oradan uzun basıp kaydedebilir/paylaşabilir
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<html><head><title>Cografya Sonucu</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#080c10;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;}img{max-width:100%;border:1px solid #2a5a2e;}p{color:#7aaa7e;font-family:monospace;font-size:12px;letter-spacing:1px;}</style></head><body><img src="' + dataURL + '"><p>Gorsel uzerine uzun bas → Kaydet / Paylas</p></body></html>');
      win.document.close();
    }
  }

  canvas.toBlob(async function(blob) {
    if (!blob) { doOpenImage(); return; }
    const file = new File([blob], 'cografya-sonuc.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Cografya Oyunu Sonucum', text: 'Cografya Oyunu sonucum!\nthegeographers.com\'da sen de oyna.' });
        return;
      } catch(e) {
        if (e.name !== 'AbortError') doOpenImage();
        return;
      }
    }
    doOpenImage();
  }, 'image/png');
}

// ══════════════════════════════════════════════
// KRONOMETRE HEDEF SEÇİM MODALI
// ══════════════════════════════════════════════
let _chronoModalMode = 'search'; // hangi mod için açıldı
let chronoTarget = 0; // 0 = hedef yok (eski davranış), >0 = hedef sayı

function openChronoModal(mode) {
  _chronoModalMode = mode;
  const isFlagMode = (mode === 'flag');
  const isQuizMode = (mode === 'quiz');
  document.getElementById('chrono-modal-title').textContent = t('chrono_title') || '⏱ KRONOMETRE';
  document.getElementById('chrono-modal-subtitle').textContent =
    isFlagMode ? (t('chrono_subtitle_flag') || 'Kaç bayrak hedefliyorsun?') :
    isQuizMode ? (t('chrono_subtitle_quiz') || 'Kaç soru hedefliyorsun?') :
    (t('chrono_subtitle_search') || 'Kaç ülke hedefliyorsun?');
  const unit = isFlagMode ? (t('chrono_unit_flag') || 'bayrak') :
               isQuizMode ? (t('chrono_unit_quiz') || 'soru') :
               (t('chrono_unit_search') || 'ülke');
  document.querySelectorAll('.chrono-target-btn span').forEach(s => {
    s.textContent = unit;
  });
  document.getElementById('chrono-target-overlay').classList.add('show');
}

function cancelChronoTarget() {
  document.getElementById('chrono-target-overlay').classList.remove('show');
  if (_chronoModalMode === 'search') {
    document.querySelectorAll('.timer-opt[data-sec]').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.sec) === 0)
    );
  } else if (_chronoModalMode === 'flag') {
    document.querySelectorAll('.timer-opt[data-fsec]').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.fsec) === 0)
    );
  } else {
    // quiz mode
    document.querySelectorAll('.timer-opt[data-qsec]').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.qsec) === 0)
    );
  }
}

function selectChronoTarget(n) {
  chronoTarget = n;
  document.getElementById('chrono-target-overlay').classList.remove('show');
  if (_chronoModalMode === 'search') {
    setTimerMode(-1);
  } else if (_chronoModalMode === 'flag') {
    setFlagTimerMode(-1);
  } else {
    // quiz mode: kronometre mantığıyla çalışacak
    setQuizTimerMode(-1);
  }
}

// ── Hedef tamamlandı mı kontrolü ──
function checkChronoTarget() {
  if (chronoTarget <= 0) return false;
  if (_chronoModalMode === 'search' || currentMode === 'search') {
    const regionIds = getRegionIds();
    const found = [...foundCountries].filter(id => regionIds.includes(id)).length;
    return found >= chronoTarget;
  } else {
    // flag modu: doğru cevap sayısı
    return quizCorrect >= chronoTarget;
  }
}

initMap();
// Başlangıçta varsayılan olarak süreli mod ile başlar (süresiz değil) — her mod kendi en yüksek süresiyle
setTimerMode(900);      // İsim → Harita modu: 15 Dk
setQuizTimerMode(300);  // Quiz paneli: 5 Dk
setFlagTimerMode(600);  // Bayrak/Harita paneli: 10 Dk

// ── TEMA ──
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  document.getElementById('theme-toggle').textContent = isLight ? '🌙' : '☀';
}
// Başlangıçta beyaz tema
document.body.classList.add('light-theme');
document.getElementById('theme-toggle').textContent = '🌙';

// ── HARİTA RENK PALETİ ──
// Yeni palet eklemek için bu diziye yeni bir obje eklemek yeterli.
// Buton her tıklamada listede sıradaki palete geçer (sona gelince başa döner).
const MAP_PALETTES = [
  { id: 'classic', name: 'ŞUANKİ',      icon: '🎨', land: null,      ocean: null,      border: null },
  { id: 'bw',       name: 'SİYAH-BEYAZ', icon: '⬛', land: '#e9e9e6', ocean: '#3d7fb5', border: '#161616' },
];

function applyMapPalette(id, silent) {
  const p = MAP_PALETTES.find(x => x.id === id) || MAP_PALETTES[0];
  if (p.land)   document.body.style.setProperty('--land', p.land);   else document.body.style.removeProperty('--land');
  if (p.ocean)  document.body.style.setProperty('--ocean', p.ocean); else document.body.style.removeProperty('--ocean');
  if (p.border) document.body.style.setProperty('--border', p.border); else document.body.style.removeProperty('--border');
  if (!silent) localStorage.setItem('cg_map_palette', p.id);
  const btn = document.getElementById('map-palette-btn');
  if (btn) { btn.title = 'Harita Rengi: ' + p.name; }
}

function cycleMapPalette() {
  const current = localStorage.getItem('cg_map_palette') || 'classic';
  const idx = MAP_PALETTES.findIndex(x => x.id === current);
  const next = MAP_PALETTES[(idx + 1) % MAP_PALETTES.length];
  applyMapPalette(next.id);
}

// Sayfa her açıldığında varsayılan olarak "şuanki" (yeşilimsi) palet ile başlar
(function initMapPalette() {
  applyMapPalette('classic', true);
})();

// ── MOBİL: Quiz paneli panel-area içine taşı ──
(function() {
  function isMobile() { return window.innerWidth <= 600; }

  const quizPanel = document.getElementById('quiz-panel');
  const panelArea = document.getElementById('panel-area');
  const originalParent = quizPanel.parentNode;
  const originalNextSibling = quizPanel.nextSibling;

  function repositionQuizPanel() {
    if (isMobile()) {
      // Mobil: panel-area'nın sonuna taşı
      if (quizPanel.parentNode !== panelArea) {
        panelArea.appendChild(quizPanel);
      }
    } else {
      // Masaüstü: orijinal yerine geri al
      if (quizPanel.parentNode !== originalParent) {
        if (originalNextSibling) {
          originalParent.insertBefore(quizPanel, originalNextSibling);
        } else {
          originalParent.appendChild(quizPanel);
        }
      }
    }
  }

  repositionQuizPanel();
  window.addEventListener('resize', repositionQuizPanel);
})();

// ══════════════════════════════════════════════
// TABU MODU
// ══════════════════════════════════════════════

/* -> moved to data.js / translations.js */


// Mixed = country + geo combined
TABU_CARDS.mixed = [...TABU_CARDS.country, ...TABU_CARDS.geo];

TABU_CARDS.lesson = [
  // ── İKLİM & HAVA ──
  { word:{tr:'Muson',en:'Monsoon',zh:'季风',ar:'موسم الأمطار',es:'Monzón',fr:'Mousson',de:'Monsun'},
    forbidden:{tr:['Yağmur','Hindistan','Asya','Mevsim','Rüzgar'],en:['Rain','India','Asia','Season','Wind'],zh:['雨','印度','亚洲','季节','风'],ar:['مطر','الهند','آسيا','موسم','ريح'],es:['Lluvia','India','Asia','Estación','Viento'],fr:['Pluie','Inde','Asie','Saison','Vent'],de:['Regen','Indien','Asien','Jahreszeit','Wind']}},
  { word:{tr:'İklim',en:'Climate',zh:'气候',ar:'المناخ',es:'Clima',fr:'Climat',de:'Klima'},
    forbidden:{tr:['Hava','Sıcaklık','Yağış','Uzun Dönem','Küresel'],en:['Weather','Temperature','Rainfall','Long Term','Global'],zh:['天气','温度','降雨','长期','全球'],ar:['طقس','حرارة','أمطار','طويل الأمد','عالمي'],es:['Tiempo','Temperatura','Lluvia','Largo Plazo','Global'],fr:['Météo','Température','Précipitations','Long Terme','Mondial'],de:['Wetter','Temperatur','Niederschlag','Langzeit','Global']}},
  { word:{tr:'El Nino',en:'El Niño',zh:'厄尔尼诺',ar:'النينيو',es:'El Niño',fr:'El Niño',de:'El Niño'},
    forbidden:{tr:['Pasifik','Sıcaklık','İklim','Peru','Okyanus'],en:['Pacific','Temperature','Climate','Peru','Ocean'],zh:['太平洋','温度','气候','秘鲁','海洋'],ar:['المحيط الهادئ','حرارة','مناخ','بيرو','محيط'],es:['Pacífico','Temperatura','Clima','Perú','Océano'],fr:['Pacifique','Température','Climat','Pérou','Océan'],de:['Pazifik','Temperatur','Klima','Peru','Ozean']}},
  { word:{tr:'Tayfun',en:'Typhoon',zh:'台风',ar:'الإعصار',es:'Tifón',fr:'Typhon',de:'Taifun'},
    forbidden:{tr:['Fırtına','Pasifik','Asya','Rüzgar','Kasırga'],en:['Storm','Pacific','Asia','Wind','Hurricane'],zh:['风暴','太平洋','亚洲','风','飓风'],ar:['عاصفة','المحيط الهادئ','آسيا','ريح','إعصار'],es:['Tormenta','Pacífico','Asia','Viento','Huracán'],fr:['Tempête','Pacifique','Asie','Vent','Ouragan'],de:['Sturm','Pazifik','Asien','Wind','Hurrikan']}},
  { word:{tr:'Tornado',en:'Tornado',zh:'龙卷风',ar:'إعصار',es:'Tornado',fr:'Tornade',de:'Tornado'},
    forbidden:{tr:['Hortum','ABD','Rüzgar','Fırtına','Huni'],en:['Funnel','USA','Wind','Storm','Twister'],zh:['漏斗','美国','风','风暴','旋风'],ar:['قمع','أمريكا','ريح','عاصفة','دوامة'],es:['Embudo','EE.UU.','Viento','Tormenta','Torbellino'],fr:['Entonnoir','États-Unis','Vent','Tempête','Trombe'],de:['Trichter','USA','Wind','Sturm','Windhose']}},
  { word:{tr:'Küresel Isınma',en:'Global Warming',zh:'全球变暖',ar:'الاحترار العالمي',es:'Calentamiento Global',fr:'Réchauffement Climatique',de:'Globale Erwärmung'},
    forbidden:{tr:['İklim','Sera','Karbondioksit','Buzul','Sıcaklık'],en:['Climate','Greenhouse','CO2','Glacier','Temperature'],zh:['气候','温室','二氧化碳','冰川','温度'],ar:['مناخ','احتباس','ثاني أكسيد الكربون','جليد','حرارة'],es:['Clima','Invernadero','CO2','Glaciar','Temperatura'],fr:['Climat','Serre','CO2','Glacier','Température'],de:['Klima','Treibhaus','CO2','Gletscher','Temperatur']}},
  { word:{tr:'Sera Etkisi',en:'Greenhouse Effect',zh:'温室效应',ar:'تأثير الاحتباس الحراري',es:'Efecto Invernadero',fr:'Effet de Serre',de:'Treibhauseffekt'},
    forbidden:{tr:['Isınma','CO2','Atmosfer','Gaz','Güneş'],en:['Warming','CO2','Atmosphere','Gas','Sun'],zh:['变暖','二氧化碳','大气层','气体','太阳'],ar:['احترار','ثاني أكسيد الكربون','غلاف جوي','غاز','شمس'],es:['Calentamiento','CO2','Atmósfera','Gas','Sol'],fr:['Réchauffement','CO2','Atmosphère','Gaz','Soleil'],de:['Erwärmung','CO2','Atmosphäre','Gas','Sonne']}},
  // ── YERYÜZÜ ŞEKİLLERİ ──
  { word:{tr:'Delta',en:'Delta',zh:'三角洲',ar:'دلتا',es:'Delta',fr:'Delta',de:'Delta'},
    forbidden:{tr:['Nehir','Ağız','Nil','Üçgen','Alüvyon'],en:['River','Mouth','Nile','Triangle','Alluvial'],zh:['河','河口','尼罗河','三角形','冲积'],ar:['نهر','مصب','النيل','مثلث','غريني'],es:['Río','Desembocadura','Nilo','Triángulo','Aluvión'],fr:['Fleuve','Embouchure','Nil','Triangle','Alluvial'],de:['Fluss','Mündung','Nil','Dreieck','Alluvial']}},
  { word:{tr:'Fiyord',en:'Fjord',zh:'峡湾',ar:'فيورد',es:'Fiordo',fr:'Fjord',de:'Fjord'},
    forbidden:{tr:['Norveç','Deniz','Dar','Dik','İskandinavya'],en:['Norway','Sea','Narrow','Steep','Scandinavia'],zh:['挪威','海','狭窄','陡峭','斯堪的纳维亚'],ar:['النرويج','بحر','ضيق','شديد الانحدار','إسكندنافيا'],es:['Noruega','Mar','Estrecho','Escarpado','Escandinavia'],fr:['Norvège','Mer','Étroit','Escarpé','Scandinavie'],de:['Norwegen','Meer','Eng','Steil','Skandinavien']}},
  { word:{tr:'Vadi',en:'Valley',zh:'山谷',ar:'الوادي',es:'Valle',fr:'Vallée',de:'Tal'},
    forbidden:{tr:['Dağ','Nehir','Çukur','Ova','Aşınma'],en:['Mountain','River','Low','Plain','Erosion'],zh:['山','河','低地','平原','侵蚀'],ar:['جبل','نهر','منخفض','سهل','تآكل'],es:['Montaña','Río','Bajo','Llanura','Erosión'],fr:['Montagne','Rivière','Bas','Plaine','Érosion'],de:['Berg','Fluss','Tief','Ebene','Erosion']}},
  { word:{tr:'Yarımada',en:'Peninsula',zh:'半岛',ar:'شبه الجزيرة',es:'Península',fr:'Péninsule',de:'Halbinsel'},
    forbidden:{tr:['Kara','Su','Üç Taraf','İspanya','Anadolu'],en:['Land','Water','Three Sides','Spain','Anatolia'],zh:['陆地','水','三面','西班牙','安纳托利亚'],ar:['أرض','ماء','ثلاثة جوانب','إسبانيا','الأناضول'],es:['Tierra','Agua','Tres Lados','España','Anatolia'],fr:['Terre','Eau','Trois Côtés','Espagne','Anatolie'],de:['Land','Wasser','Drei Seiten','Spanien','Anatolien']}},
  { word:{tr:'Ada',en:'Island',zh:'岛屿',ar:'جزيرة',es:'Isla',fr:'Île',de:'Insel'},
    forbidden:{tr:['Su','Kara','Çevrili','Avustralya','Okyanus'],en:['Water','Land','Surrounded','Australia','Ocean'],zh:['水','陆地','围绕','澳大利亚','海洋'],ar:['ماء','أرض','محاط','أستراليا','محيط'],es:['Agua','Tierra','Rodeado','Australia','Océano'],fr:['Eau','Terre','Entouré','Australie','Océan'],de:['Wasser','Land','Umgeben','Australien','Ozean']}},
  { word:{tr:'Boğaz',en:'Strait',zh:'海峡',ar:'مضيق',es:'Estrecho',fr:'Détroit',de:'Meerenge'},
    forbidden:{tr:['Deniz','Dar','İstanbul','Kanal','Su'],en:['Sea','Narrow','Istanbul','Canal','Water'],zh:['海','狭窄','伊斯坦布尔','运河','水'],ar:['بحر','ضيق','إسطنبول','قناة','ماء'],es:['Mar','Estrecho','Estambul','Canal','Agua'],fr:['Mer','Étroit','Istanbul','Canal','Eau'],de:['Meer','Eng','Istanbul','Kanal','Wasser']}},
  { word:{tr:'Volkan',en:'Volcano',zh:'火山',ar:'بركان',es:'Volcán',fr:'Volcan',de:'Vulkan'},
    forbidden:{tr:['Lav','Patlama','Magma','Etna','Dağ'],en:['Lava','Eruption','Magma','Etna','Mountain'],zh:['熔岩','喷发','岩浆','埃特纳','山'],ar:['حمم','ثوران','ماغما','إتنا','جبل'],es:['Lava','Erupción','Magma','Etna','Montaña'],fr:['Lave','Éruption','Magma','Etna','Montagne'],de:['Lava','Eruption','Magma','Ätna','Berg']}},
  { word:{tr:'Deprem',en:'Earthquake',zh:'地震',ar:'زلزال',es:'Terremoto',fr:'Tremblement de Terre',de:'Erdbeben'},
    forbidden:{tr:['Sismik','Fay','Richter','Japon','Titreme'],en:['Seismic','Fault','Richter','Japan','Shake'],zh:['地震波','断层','里氏','日本','震动'],ar:['زلزالي','صدع','ريختر','اليابان','اهتزاز'],es:['Sísmico','Falla','Richter','Japón','Temblor'],fr:['Sismique','Faille','Richter','Japon','Secousse'],de:['Seismisch','Verwerfung','Richter','Japan','Beben']}},
  { word:{tr:'Tsunami',en:'Tsunami',zh:'海啸',ar:'تسونامي',es:'Tsunami',fr:'Tsunami',de:'Tsunami'},
    forbidden:{tr:['Dalga','Deprem','Okyanus','Japonya','Taşkın'],en:['Wave','Earthquake','Ocean','Japan','Flood'],zh:['海浪','地震','海洋','日本','洪水'],ar:['موجة','زلزال','محيط','اليابان','فيضان'],es:['Ola','Terremoto','Océano','Japón','Inundación'],fr:['Vague','Séisme','Océan','Japon','Inondation'],de:['Welle','Erdbeben','Ozean','Japan','Flut']}},
  { word:{tr:' Buzul',en:'Glacier',zh:'冰川',ar:'نهر جليدي',es:'Glaciar',fr:'Glacier',de:'Gletscher'},
    forbidden:{tr:['Buz','Dağ','Erime','İklim','Antarktika'],en:['Ice','Mountain','Melting','Climate','Antarctica'],zh:['冰','山','融化','气候','南极洲'],ar:['جليد','جبل','ذوبان','مناخ','القطب الجنوبي'],es:['Hielo','Montaña','Derretir','Clima','Antártida'],fr:['Glace','Montagne','Fonte','Climat','Antarctique'],de:['Eis','Berg','Schmelzen','Klima','Antarktis']}},
  { word:{tr:'Kanyon',en:'Canyon',zh:'峡谷',ar:'كانيون',es:'Cañón',fr:'Canyon',de:'Canyon'},
    forbidden:{tr:['Vadi','Derin','Nehir','Colorado','Aşınma'],en:['Valley','Deep','River','Colorado','Erosion'],zh:['山谷','深','河','科罗拉多','侵蚀'],ar:['وادي','عميق','نهر','كولورادو','تآكل'],es:['Valle','Profundo','Río','Colorado','Erosión'],fr:['Vallée','Profond','Rivière','Colorado','Érosion'],de:['Tal','Tief','Fluss','Colorado','Erosion']}},
  { word:{tr:'Mağara',en:'Cave',zh:'洞穴',ar:'كهف',es:'Cueva',fr:'Grotte',de:'Höhle'},
    forbidden:{tr:['Karanlık','Yeraltı','Taş','Stalaktit','Yarasa'],en:['Dark','Underground','Rock','Stalactite','Bat'],zh:['黑暗','地下','岩石','钟乳石','蝙蝠'],ar:['ظلام','تحت الأرض','صخر','صواعد','خفاش'],es:['Oscuro','Subterráneo','Roca','Estalactita','Murciélago'],fr:['Sombre','Souterrain','Roche','Stalactite','Chauve-Souris'],de:['Dunkel','Unterirdisch','Fels','Stalaktit','Fledermaus']}},
  // ── EKOSİSTEM & BİYOM ──
  { word:{tr:'Tropikal Yağmur Ormanı',en:'Tropical Rainforest',zh:'热带雨林',ar:'الغابة الاستوائية',es:'Selva Tropical',fr:'Forêt Tropicale',de:'Tropischer Regenwald'},
    forbidden:{tr:['Amazon','Nemli','Sıcak','Biyoçeşitlilik','Ekvatoral'],en:['Amazon','Humid','Hot','Biodiversity','Equatorial'],zh:['亚马逊','潮湿','炎热','生物多样性','赤道'],ar:['الأمازون','رطب','حار','تنوع بيولوجي','استوائي'],es:['Amazonas','Húmedo','Caliente','Biodiversidad','Ecuatorial'],fr:['Amazone','Humide','Chaud','Biodiversité','Équatorial'],de:['Amazonas','Feucht','Heiß','Biodiversität','Äquatorial']}},
  { word:{tr:'Tundra',en:'Tundra',zh:'苔原',ar:'التندرا',es:'Tundra',fr:'Toundra',de:'Tundra'},
    forbidden:{tr:['Soğuk','Kutup','Ağaçsız','Sibirya','Permafrost'],en:['Cold','Polar','Treeless','Siberia','Permafrost'],zh:['寒冷','极地','无树','西伯利亚','永冻土'],ar:['بارد','قطبي','بلا أشجار','سيبيريا','تربة صقيع'],es:['Frío','Polar','Sin Árboles','Siberia','Permafrost'],fr:['Froid','Polaire','Sans Arbres','Sibérie','Pergélisol'],de:['Kalt','Polar','Baumlos','Sibirien','Permafrost']}},
  { word:{tr:'Savanah',en:'Savanna',zh:'热带草原',ar:'السافانا',es:'Sabana',fr:'Savane',de:'Savanne'},
    forbidden:{tr:['Afrika','Ot','Aslan','Kurak','Tropikal'],en:['Africa','Grass','Lion','Dry','Tropical'],zh:['非洲','草','狮子','干旱','热带'],ar:['أفريقيا','عشب','أسد','جاف','استوائي'],es:['África','Hierba','León','Seco','Tropical'],fr:['Afrique','Herbe','Lion','Sec','Tropical'],de:['Afrika','Gras','Löwe','Trocken','Tropisch']}},
  { word:{tr:'Mercan Resifi',en:'Coral Reef',zh:'珊瑚礁',ar:'الشعب المرجانية',es:'Arrecife de Coral',fr:'Récif Corallien',de:'Korallenriff'},
    forbidden:{tr:['Okyanus','Renkli','Balık','Avustralya','Ekosistem'],en:['Ocean','Colorful','Fish','Australia','Ecosystem'],zh:['海洋','多彩','鱼','澳大利亚','生态系统'],ar:['محيط','ملون','سمك','أستراليا','نظام بيئي'],es:['Océano','Colorido','Pez','Australia','Ecosistema'],fr:['Océan','Coloré','Poisson','Australie','Écosystème'],de:['Ozean','Bunt','Fisch','Australien','Ökosystem']}},
  { word:{tr:'Step',en:'Steppe',zh:'草原',ar:'السهوب',es:'Estepa',fr:'Steppe',de:'Steppe'},
    forbidden:{tr:['Ot','Karasal','Rusya','Kazakistan','Kurak'],en:['Grass','Continental','Russia','Kazakhstan','Dry'],zh:['草','大陆性','俄罗斯','哈萨克斯坦','干旱'],ar:['عشب','قاري','روسيا','كازاخستان','جاف'],es:['Hierba','Continental','Rusia','Kazajistán','Seco'],fr:['Herbe','Continental','Russie','Kazakhstan','Sec'],de:['Gras','Kontinental','Russland','Kasachstan','Trocken']}},
  { word:{tr:'Bataklık',en:'Swamp',zh:'沼泽',ar:'المستنقع',es:'Pantano',fr:'Marécage',de:'Sumpf'},
    forbidden:{tr:['Su','Nemli','Timsah','Biyom','Florida'],en:['Water','Wet','Crocodile','Biome','Florida'],zh:['水','湿','鳄鱼','生物群落','佛罗里达'],ar:['ماء','رطب','تمساح','منظومة','فلوريدا'],es:['Agua','Húmedo','Cocodrilo','Bioma','Florida'],fr:['Eau','Humide','Crocodile','Biome','Floride'],de:['Wasser','Nass','Krokodil','Biom','Florida']}},
  // ── NÜFUS & YERLEŞİM ──
  { word:{tr:'Nüfus',en:'Population',zh:'人口',ar:'السكان',es:'Población',fr:'Population',de:'Bevölkerung'},
    forbidden:{tr:['İnsan','Sayım','Çin','Artış','Yoğunluk'],en:['People','Census','China','Growth','Density'],zh:['人','人口普查','中国','增长','密度'],ar:['بشر','تعداد','الصين','نمو','كثافة'],es:['Gente','Censo','China','Crecimiento','Densidad'],fr:['Gens','Recensement','Chine','Croissance','Densité'],de:['Menschen','Volkszählung','China','Wachstum','Dichte']}},
  { word:{tr:'Göç',en:'Migration',zh:'移民',ar:'الهجرة',es:'Migración',fr:'Migration',de:'Migration'},
    forbidden:{tr:['Taşınma','Ülke','Mülteci','İş','Sınır'],en:['Move','Country','Refugee','Work','Border'],zh:['移动','国家','难民','工作','边界'],ar:['تنقل','بلد','لاجئ','عمل','حدود'],es:['Mover','País','Refugiado','Trabajo','Frontera'],fr:['Déplacer','Pays','Réfugié','Travail','Frontière'],de:['Bewegen','Land','Flüchtling','Arbeit','Grenze']}},
  { word:{tr:'Kentleşme',en:'Urbanization',zh:'城市化',ar:'التحضر',es:'Urbanización',fr:'Urbanisation',de:'Urbanisierung'},
    forbidden:{tr:['Şehir','Köy','Nüfus','Fabrika','Göç'],en:['City','Village','Population','Factory','Migration'],zh:['城市','村庄','人口','工厂','移民'],ar:['مدينة','قرية','سكان','مصنع','هجرة'],es:['Ciudad','Pueblo','Población','Fábrica','Migración'],fr:['Ville','Village','Population','Usine','Migration'],de:['Stadt','Dorf','Bevölkerung','Fabrik','Migration']}},
  { word:{tr:'Megakent',en:'Megacity',zh:'超大城市',ar:'مدينة عملاقة',es:'Megaciudad',fr:'Mégalopole',de:'Megastadt'},
    forbidden:{tr:['Büyük','Şehir','Nüfus','Tokyo','İstanbul'],en:['Large','City','Population','Tokyo','Istanbul'],zh:['大','城市','人口','东京','伊斯坦布尔'],ar:['كبير','مدينة','سكان','طوكيو','إسطنبول'],es:['Grande','Ciudad','Población','Tokio','Estambul'],fr:['Grande','Ville','Population','Tokyo','Istanbul'],de:['Groß','Stadt','Bevölkerung','Tokio','Istanbul']}},
  // ── HARİTA BİLGİSİ ──
  { word:{tr:'Ekvator',en:'Equator',zh:'赤道',ar:'خط الاستواء',es:'Ecuador',fr:'Équateur',de:'Äquator'},
    forbidden:{tr:['Sıfır','Derece','Sıcak','Orta','Paralel'],en:['Zero','Degree','Hot','Middle','Parallel'],zh:['零','度','热','中间','平行线'],ar:['صفر','درجة','حار','وسط','خط عرض'],es:['Cero','Grado','Caliente','Medio','Paralelo'],fr:['Zéro','Degré','Chaud','Milieu','Parallèle'],de:['Null','Grad','Heiß','Mitte','Breitengrad']}},
  { word:{tr:'Meridyen',en:'Meridian',zh:'经线',ar:'خط الطول',es:'Meridiano',fr:'Méridien',de:'Meridian'},
    forbidden:{tr:['Greenwich','Boylam','Dikey','Harita','Zaman'],en:['Greenwich','Longitude','Vertical','Map','Time'],zh:['格林威治','经度','垂直','地图','时间'],ar:['غرينيتش','خط طول','عمودي','خريطة','وقت'],es:['Greenwich','Longitud','Vertical','Mapa','Tiempo'],fr:['Greenwich','Longitude','Vertical','Carte','Temps'],de:['Greenwich','Längengrad','Vertikal','Karte','Zeit']}},
  { word:{tr:'Ölçek',en:'Scale',zh:'比例尺',ar:'المقياس',es:'Escala',fr:'Échelle',de:'Maßstab'},
    forbidden:{tr:['Harita','Küçültme','Mesafe','Oran','Km'],en:['Map','Reduce','Distance','Ratio','Km'],zh:['地图','缩小','距离','比例','公里'],ar:['خريطة','تصغير','مسافة','نسبة','كم'],es:['Mapa','Reducir','Distancia','Relación','Km'],fr:['Carte','Réduire','Distance','Rapport','Km'],de:['Karte','Verkleinern','Entfernung','Verhältnis','Km']}},
  { word:{tr:'Enlem',en:'Latitude',zh:'纬度',ar:'خط العرض',es:'Latitud',fr:'Latitude',de:'Breitengrad'},
    forbidden:{tr:['Kuzey','Güney','Paralel','Derece','Ekvator'],en:['North','South','Parallel','Degree','Equator'],zh:['北','南','平行线','度','赤道'],ar:['شمال','جنوب','خط عرض','درجة','استواء'],es:['Norte','Sur','Paralelo','Grado','Ecuador'],fr:['Nord','Sud','Parallèle','Degré','Équateur'],de:['Nord','Süd','Breitengrad','Grad','Äquator']}},
  { word:{tr:'Boylam',en:'Longitude',zh:'经度',ar:'خط الطول',es:'Longitud',fr:'Longitude',de:'Längengrad'},
    forbidden:{tr:['Doğu','Batı','Meridyen','Derece','Greenwich'],en:['East','West','Meridian','Degree','Greenwich'],zh:['东','西','经线','度','格林威治'],ar:['شرق','غرب','ميريديان','درجة','غرينيتش'],es:['Este','Oeste','Meridiano','Grado','Greenwich'],fr:['Est','Ouest','Méridien','Degré','Greenwich'],de:['Ost','West','Meridian','Grad','Greenwich']}},
  { word:{tr:'Zaman Dilimi',en:'Time Zone',zh:'时区',ar:'المنطقة الزمنية',es:'Zona Horaria',fr:'Fuseau Horaire',de:'Zeitzone'},
    forbidden:{tr:['Saat','Greenwich','Boylam','Gün','Fark'],en:['Clock','Greenwich','Longitude','Day','Difference'],zh:['时钟','格林威治','经度','日','差异'],ar:['ساعة','غرينيتش','خط طول','يوم','فرق'],es:['Reloj','Greenwich','Longitud','Día','Diferencia'],fr:['Horloge','Greenwich','Longitude','Jour','Différence'],de:['Uhr','Greenwich','Längengrad','Tag','Unterschied']}},
  // ── DOĞAL KAYNAKLAR ──
  { word:{tr:'Petrol',en:'Oil',zh:'石油',ar:'النفط',es:'Petróleo',fr:'Pétrole',de:'Öl'},
    forbidden:{tr:['Enerji','Körfez','Siyah','Kuyu','Yakıt'],en:['Energy','Gulf','Black','Well','Fuel'],zh:['能源','海湾','黑色','油井','燃料'],ar:['طاقة','خليج','أسود','بئر','وقود'],es:['Energía','Golfo','Negro','Pozo','Combustible'],fr:['Énergie','Golfe','Noir','Puits','Carburant'],de:['Energie','Golf','Schwarz','Bohrloch','Kraftstoff']}},
  { word:{tr:'Doğalgaz',en:'Natural Gas',zh:'天然气',ar:'الغاز الطبيعي',es:'Gas Natural',fr:'Gaz Naturel',de:'Erdgas'},
    forbidden:{tr:['Enerji','Petrol','Rusya','Boru','Yakıt'],en:['Energy','Oil','Russia','Pipeline','Fuel'],zh:['能源','石油','俄罗斯','管道','燃料'],ar:['طاقة','نفط','روسيا','أنبوب','وقود'],es:['Energía','Petróleo','Rusia','Tubería','Combustible'],fr:['Énergie','Pétrole','Russie','Pipeline','Carburant'],de:['Energie','Öl','Russland','Pipeline','Kraftstoff']}},
  { word:{tr:'Güneş Enerjisi',en:'Solar Energy',zh:'太阳能',ar:'الطاقة الشمسية',es:'Energía Solar',fr:'Énergie Solaire',de:'Solarenergie'},
    forbidden:{tr:['Güneş','Panel','Yenilenebilir','Elektrik','Işık'],en:['Sun','Panel','Renewable','Electric','Light'],zh:['太阳','面板','可再生','电','光'],ar:['شمس','لوح','متجدد','كهرباء','ضوء'],es:['Sol','Panel','Renovable','Eléctrico','Luz'],fr:['Soleil','Panneau','Renouvelable','Électrique','Lumière'],de:['Sonne','Panel','Erneuerbar','Elektrisch','Licht']}},
  { word:{tr:'Rüzgar Enerjisi',en:'Wind Energy',zh:'风能',ar:'طاقة الرياح',es:'Energía Eólica',fr:'Énergie Éolienne',de:'Windenergie'},
    forbidden:{tr:['Rüzgar','Türbin','Yenilenebilir','Elektrik','Kanat'],en:['Wind','Turbine','Renewable','Electric','Blade'],zh:['风','涡轮','可再生','电','叶片'],ar:['ريح','توربين','متجدد','كهرباء','شفرة'],es:['Viento','Turbina','Renovable','Eléctrico','Pala'],fr:['Vent','Turbine','Renouvelable','Électrique','Pale'],de:['Wind','Turbine','Erneuerbar','Elektrisch','Schaufel']}},
  // ── TARIM & NÜFUS ──
  { word:{tr:'Sulama',en:'Irrigation',zh:'灌溉',ar:'الري',es:'Irrigación',fr:'Irrigation',de:'Bewässerung'},
    forbidden:{tr:['Su','Tarım','Kanal','Çöl','Bitki'],en:['Water','Agriculture','Canal','Desert','Plant'],zh:['水','农业','运河','沙漠','植物'],ar:['ماء','زراعة','قناة','صحراء','نبات'],es:['Agua','Agricultura','Canal','Desierto','Planta'],fr:['Eau','Agriculture','Canal','Désert','Plante'],de:['Wasser','Landwirtschaft','Kanal','Wüste','Pflanze']}},
  { word:{tr:'Erozyon',en:'Erosion',zh:'侵蚀',ar:'التآكل',es:'Erosión',fr:'Érosion',de:'Erosion'},
    forbidden:{tr:['Toprak','Aşınma','Su','Rüzgar','Tarım'],en:['Soil','Wear','Water','Wind','Agriculture'],zh:['土壤','磨损','水','风','农业'],ar:['تربة','تآكل','ماء','ريح','زراعة'],es:['Suelo','Desgaste','Agua','Viento','Agricultura'],fr:['Sol','Usure','Eau','Vent','Agriculture'],de:['Boden','Abnutzung','Wasser','Wind','Landwirtschaft']}},
  { word:{tr:'Orman Kesimi',en:'Deforestation',zh:'森林砍伐',ar:'إزالة الغابات',es:'Deforestación',fr:'Déforestation',de:'Entwaldung'},
    forbidden:{tr:['Ağaç','Amazon','Kesme','Çevre','Ormansızlaşma'],en:['Tree','Amazon','Cut','Environment','Forest'],zh:['树','亚马逊','砍','环境','森林'],ar:['شجرة','الأمازون','قطع','بيئة','غابة'],es:['Árbol','Amazonas','Cortar','Medioambiente','Bosque'],fr:['Arbre','Amazone','Couper','Environnement','Forêt'],de:['Baum','Amazonas','Abholzen','Umwelt','Wald']}},
  { word:{tr:'Çölleşme',en:'Desertification',zh:'沙漠化',ar:'التصحر',es:'Desertificación',fr:'Désertification',de:'Desertifikation'},
    forbidden:{tr:['Çöl','Kuraklık','Toprak','Afrika','İklim'],en:['Desert','Drought','Soil','Africa','Climate'],zh:['沙漠','干旱','土壤','非洲','气候'],ar:['صحراء','جفاف','تربة','أفريقيا','مناخ'],es:['Desierto','Sequía','Suelo','África','Clima'],fr:['Désert','Sécheresse','Sol','Afrique','Climat'],de:['Wüste','Dürre','Boden','Afrika','Klima']}},
  // ── JEOPOLİTİK ──
  { word:{tr:'Sınır',en:'Border',zh:'边界',ar:'الحدود',es:'Frontera',fr:'Frontière',de:'Grenze'},
    forbidden:{tr:['Ülke','Hat','Çizgi','Pasaport','Gümrük'],en:['Country','Line','Boundary','Passport','Customs'],zh:['国家','线','边境','护照','海关'],ar:['بلد','خط','حدود','جواز','جمارك'],es:['País','Línea','Límite','Pasaporte','Aduana'],fr:['Pays','Ligne','Limite','Passeport','Douane'],de:['Land','Linie','Grenze','Reisepass','Zoll']}},
  { word:{tr:'Başkent',en:'Capital',zh:'首都',ar:'العاصمة',es:'Capital',fr:'Capitale',de:'Hauptstadt'},
    forbidden:{tr:['Şehir','Hükümet','Ülke','Merkez','Ankara'],en:['City','Government','Country','Center','Ankara'],zh:['城市','政府','国家','中心','安卡拉'],ar:['مدينة','حكومة','بلد','مركز','أنقرة'],es:['Ciudad','Gobierno','País','Centro','Ankara'],fr:['Ville','Gouvernement','Pays','Centre','Ankara'],de:['Stadt','Regierung','Land','Zentrum','Ankara']}},
  { word:{tr:'Koloni',en:'Colony',zh:'殖民地',ar:'مستعمرة',es:'Colonia',fr:'Colonie',de:'Kolonie'},
    forbidden:{tr:['Sömürge','İngiltere','Afrika','Bağımsızlık','Tarih'],en:['Dependency','Britain','Africa','Independence','History'],zh:['依附','英国','非洲','独立','历史'],ar:['تبعية','بريطانيا','أفريقيا','استقلال','تاريخ'],es:['Dependencia','Reino Unido','África','Independencia','Historia'],fr:['Dépendance','Angleterre','Afrique','Indépendance','Histoire'],de:['Abhängigkeit','Britannien','Afrika','Unabhängigkeit','Geschichte']}},
  { word:{tr:'Kıta',en:'Continent',zh:'大陆',ar:'القارة',es:'Continente',fr:'Continent',de:'Kontinent'},
    forbidden:{tr:['Yedi','Afrika','Avustralya','Kara','Büyük'],en:['Seven','Africa','Australia','Land','Large'],zh:['七','非洲','澳大利亚','陆地','大'],ar:['سبع','أفريقيا','أستراليا','أرض','كبير'],es:['Siete','África','Australia','Tierra','Grande'],fr:['Sept','Afrique','Australie','Terre','Grand'],de:['Sieben','Afrika','Australien','Land','Groß']}},
];

let tabuType = 'country';
let tabuTimerSec = 60;
let tabuPassLimit = -1; // -1 = sınırsız
let tabuGameMode = 'solo';
let tabuRounds = 3;
let tabuCurrentCards = [];
let tabuIndex = 0;
let tabuCorrect = 0;
let tabuPass = 0;
let tabuTabuCount = 0;
let tabuInterval = null;
let tabuTimeLeft = 60;
let tabuTeams = [
  { name: 'Takım 1', score: 0 },
  { name: 'Takım 2', score: 0 }
];
let tabuCurrentTeam = 0;
let tabuCurrentRound = 1;
let tabuTurnCorrect = 0;
let tabuTurnPass = 0;
let tabuTurnTabu = 0;

function setTabuType(type) {
  tabuType = type;
  document.querySelectorAll('.tabu-type-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tabu-type-' + type).classList.add('active');
}

function setTabuMode(mode) {
  tabuGameMode = mode;
  document.querySelectorAll('.tabu-mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tabu-mode-' + mode).classList.add('active');
  document.getElementById('tabu-team-setup').style.display = mode === 'team' ? 'flex' : 'none';
}

function setTabuTimer(sec) {
  tabuTimerSec = sec;
  document.querySelectorAll('#tabu-timer-row .tabu-timer-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.tsec) === sec);
  });
}

function setTabuPassLimit(n) {
  tabuPassLimit = n;
  document.querySelectorAll('#tabu-pass-limit-row .tabu-timer-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.plimit) === n);
  });
}

function setTabuRounds(n) {
  tabuRounds = n;
  document.querySelectorAll('.tabu-rounds-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.rounds) === n);
  });
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startTabu() {
  tabuCurrentCards = shuffleArray(TABU_CARDS[tabuType]);
  tabuIndex = 0;
  if (tabuGameMode === 'team') {
    tabuTeams[0].name = document.getElementById('tabu-team1-name').value.trim() || 'Takım 1';
    tabuTeams[1].name = document.getElementById('tabu-team2-name').value.trim() || 'Takım 2';
    tabuTeams[0].score = 0;
    tabuTeams[1].score = 0;
    tabuCurrentTeam = 0;
    tabuCurrentRound = 1;
    showTabuHandoff();
  } else {
    tabuCorrect = 0; tabuPass = 0; tabuTabuCount = 0;
    startTabuTurn();
  }
}

function showTabuHandoff() {
  document.getElementById('tabu-start-screen').style.display = 'none';
  document.getElementById('tabu-game-screen').style.display = 'none';
  document.getElementById('tabu-end-screen').style.display = 'none';
  document.getElementById('tabu-handoff-screen').style.display = 'flex';
  const team = tabuTeams[tabuCurrentTeam];
  const roundTxt = (t('tabu_round') || 'TUR') + ' ' + tabuCurrentRound + ' / ' + tabuRounds;
  document.getElementById('tabu-handoff-title').textContent = team.name + ' — ' + roundTxt;
  document.getElementById('tabu-handoff-scores').innerHTML = tabuTeams.map((tm, i) =>
    '<div class="tabu-handoff-score-row' + (i === tabuCurrentTeam ? ' active-team' : '') + '">' +
    '<span class="tabu-handoff-team-name">' + tm.name + '</span>' +
    '<span class="tabu-handoff-team-score">' + tm.score + '</span></div>'
  ).join('');
}

function startTabuTurn() {
  tabuTurnCorrect = 0; tabuTurnPass = 0; tabuTurnTabu = 0;
  tabuTimeLeft = tabuTimerSec;
  document.getElementById('tabu-handoff-screen').style.display = 'none';
  document.getElementById('tabu-start-screen').style.display = 'none';
  document.getElementById('tabu-end-screen').style.display = 'none';
  document.getElementById('tabu-game-screen').style.display = 'flex';
  const indicator = document.getElementById('tabu-team-indicator');
  if (tabuGameMode === 'team') {
    indicator.style.display = 'flex';
    document.getElementById('tabu-active-team-name').textContent = tabuTeams[tabuCurrentTeam].name;
    document.getElementById('tabu-round-info').textContent =
      (t('tabu_round') || 'TUR') + ' ' + tabuCurrentRound + ' / ' + tabuRounds;
  } else {
    indicator.style.display = 'none';
  }
  document.getElementById('tabu-correct-count').textContent = '0';
  document.getElementById('tabu-pass-count').textContent = '0';
  document.getElementById('tabu-timer-display').textContent = tabuTimeLeft;
  document.getElementById('tabu-timer-display').classList.remove('warning');
  updateTabuPassButtonState();
  renderTabuCard();
  startTabuTimer();
}

function updateTabuPassButtonState() {
  const btn = document.getElementById('tabu-btn-pass');
  const remainingEl = document.getElementById('tabu-pass-remaining');
  if (tabuPassLimit === -1) {
    remainingEl.textContent = '';
    btn.disabled = false;
  } else {
    const remaining = Math.max(0, tabuPassLimit - tabuTurnPass);
    remainingEl.textContent = '(' + remaining + ')';
    btn.disabled = remaining <= 0;
  }
}

function renderTabuCard() {
  if (tabuIndex >= tabuCurrentCards.length) {
    tabuCurrentCards = shuffleArray(TABU_CARDS[tabuType]);
    tabuIndex = 0;
  }
  const card = tabuCurrentCards[tabuIndex];
  const lang = currentLang || 'tr';
  const word = card.word[lang] || card.word['tr'];
  const forbidden = card.forbidden[lang] || card.forbidden['tr'];
  document.getElementById('tabu-card-word').textContent = word;
  const list = document.getElementById('tabu-forbidden-list');
  list.innerHTML = '';
  forbidden.forEach(w => { const li = document.createElement('li'); li.textContent = w; list.appendChild(li); });
}

function startTabuTimer() {
  clearInterval(tabuInterval);
  tabuInterval = setInterval(() => {
    tabuTimeLeft--;
    document.getElementById('tabu-timer-display').textContent = tabuTimeLeft;
    if (tabuTimeLeft <= 10) document.getElementById('tabu-timer-display').classList.add('warning');
    if (tabuTimeLeft <= 0) { clearInterval(tabuInterval); endTabuTurn(); }
  }, 1000);
}

function tabuAction(action) {
  if (tabuTimeLeft <= 0) return;
  if (action === 'correct') { tabuTurnCorrect++; document.getElementById('tabu-correct-count').textContent = tabuTurnCorrect; }
  else if (action === 'pass') {
    if (tabuPassLimit !== -1 && tabuTurnPass >= tabuPassLimit) return;
    tabuTurnPass++;
    document.getElementById('tabu-pass-count').textContent = tabuTurnPass;
    updateTabuPassButtonState();
  }
  else if (action === 'tabu') { tabuTurnTabu++; }
  tabuIndex++;
  renderTabuCard();
}

function endTabuTurn() {
  clearInterval(tabuInterval);
  if (tabuGameMode === 'solo') {
    tabuCorrect = tabuTurnCorrect; tabuPass = tabuTurnPass; tabuTabuCount = tabuTurnTabu;
    showTabuEnd(); return;
  }
  const gained = Math.max(0, tabuTurnCorrect - tabuTurnTabu);
  tabuTeams[tabuCurrentTeam].score += gained;
  if (tabuCurrentTeam === 0) {
    tabuCurrentTeam = 1;
    showTabuHandoff();
  } else {
    tabuCurrentTeam = 0;
    tabuCurrentRound++;
    if (tabuCurrentRound > tabuRounds) showTabuEnd();
    else showTabuHandoff();
  }
}

function showTabuEnd() {
  document.getElementById('tabu-game-screen').style.display = 'none';
  document.getElementById('tabu-handoff-screen').style.display = 'none';
  document.getElementById('tabu-end-screen').style.display = 'flex';
  if (tabuGameMode === 'solo') {
    document.getElementById('tabu-end-title').textContent = t('tabu_end_title') || '⏱ SÜRE DOLDU!';
    document.getElementById('tabu-end-solo-stats').style.display = 'flex';
    document.getElementById('tabu-end-team-stats').style.display = 'none';
    document.getElementById('tabu-end-correct').textContent = tabuCorrect;
    document.getElementById('tabu-end-pass').textContent = tabuPass;
    document.getElementById('tabu-end-tabu').textContent = tabuTabuCount;
  } else {
    document.getElementById('tabu-end-title').textContent = t('tabu_game_over') || '🏆 OYUN BİTTİ!';
    document.getElementById('tabu-end-solo-stats').style.display = 'none';
    document.getElementById('tabu-end-team-stats').style.display = 'flex';
    const maxScore = Math.max(...tabuTeams.map(tm => tm.score));
    const winners = tabuTeams.filter(tm => tm.score === maxScore);
    const isTie = winners.length > 1;
    document.getElementById('tabu-winner-banner').textContent =
      isTie ? (t('tabu_tie') || '🤝 BERABERE!') : ('🏆 ' + winners[0].name + ' ' + (t('tabu_wins') || 'KAZANDI!'));
    const sorted = [...tabuTeams].sort((a, b) => b.score - a.score);
    document.getElementById('tabu-scoreboard').innerHTML = sorted.map((tm, i) =>
      '<div class="tabu-sb-row' + (i === 0 && !isTie ? ' winner' : '') + '">' +
      '<span class="tabu-sb-crown">' + (i === 0 && !isTie ? '👑' : '') + '</span>' +
      '<span class="tabu-sb-team">' + tm.name + '</span>' +
      '<span class="tabu-sb-score">' + tm.score + '</span></div>'
    ).join('');
  }
}

function restartTabu() {
  tabuCurrentCards = shuffleArray(TABU_CARDS[tabuType]);
  tabuIndex = 0;
  if (tabuGameMode === 'team') {
    tabuTeams[0].score = 0; tabuTeams[1].score = 0;
    tabuCurrentTeam = 0; tabuCurrentRound = 1;
    showTabuHandoff();
  } else {
    tabuCorrect = 0; tabuPass = 0; tabuTabuCount = 0;
    startTabuTurn();
  }
}

function backToTabuStart() {
  clearInterval(tabuInterval);
  document.getElementById('tabu-end-screen').style.display = 'none';
  document.getElementById('tabu-game-screen').style.display = 'none';
  document.getElementById('tabu-handoff-screen').style.display = 'none';
  document.getElementById('tabu-start-screen').style.display = 'flex';
}

function initTabuMode() {
  clearInterval(tabuInterval);
  document.getElementById('tabu-start-screen').style.display = 'flex';
  document.getElementById('tabu-game-screen').style.display = 'none';
  document.getElementById('tabu-handoff-screen').style.display = 'none';
  document.getElementById('tabu-end-screen').style.display = 'none';
}


// ══════════════════════════════════════════════
// Bayrak renk veritabanı
/* -> moved to data.js / translations.js */


// Kıta adları
/* -> moved to data.js / translations.js */


function getContinent(id) {
  for (const [cont, ids] of Object.entries(REGIONS)) {
    if (cont === 'all') continue;
    if (ids.includes(+id)) return cont;
  }
  return null;
}

function getFlagColors(id) {
  const colors = FLAG_COLORS[+id];
  if (!colors) return '?';
  const colorMap = {
    'Kırmızı':  {en:'Red',      zh:'红色',   ar:'أحمر',     es:'Rojo',     fr:'Rouge',  de:'Rot'},
    'Mavi':     {en:'Blue',     zh:'蓝色',   ar:'أزرق',     es:'Azul',     fr:'Bleu',   de:'Blau'},
    'Yeşil':    {en:'Green',    zh:'绿色',   ar:'أخضر',     es:'Verde',    fr:'Vert',   de:'Grün'},
    'Sarı':     {en:'Yellow',   zh:'黄色',   ar:'أصفر',     es:'Amarillo', fr:'Jaune',  de:'Gelb'},
    'Beyaz':    {en:'White',    zh:'白色',   ar:'أبيض',     es:'Blanco',   fr:'Blanc',  de:'Weiß'},
    'Siyah':    {en:'Black',    zh:'黑色',   ar:'أسود',     es:'Negro',    fr:'Noir',   de:'Schwarz'},
    'Turuncu':  {en:'Orange',   zh:'橙色',   ar:'برتقالي',  es:'Naranja',  fr:'Orange', de:'Orange'},
    'Bordo':    {en:'Maroon',   zh:'深红色', ar:'كستنائي',  es:'Granate',  fr:'Bordeaux',de:'Weinrot'},
    'Açık Mavi':{en:'Light Blue',zh:'浅蓝色',ar:'أزرق فاتح',es:'Azul Claro',fr:'Bleu Ciel',de:'Hellblau'}
  };
  const lang = (typeof currentLang !== 'undefined' ? currentLang : 'tr');
  return colors.slice(0, 2).map(c => {
    if (lang === 'tr') return c;
    return (colorMap[c] && colorMap[c][lang]) ? colorMap[c][lang] : c;
  }).join(', ');
}

// ══════════════════════════════════════════════
// ÖZEL TABU (TABU2) MODU
// ══════════════════════════════════════════════

// Zorluk seviyelerine göre ülke ID listeleri
const T2_COUNTRIES = {
  easy: [792,840,826,250,276,380,724,380,392,156,356,76,32,124,36,484,528,756,752,578,208,246,620,642,191,203,348,616,804,710,818,682,784,792,400,376,364,368,760,586,566,404,288,504,800,634,608,360,458,764,704,410,408,372,300],
  medium: [12,24,50,56,64,68,100,108,116,120,132,140,144,152,170,178,188,196,204,212,214,222,226,231,232,233,242,262,266,270,304,308,320,324,328,332,340,388,398,414,417,418,422,430,434,438,440,462,466,470,478,480,496,498,499,508,512,516,524,540,554,558,562,578,591,598,600,604,630,646,686,688,703,705,716,728,729,740,748,762,768,776,780,795,798,807,834,854,858,860,862,882,887,894],
  hard: [4,8,20,28,48,52,84,96,104,132,148,174,182,218,246,275,296,384,408,426,434,438,454,462,496,540,548,578,591,598,626,678,694,706,716,728,740,776,798,807,834,882,887,894,670,662,659,28,52,780,296,798,548,583,585,626,70,499,383,807]
};

// State
let t2GameMode = 'solo'; // 'solo' | 'duo'
let t2Difficulty = 'easy';
let t2QuestionCount = 5;
let t2Players = [{name:'Oyuncu 1', score:0}, {name:'Oyuncu 2', score:0}];
let t2Questions = [];
let t2CurrentQ = 0;
let t2CurrentGuesser = 0;
let t2Answered = false;
let t2Results = []; // {correct, partial, wrong}

function setT2Mode(mode) {
  t2GameMode = mode;
  document.querySelectorAll('.t2-mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('t2-mode-' + mode).classList.add('active');
  document.getElementById('t2-solo-setup').style.display = mode === 'solo' ? 'flex' : 'none';
  document.getElementById('t2-duo-setup').style.display = mode === 'duo' ? 'flex' : 'none';
}

function setT2Diff(diff) {
  t2Difficulty = diff;
  document.querySelectorAll('.t2-diff-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.t2-diff-btn[data-diff="${diff}"]`).forEach(b => b.classList.add('active'));
}

function setT2Count(n) {
  t2QuestionCount = n;
  document.querySelectorAll('.t2-cnt-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.t2-cnt-btn[data-cnt="${n}"]`).classList.add('active');
}

function startT2Game() {
  // İsim al
  if (t2GameMode === 'solo') {
    t2Players = [{name: document.getElementById('t2-solo-name').value.trim() || 'Oyuncu', score: 0}];
  } else {
    t2Players = [
      {name: document.getElementById('t2-p1-name').value.trim() || 'Oyuncu 1', score: 0},
      {name: document.getElementById('t2-p2-name').value.trim() || 'Oyuncu 2', score: 0}
    ];
  }

  // Rastgele ülkeler seç
  const pool = [...(T2_COUNTRIES[t2Difficulty] || T2_COUNTRIES.easy)];
  const shuffled = shuffleArray(pool);
  const count = t2GameMode === 'duo' ? 5 : t2QuestionCount;
  const selected = shuffled.slice(0, count);

  if (t2GameMode === 'duo') {
    // Duo: 5 soru oyuncu 2'ye (p1 seçti gibi), 5 soru oyuncu 1'e
    const set1 = shuffled.slice(0, 5).map(id => ({id, owner: 0}));
    const set2 = shuffled.slice(5, 10).map(id => ({id, owner: 1}));
    t2Questions = [...set1, ...set2];
  } else {
    t2Questions = selected.map(id => ({id, owner: -1}));
  }

  t2CurrentQ = 0;
  t2CurrentGuesser = 0;
  t2Results = [];

  document.getElementById('t2-setup-screen').style.display = 'none';
  document.getElementById('t2-end-screen').style.display = 'none';

  // Duo modunda p2 score box göster, solo'da gizle
  document.getElementById('t2-p2-score-box').style.display = t2GameMode === 'duo' ? 'flex' : 'none';

  t2LoadQuestion();
}

function t2LoadQuestion() {
  if (t2CurrentQ >= t2Questions.length) { t2ShowEnd(); return; }

  const q = t2Questions[t2CurrentQ];
  t2Answered = false;

  // Duo: guesser = rakip
  if (t2GameMode === 'duo') t2CurrentGuesser = 1 - q.owner;
  else t2CurrentGuesser = 0;

  document.getElementById('t2-guess-screen').style.display = 'flex';

  // Skorlar
  document.getElementById('t2-p1-score').textContent = t2Players[0].score;
  document.getElementById('t2-p1-score-lbl').textContent = t2Players[0].name;
  if (t2GameMode === 'duo') {
    document.getElementById('t2-p2-score').textContent = t2Players[1].score;
    document.getElementById('t2-p2-score-lbl').textContent = t2Players[1].name;
  }

  document.getElementById('t2-question-num').textContent = `${t2CurrentQ + 1} / ${t2Questions.length}`;
  document.getElementById('t2-guesser-label').textContent =
    t2GameMode === 'duo' ? `${t2Players[t2CurrentGuesser].name} ${t('t2_guessing')||'TAHMİN EDİYOR'}` : '';

  // İpuçları
  const id = q.id;
  const cont = getContinent(id);
  const lang = currentLang || 'tr';
  const contNames = CONTINENT_NAMES[lang] || CONTINENT_NAMES.tr;
  document.getElementById('t2-clue-continent').textContent = cont ? (contNames[cont] || cont) : '?';
  document.getElementById('t2-clue-colors').textContent = getFlagColors(id);

  // Zorluk: kolay=ilk+son+uzunluk, orta=ilk+son, zor=sadece uzunluk
  const name = getCountryName(id) || '';
  const harfLabel = t('hint_letters') || 'harf';
  let hint = '';
  if (t2Difficulty === 'easy') {
    hint = name[0] + ' ' + '_ '.repeat(Math.max(1, name.length - 2)).trim() + ' ' + name[name.length - 1] + ` (${name.length} ${harfLabel})`;
  } else if (t2Difficulty === 'medium') {
    hint = name[0] + ' ' + '_ '.repeat(Math.max(1, name.length - 2)).trim() + ' ' + name[name.length - 1];
  } else {
    hint = `${name.length} ${harfLabel}`;
  }
  document.getElementById('t2-clue-hint').textContent = hint;

  document.getElementById('t2-guess-input').value = '';
  document.getElementById('t2-guess-input').disabled = false;
  document.getElementById('t2-guess-feedback').style.display = 'none';
  document.getElementById('t2-next-btn').style.display = 'none';
  setTimeout(() => document.getElementById('t2-guess-input').focus(), 100);
}

function t2Submit() {
  if (t2Answered) return;
  const val = document.getElementById('t2-guess-input').value.trim();
  if (!val) return;

  const q = t2Questions[t2CurrentQ];
  const correctName = getCountryName(q.id) || '';
  const feedbackEl = document.getElementById('t2-guess-feedback');
  t2Answered = true;

  let pts = 0;
  let cls = '';
  let msg = '';

  if (isMatch(val, correctName)) {
    pts = 5; cls = 'correct';
    msg = `✅ DOĞRU! +5 puan`;
    t2Results.push('correct');
  } else {
    const guessedId = findCountryIdByName(val);
    if (guessedId && partialMatch(+guessedId, +q.id)) {
      pts = 2; cls = 'partial';
      msg = `🟡 YAKIN! +2 puan — Doğrusu: ${getFlagImgHtml(q.id, 20, true)} ${correctName}`;
      t2Results.push('partial');
    } else {
      pts = 0; cls = 'wrong';
      msg = `❌ YANLIŞ — Doğrusu: ${getFlagImgHtml(q.id, 20, true)} ${correctName}`;
      t2Results.push('wrong');
    }
  }

  t2Players[t2CurrentGuesser].score += pts;
  feedbackEl.className = cls;
  feedbackEl.innerHTML = msg;
  feedbackEl.style.display = 'block';
  document.getElementById('t2-guess-input').disabled = true;
  document.getElementById('t2-next-btn').style.display = 'block';

  // Skorları güncelle
  document.getElementById('t2-p1-score').textContent = t2Players[0].score;
  if (t2GameMode === 'duo') document.getElementById('t2-p2-score').textContent = t2Players[1].score;
}

function t2Next() { t2CurrentQ++; t2LoadQuestion(); }

function findCountryIdByName(val) {
  const matches = getMatches(val);
  return matches.length > 0 ? matches[0][0] : null;
}

function partialMatch(guessedId, correctId) {
  const gc = getContinent(guessedId), cc = getContinent(correctId);
  if (gc && cc && gc === cc) return true;
  const gc2 = FLAG_COLORS[guessedId] || [], cc2 = FLAG_COLORS[correctId] || [];
  return gc2.filter(c => cc2.includes(c)).length >= 1;
}

function t2ShowEnd() {
  document.getElementById('t2-guess-screen').style.display = 'none';
  document.getElementById('t2-end-screen').style.display = 'flex';

  const diffLabel = {easy: t('t2_diff_easy')||'🟢 KOLAY', medium: t('t2_diff_medium')||'🟡 ORTA', hard: t('t2_diff_hard')||'🔴 ZOR'}[t2Difficulty];
  const maxPts = t2Questions.length * 5;

  if (t2GameMode === 'solo') {
    const p = t2Players[0];
    const correct = t2Results.filter(r => r === 'correct').length;
    const partial = t2Results.filter(r => r === 'partial').length;
    const wrong = t2Results.filter(r => r === 'wrong').length;
    document.getElementById('t2-end-title').textContent = t('t2_end_title') || '🏆 TAMAMLANDI!';
    document.getElementById('t2-end-winner').textContent =
      `${p.name} — ${p.score} / ${maxPts} ${t('t2_points')||'puan'}`;
    document.getElementById('t2-end-scores').innerHTML = `
      <div class="t2-end-row"><span class="t2-end-name">✅ ${t('t2_correct')||'Doğru'}</span><span class="t2-end-pts" style="color:#44ff88">${correct}</span></div>
      <div class="t2-end-row"><span class="t2-end-name">🟡 ${t('t2_partial')||'Yakın'}</span><span class="t2-end-pts" style="color:#ffcc00">${partial}</span></div>
      <div class="t2-end-row"><span class="t2-end-name">❌ ${t('t2_wrong')||'Yanlış'}</span><span class="t2-end-pts" style="color:#ff4444">${wrong}</span></div>
      <div class="t2-end-row"><span class="t2-end-name">${diffLabel}</span><span class="t2-end-pts">${p.score}/${maxPts}</span></div>
    `;
    document.getElementById('t2-share-btn').style.display = 'block';
    document.getElementById('t2-lb-btn').style.display = 'block';
    window._t2ShareData = {name: p.name, score: p.score, maxPts, correct, partial, wrong, diff: diffLabel, count: t2Questions.length};
  } else {
    const p1 = t2Players[0], p2 = t2Players[1];
    const isTie = p1.score === p2.score;
    const winner = p1.score > p2.score ? p1 : p2;
    document.getElementById('t2-end-title').textContent = t('t2_end_title') || '🏆 OYUN BİTTİ!';
    document.getElementById('t2-end-winner').textContent = isTie ? `🤝 ${t('t2_tie')||'BERABERE!'}` : `🥇 ${winner.name} ${t('t2_wins')||'KAZANDI!'}`;
    const sorted = [...t2Players].sort((a, b) => b.score - a.score);
    document.getElementById('t2-end-scores').innerHTML = sorted.map((p, i) =>
      `<div class="t2-end-row ${i===0&&!isTie?'winner':''}">
        <span class="t2-end-name">${i===0&&!isTie?'👑 ':''}${p.name}</span>
        <span class="t2-end-pts">${p.score} pt</span>
      </div>`
    ).join('');
    document.getElementById('t2-share-btn').style.display = 'none';
    document.getElementById('t2-lb-btn').style.display = 'none';
  }
}

function shareT2Result() {
  const d = window._t2ShareData;
  if (!d) return;
  const text = `🗺 ÖZEL TABU — thegeographers\n${d.diff} · ${d.count} soru\n\n✅ ${d.correct} Doğru · 🟡 ${d.partial} Yakın · ❌ ${d.wrong} Yanlış\n🏆 ${d.score} / ${d.maxPts} puan\n\nthegeographers.com`;
  if (navigator.share) {
    navigator.share({text});
  } else {
    navigator.clipboard.writeText(text).then(() => alert('Kopyalandı!'));
  }
}

function initT2Mode() {
  t2GameMode = 'solo';
  t2Difficulty = 'easy';
  t2QuestionCount = 5;
  t2Players = [{name:'Oyuncu 1', score:0}];
  t2Questions = [];
  t2CurrentQ = 0;
  t2Results = [];
  document.getElementById('t2-setup-screen').style.display = 'flex';
  document.getElementById('t2-guess-screen').style.display = 'none';
  document.getElementById('t2-end-screen').style.display = 'none';
  // Reset UI
  document.querySelectorAll('.t2-mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('t2-mode-solo').classList.add('active');
  document.getElementById('t2-solo-setup').style.display = 'flex';
  document.getElementById('t2-duo-setup').style.display = 'none';
  document.querySelectorAll('.t2-diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === 'easy'));
  const cnt5 = document.querySelector('.t2-cnt-btn[data-cnt="5"]');
  if (cnt5) { document.querySelectorAll('.t2-cnt-btn').forEach(b => b.classList.remove('active')); cnt5.classList.add('active'); }
  applyLang();
}

// ════════════════════════════════════════════
// COĞRAFYADERSİ MODU — Harita Galerisi
// ════════════════════════════════════════════

// SVG renk paleti

// Gerçek harita görselleri (base64 gömülü)
const CG_MAP_WORLD = 'data:image/jpeg;base64,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';

/* -> moved to data.js / translations.js */



/* -> moved to data.js / translations.js */


let cgCurrentCat = 'all';

function initCografyaMode() {
  cgRender();
}


function cgSetCat(cat) {
  cgCurrentCat = cat;
  document.querySelectorAll('.cg-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  cgRender();
}
function cgFilter() { cgRender(); }

function cgRender() {
  const q = (document.getElementById('cografya-search').value || '').toLowerCase().trim();
  const grid = document.getElementById('cografya-grid');
  const empty = document.getElementById('cg-empty');
  let maps = CG_MAPS;
  if (cgCurrentCat !== 'all') maps = maps.filter(m => m.cat === cgCurrentCat);
  if (q) maps = maps.filter(m =>
    m.title.toLowerCase().includes(q) ||
    m.desc.toLowerCase().includes(q) ||
    m.tags.some(t => t.toLowerCase().includes(q))
  );
  if (maps.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const catLabel = {
    siyasi:  t('cg_cat_siyasi')||'SİYASİ',
    fiziki:  t('cg_cat_fiziki')||'FİZİKİ',
    iklim:   t('cg_cat_iklim')||'İKLİM',
    nufus:   t('cg_cat_nufus')||'NÜFUS',
    ekonomi: t('cg_cat_ekonomi')||'EKONOMİ',
    dogal:   t('cg_cat_dogal')||'AFET',
    turkiye: t('cg_cat_turkiye')||'TÜRKİYE'
  };
  const icons    = { siyasi:'🗺️', fiziki:'🏔️', iklim:'🌤️', nufus:'👥', ekonomi:'📊', dogal:'⚠️', turkiye:'🇹🇷' };

  // Her kategori için güzel gradyan + sembol
  const thumbStyle = {
    siyasi:  { grad:'linear-gradient(135deg,#0d2137 0%,#1a4a6b 50%,#0d3320 100%)', emoji:'🗺️', label:'#5dade2' },
    fiziki:  { grad:'linear-gradient(135deg,#0d2b0d 0%,#1e6b1e 40%,#784212 100%)', emoji:'🏔️', label:'#58d68d' },
    iklim:   { grad:'linear-gradient(135deg,#1a0a2e 0%,#6c3483 50%,#1a4a6b 100%)', emoji:'🌤️', label:'#a569bd' },
    nufus:   { grad:'linear-gradient(135deg,#2e1a0a 0%,#935116 50%,#1a1a2e 100%)', emoji:'👥', label:'#e59866' },
    ekonomi: { grad:'linear-gradient(135deg,#1a1a0d 0%,#7d6608 50%,#2e1a0a 100%)', emoji:'📊', label:'#f4d03f' },
    dogal:   { grad:'linear-gradient(135deg,#2e0d0d 0%,#922b21 50%,#1a0a0a 100%)', emoji:'⚠️', label:'#ec7063' },
    turkiye: { grad:'linear-gradient(135deg,#2e0a12 0%,#c0392b 40%,#1a1a0d 100%)', emoji:'🇹🇷', label:'#f1948a' },
  };

  grid.innerHTML = maps.map(m => {
    const c  = CG_COLORS[m.cat]   || CG_COLORS.siyasi;
    const ts = thumbStyle[m.cat]  || thumbStyle.siyasi;
    return `<div class="cg-map-card" onclick="cgOpenModal(${m.id})">
      <div class="cg-map-thumb" style="background:${c.bg};aspect-ratio:3/2;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">
        <div style="position:absolute;inset:0;background:${ts.grad};opacity:0.9;"></div>
        <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="font-size:26px;line-height:1;">${ts.emoji}</div>
          <div style="font-family:'Space Mono',monospace;font-size:6px;letter-spacing:1.5px;color:${ts.label};text-transform:uppercase;text-align:center;padding:0 8px;">${t('cg_map_'+m.id+'_title') || m.title}</div>
        </div>
        <div class="cg-card-badge" style="color:${c.text};">${icons[m.cat]||''} ${catLabel[m.cat]||''}</div>
      </div>
      <div class="cg-card-body">
        <div class="cg-card-title">${t('cg_map_'+m.id+'_title') || m.title}</div>
        <div class="cg-card-desc">${(t('cg_map_'+m.id+'_desc') || m.desc).substring(0,52)}…</div>
      </div>
    </div>`;
  }).join('');
}

function cgOpenModal(id) {
  // Siyasi haritalar → interaktif D3 harita
  const POLITICAL_MAP_CONFIGS = {
    1:  { title:'🗺️ DÜNYA SİYASİ HARİTASI',    region: null,   mode: 'political' },
    2:  { title:'🗺️ AVRUPA SİYASİ HARİTASI',   region: 'europe',      mode: 'political' },
    3:  { title:'🗺️ ASYA SİYASİ HARİTASI',     region: 'asia',        mode: 'political' },
    4:  { title:'🗺️ AFRİKA SİYASİ HARİTASI',   region: 'africa',      mode: 'political' },
    5:  { title:'🗺️ AMERİKA SİYASİ HARİTASI',  region: 'americas',    mode: 'political' },
    6:  { title:'🗺️ ORTA DOĞU SİYASİ HARİTASI',region: 'middleeast',  mode: 'political' },
    12: { title:'🌡️ KÖPPEN İKLİM SINIFLANDIRMASI', region: null, mode: 'koppen' },
    13: { title:'🌧️ DÜNYA YAĞIŞ HARİTASI',         region: null, mode: 'rainfall' },
    14: { title:'🌡️ DÜNYA SICAKLIK HARİTASI',       region: null, mode: 'temperature' },
    15: { title:'⚠️ ÇÖLLEŞme RİSK HARİTASI',      region: null, mode: 'desertification' },
    16: { title:'👥 DÜNYA NÜFUS YOĞUNLUĞU',        region: null, mode: 'population' },
    19: { title:'💰 DÜNYA GSYİH HARİTASI', region: null, mode: 'gdp' },
    20: { title:'📊 İNSANİ GELİŞME ENDEKSİ', region: null, mode: 'hdi' },
    21: { title:'🚢 DÜNYA TİCARET YOLLARI', region: null, mode: 'trade' },
    22: { title:'🛢️ DÜNYA PETROL REZERVLERİ', region: null, mode: 'oil' },
    23: { title:'🌍 DÜNYA DEPREM BÖLGELERİ', region: null, mode: 'earthquake' },
    24: { title:'🌋 AKTİF VOLKANLAR HARİTASI', region: null, mode: 'volcano' },
    25: { title:'🌊 SEL VE TAŞKIN RİSK HARİTASI', region: null, mode: 'flood' },
    26: { title:'🇹🇷 TÜRKİYE SİYASİ HARİTASI',   region: 'turkey', mode: 'turkey_political' },
    27: { title:'🗺️ TÜRKİYE COĞRAFİ BÖLGELERİ',  region: 'turkey', mode: 'turkey_regions' },
    29: { title:'⚠️ TÜRKİYE DEPREM HARİTASI',     region: 'turkey', mode: 'turkey_quake' },
    17: { title:'👥 DÜNYA NÜFUS MİKTARI',           region: null, mode: 'popcount' },
    18: { title:'📈 DÜNYA NÜFUS ARTIŞ HIZI',        region: null, mode: 'popgrowth' },
  };

  if (POLITICAL_MAP_CONFIGS[id]) {
    const cfg = POLITICAL_MAP_CONFIGS[id];
    const titleKey = 'cg_map_' + id + '_title';
    const translatedTitle = t(titleKey);
    const icon = cfg.title.split(' ')[0]; // emoji
    document.getElementById('cg-imap-title-text').textContent = translatedTitle ? (icon + ' ' + translatedTitle) : cfg.title;
    cgOpenInteractiveMap(cfg.region, cfg.mode);
    return;
  }

  const m = CG_MAPS.find(x => x.id === id);
  if (!m) return;
  const c = CG_COLORS[m.cat] || CG_COLORS.siyasi;
  const icons = { siyasi:'🗺️', fiziki:'🏔️', iklim:'🌤️', nufus:'👥', ekonomi:'📊', dogal:'⚠️', turkiye:'🇹🇷' };
  const catLabel = {
    siyasi:  t('cg_cat_siyasi')||'SİYASİ',
    fiziki:  t('cg_cat_fiziki')||'FİZİKİ',
    iklim:   t('cg_cat_iklim')||'İKLİM',
    nufus:   t('cg_cat_nufus')||'NÜFUS',
    ekonomi: t('cg_cat_ekonomi')||'EKONOMİ',
    dogal:   t('cg_cat_dogal')||'DOĞAL AFET',
    turkiye: t('cg_cat_turkiye')||'TÜRKİYE'
  };
  const svgWrap = document.getElementById('cg-modal-svg-wrap');
  svgWrap.style.background = c.bg;

  const pat = cgGetPattern(m.id);
  // Gerçek harita görseli mi, SVG mi?
  const useRealImg = [1,5,7,8,9,10,12,13,14,15,16,17,19,20,21,23,24].includes(m.id);
  if (useRealImg) {
    svgWrap.innerHTML = `<img src='${CG_MAP_WORLD}' alt='${m.title}' style='width:100%;display:block;object-fit:cover;max-height:220px;'>`;
  } else {
    const svgContent = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 133' style='width:100%;display:block;'>${pat}<text x='100' y='129' text-anchor='middle' font-family='monospace' font-size='6' fill='${c.text}' opacity='0.5' letter-spacing='2'>${m.title.toUpperCase()}</text></svg>`;
    svgWrap.innerHTML = svgContent;
  }

  const titleEl = document.getElementById('cg-modal-map-title');
  titleEl.textContent = `${icons[m.cat]||''} ${(typeof t === 'function' ? t('cg_map_'+m.id+'_title') : null) || m.title}`;
  titleEl.style.color = c.text;
  document.getElementById('cg-modal-map-body').textContent = (typeof t === 'function' ? t('cg_map_'+m.id+'_desc') : null) || m.desc;
  document.getElementById('cg-modal-tags').innerHTML =
    `<span class="cg-modal-tag" style="border-color:${c.border};color:${c.text}">${catLabel[m.cat]||m.cat}</span>` +
    m.tags.map(t => `<span class="cg-modal-tag">${t}</span>`).join('');
  document.getElementById('cg-modal').classList.add('open');
  document.getElementById('cg-modal-scroll').scrollTop = 0;
  cgZoomReset();
  setTimeout(cgInitZoom, 50);
}

// ══════════════════════════════════════════════
// COĞRAFYADERSİ — İNTERAKTİF SİYASİ HARİTA
// ══════════════════════════════════════════════

/* -> moved to data.js / translations.js */


let cgiSelectedColor = CGI_PALETTE[0].color;
let cgiCountryColors  = {};  // id → renk
let cgiSvg, cgiG, cgiPath, cgiZoom, cgiProjection;
let cgiBaseStroke = 0.3;
let cgiInited = false;

// Kıta bounding box'ları [lonMin, latMin, lonMax, latMax]
/* -> moved to data.js / translations.js */


function cgOpenInteractiveMap(region, mode) {
  const wrap = document.getElementById('cg-interactive-map-wrap');
  wrap.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(() => applyLang(), 50);

  const newMode = mode || 'political';
  const newRegion = region || 'world';

  if (cgiInited && (cgiCurrentRegion !== newRegion || cgiCurrentMode !== newMode)) {
    cgiInited = false;
    if (cgiG) { cgiG.remove(); cgiG = null; }
    cgiSvg.selectAll('.cgi-label-layer').remove();
    window._cgiLabelData = [];
    window._cgiRedrawLabels = null;
    cgiCountryColors = {};
    if (cgiSvg) cgiSvg.on('.zoom', null);
  }

  cgiCurrentRegion = newRegion;
  cgiCurrentMode = newMode;

  // Lejant ve Köppen uyarısını temizle
  document.getElementById('cg-pop-legend')?.remove();
  document.getElementById('cg-koppen-disc')?.remove();

  if (!cgiInited) {
    cgiInited = true;
    cgiBuildMap(region, newMode);
  } else {
    cgiShowLegend(newMode);
  }
}

function cgiShowLegend(mode) {
  const isPopulation  = mode === 'population';
  const isPopCount    = mode === 'popcount';
  const isPopGrowth   = mode === 'popgrowth';
  const isTemperature = mode === 'temperature';
  const isRainfall    = mode === 'rainfall';
  const isDesertification = mode === 'desertification';
  const isGdp         = mode === 'gdp';
  const isOil         = mode === 'oil';
  const isHdi         = mode === 'hdi';
  const isTrade       = mode === 'trade';
  const isEarthquake  = mode === 'earthquake';
  const isVolcano     = mode === 'volcano';
  const isFlood       = mode === 'flood';
  const isTurkeyPolitical = mode === 'turkey_political';
  const isTurkeyRegions   = mode === 'turkey_regions';
  const isTurkeyQuake     = mode === 'turkey_quake';
  const isKoppen      = mode === 'koppen';
  const isPopMap = isPopulation || isPopCount || isPopGrowth || isTemperature || isRainfall || isDesertification || isGdp || isOil || isHdi || isTrade || isEarthquake || isVolcano || isFlood || isTurkeyPolitical || isTurkeyRegions || isTurkeyQuake;

  if (!isPopMap && !isKoppen) return;

  // Mevcut lejantı her zaman sil ve yeniden oluştur
  document.getElementById('cg-pop-legend')?.remove();

  // Container'ı her seferinde taze al
  const container = document.getElementById('cg-imap-svg-container');
  if (!container) return;

  const legend = document.createElement('div');
  legend.id = 'cg-pop-legend';
  legend.style.cssText = 'position:absolute;bottom:30px;right:10px;background:rgba(8,12,16,0.88);border:1px solid rgba(255,255,255,0.18);padding:8px 10px;font-family:Space Mono,monospace;font-size:8px;letter-spacing:1px;color:#aaa;z-index:10;border-radius:2px;pointer-events:none';
  container.appendChild(legend);

  if (isPopulation) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">NÜFUS YOĞUNLUĞU</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(255,255,255);border:1px solid #333"></div> Seyrek &lt;10 kişi/km²</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(255,220,100)"></div> Orta 10–100</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(255,100,0)"></div> Yoğun 100–500</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:rgb(155,0,0)"></div> Çok yoğun &gt;500</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → kişi/km²</div>`;
  } else if (isPopCount) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">TOPLAM NÜFUS</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(255,255,255);border:1px solid #333"></div> Az &lt;5 milyon</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(255,220,100)"></div> Orta 5–50 mn</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(255,100,0)"></div> Kalabalık 50–200 mn</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:rgb(155,0,0)"></div> Dev &gt;200 milyon</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → milyon kişi</div>`;
  } else if (isPopGrowth) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">NÜFUS ARTIŞ HIZI</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(220,0,0)"></div> Azalıyor &lt;0%</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(240,240,230)"></div> Durağan 0–0.5%</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:rgb(180,210,0)"></div> Orta 0.5–2%</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:rgb(45,140,0)"></div> Hızlı &gt;2%</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → % / yıl</div>`;
  } else if (isTemperature) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">YILLIK ORT. SICAKLIK</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#00008b"></div> Çok soğuk &lt;0°C</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0064ff"></div> Soğuk 0–10°C</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffff00"></div> Ilıman 10–20°C</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#ff4400"></div> Sıcak &gt;25°C</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → °C</div>`;
  } else if (isRainfall) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">YILLIK ORT. YAĞIŞ</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#d2b45a"></div> Kurak &lt;100 mm</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#00a0b4"></div> Az 100–500 mm</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0064c8"></div> Orta 500–1500 mm</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#6400c8"></div> Çok yağışlı &gt;2000 mm</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → mm/yıl</div>`;
  } else if (isDesertification) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">ÇÖLLEŞme RİSKİ</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#cc2200"></div> Çok Yüksek Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff6600"></div> Yüksek Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffcc00"></div> Orta Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#99cc44"></div> Düşük Risk</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#2d7a2d"></div> Risk Yok</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → risk seviyesi</div>`;
  } else if (isHdi) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">${t('hdi_legend_title')||'İNSANİ GELİŞME ENDEKSİ'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#8b0000"></div> ${t('hdi_very_low')||'Çok Düşük &lt;0.45'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#cc3300"></div> ${t('hdi_low')||'Düşük 0.45–0.55'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff8800"></div> ${t('hdi_medium')||'Orta 0.55–0.65'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffdd00"></div> ${t('hdi_medium_high')||'Orta-Yüksek 0.65–0.75'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#aadd00"></div> ${t('hdi_high')||'Yüksek 0.75–0.80'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#44cc44"></div> ${t('hdi_very_high')||'Çok Yüksek 0.80–0.85'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#00aacc"></div> ${t('hdi_advanced')||'İleri 0.85–0.90'}</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#0055ff"></div> ${t('hdi_top')||'En İleri &gt;0.90'}</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">${t('hdi_hover')||'Üzerine gel → HDI değeri'}</div>`;
  } else if (isTrade) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">TİCARET YOLLARI</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:4px;background:#ff4400;border-radius:2px"></div> Ana Asya güzergahı</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:4px;background:#ff8800;border-radius:2px"></div> Hint Okyanusu - Süveyş</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:4px;background:#00aaff;border-radius:2px"></div> Atlantik güzergahları</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:4px;background:#44ff88;border-radius:2px"></div> Pasifik - Panama</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:4px;background:#aaaaff;border-radius:2px"></div> Ümit Burnu / Kuzey</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;background:#ffcc00;border-radius:50%;border:1px solid #000"></div> ⚓ Büyük Liman</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → liman adı</div>`;
  } else if (isEarthquake) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">DEPREM RİSKİ</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0d1a2a;border:1px solid #333"></div> Risk Yok</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#1a4a8a"></div> Düşük Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffcc00"></div> Orta Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff6600"></div> Yüksek Risk</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#cc0000"></div> Çok Yüksek Risk</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → risk seviyesi</div>`;
  } else if (isVolcano) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">VOLKANİK AKTİVİTE</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0d1a0d;border:1px solid #333"></div> Volkan Yok</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#1a3a1a"></div> Düşük Aktivite</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#8b3a00"></div> Orta Aktivite</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#cc5500"></div> Aktif Volkan</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff2200"></div> Çok Aktif</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;background:#ff4400;border-radius:50%;border:1px solid #ffcc00"></div> 🌋 Aktif Volkan Noktası</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → volkan adı</div>`;
  } else if (isFlood) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">SEL / TAŞKIN RİSKİ</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#041018;border:1px solid #333"></div> Risk Yok</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#1a3a6a"></div> Düşük Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0077cc"></div> Orta Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0099ff"></div> Yüksek Risk</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#00ddff"></div> Çok Yüksek Risk</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → risk seviyesi</div>`;
  } else if (isGdp) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">${t('gdp_legend_title')||'GSYİH (USD)'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#1a4422"></div> ${t('gdp_1')||'&lt;$50 milyar'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#2d7a3a"></div> ${t('gdp_2')||'$50–150 milyar'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#44aa55"></div> ${t('gdp_3')||'$150–500 milyar'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#88dd44"></div> ${t('gdp_4')||'$500 mn–1.5 trilyon'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffdd00"></div> ${t('gdp_5')||'$1.5–5 trilyon'}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff8800"></div> ${t('gdp_6')||'$5–10 trilyon'}</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#ff2200"></div> ${t('gdp_7')||'&gt;$10 trilyon'}</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">${t('gdp_hover')||'Üzerine gel → GSYİH değeri'}</div>`;
  } else if (isOil) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">PETROL REZERVİ</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0d1117;border:1px solid #333"></div> Yok / &lt;1 milyar varil</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#1a3a5c"></div> 1–5 milyar (Koyu Mavi)</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#9933cc"></div> 5–20 milyar (Mor)</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#00aacc"></div> 20–50 milyar (Cyan)</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#44dd88"></div> 50–100 milyar (Yeşil)</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffdd00"></div> 100–200 milyar (Sarı)</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff8800"></div> 200+ milyar (Turuncu)</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#ff2200"></div> 300+ milyar (Kırmızı)</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → milyar varil</div>`;
  } else if (isTurkeyPolitical) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">TÜRKİYE SİYASİ</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#c8273c"></div> Türkiye</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#1a2a1a;border:1px solid #4a7a50"></div> Komşu Ülkeler</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → ülke adı</div>`;
  } else if (isTurkeyRegions) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">COĞRAFİ BÖLGELER</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#4a90d9"></div> Marmara</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#f4a460"></div> Ege</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff8c42"></div> Akdeniz</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#2d8a4e"></div> Karadeniz</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#c8a84b"></div> İç Anadolu</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#8b4513"></div> Doğu Anadolu</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#cc6633"></div> Güneydoğu Anadolu</div>`;
  } else if (isTurkeyQuake) {
    legend.innerHTML = `<div style="margin-bottom:5px;color:#fff;font-size:9px;">TÜRKİYE DEPREM</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#cc0000"></div> Çok Yüksek Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff6600"></div> Yüksek Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffcc00"></div> Orta Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:12px;height:12px;background:#88aa44"></div> Düşük Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:5px"><div style="width:12px;height:12px;background:#2d5a8a"></div> Çok Düşük Risk</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:3px;background:#ff0000"></div> K. Anadolu Fay Hattı</div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><div style="width:20px;height:3px;background:#ff6600"></div> D. Anadolu Fay Hattı</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:20px;height:3px;background:#ffaa00"></div> Ege Graben Sistemi</div>
      <div style="margin-top:5px;color:#666;font-size:7px;">Üzerine gel → il/fay adı</div>`;
  } else if (isKoppen) {
    legend.innerHTML = `<div style="margin-bottom:6px;color:#fff;font-size:9px;letter-spacing:2px">${t('koppen_legend_title')||'KÖPPEN İKLİM'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0000ff;flex-shrink:0"></div> Af — ${t('koppen_af')||'Tropikal yağmur ormanı'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#0077ff;flex-shrink:0"></div> Am — ${t('koppen_am')||'Tropikal muson'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ff0000;flex-shrink:0"></div> BW — ${t('koppen_bw')||'Çöl'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#f4a460;flex-shrink:0"></div> BS — ${t('koppen_bs')||'Step'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#ffff00;flex-shrink:0"></div> Cs — ${t('koppen_cs')||'Akdeniz'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#00c800;flex-shrink:0"></div> Cf — ${t('koppen_cf')||'Okyanus / Ilıman'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#00c8c8;flex-shrink:0"></div> Df — ${t('koppen_df')||'Kıta iklimi'}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><div style="width:12px;height:12px;background:#9900ff;flex-shrink:0"></div> Dw — ${t('koppen_dw')||'Kışı Kuru Kıta'}</div>
      <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;background:#b2b2b2;flex-shrink:0"></div> ET/EF — ${t('koppen_et')||'Kutup / Tundra'}</div>`;
  }
}

function cgCloseInteractiveMap() {
  const wrap = document.getElementById('cg-interactive-map-wrap');
  wrap.classList.remove('active');
  document.body.style.overflow = '';
  document.getElementById('cg-pop-legend')?.remove();
  document.getElementById('cg-koppen-disc')?.remove();
}

function cgImapReset() {
  cgiCountryColors = {};
  if (cgiG) {
    cgiInited = false;
    cgiG.remove();
    cgiG = null;
    cgiSvg.selectAll('.cgi-label-layer').remove();
    window._cgiLabelData = [];
    window._cgiRedrawLabels = null;
    if (cgiSvg) cgiSvg.on('.zoom', null);
    cgiBuildMap(cgiCurrentRegion === 'world' ? null : cgiCurrentRegion);
  }
}

function cgiUpdateCounter() {
  // counter elementi artık yok, sessizce çık
}

/* -> moved to data.js / translations.js */


// ── TÜRKİYE DEPREM BÖLGELERİ (AFAD 1. derece = 4, 5. derece = 0)
/* -> moved to data.js / translations.js */


// Türkiye için özel render — ülke bazlı (792) büyütülmüş
function buildTurkeyMap(mode) {
  const container = document.getElementById('cg-imap-svg-container');
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || (window.innerHeight - 90);

  cgiSvg = d3.select('#cg-imap-svg');
  cgiProjection = d3.geoMercator()
    .center([35.5, 39.0])
    .scale(w * 2.4)
    .translate([w / 2, h / 2]);
  cgiPath = d3.geoPath().projection(cgiProjection);

  cgiZoom = d3.zoom()
    .scaleExtent([0.5, 30])
    .on('zoom', (e) => {
      cgiG.attr('transform', e.transform);
      if (window._cgiRedrawLabels) window._cgiRedrawLabels(e.transform);
      document.getElementById('cg-imap-zoomval').textContent = e.transform.k.toFixed(1) + '×';
    });
  cgiSvg.call(cgiZoom);
  cgiSvg.on('mousedown', () => container.classList.add('dragging'));
  window.addEventListener('mouseup', () => container.classList.remove('dragging'));

  cgiG = cgiSvg.append('g');
  cgiG.append('rect').attr('class','cgi-ocean')
    .attr('x',-w*10).attr('y',-h*10).attr('width',w*20).attr('height',h*20);
  cgiG.append('path').datum(d3.geoGraticule()())
    .attr('class','cgi-graticule').attr('d',cgiPath);

  const tooltip = document.getElementById('cg-imap-tooltip');

  if (window._worldData) {
    renderTurkey(window._worldData, mode, tooltip, container, w, h);
  } else {
    loadWorldAtlas()
      .then(world => {
        renderTurkey(world, mode, tooltip, container, w, h);
      })
      .catch(() => { /* hata banner'ı loadWorldAtlas() içinde gösterildi */ });
  }
}

function renderTurkey(world, mode, tooltip, container, w, h) {
  const all = topojson.feature(world, world.objects.countries);
  // Türkiye (792) + komşular
  const neighbors = [300,31,51,268,364,368,760,792,100];
  const features = all.features.filter(f => neighbors.includes(+f.id));
  const turkey = all.features.find(f => +f.id === 792);

  // Komşuları soluk göster
  cgiG.selectAll('.cgi-neighbor')
    .data(features.filter(f => +f.id !== 792))
    .join('path')
      .attr('class','cgi-neighbor')
      .attr('d', cgiPath)
      .style('fill','#1a2a1a')
      .style('stroke','#4a7a50')
      .attr('stroke-width', 0.4)
      .attr('vector-effect','non-scaling-stroke');

  if (!turkey) return;

  if (mode === 'turkey_regions') {
    // Bölge etiketleri
    const REGION_CENTERS = [
      { name:'Marmara',      lon:28.5, lat:40.8, color:'#4a90d9' },
      { name:'Ege',          lon:27.5, lat:38.5, color:'#f4a460' },
      { name:'Akdeniz',      lon:31.5, lat:37.2, color:'#ff8c42' },
      { name:'Karadeniz',    lon:35.5, lat:41.4, color:'#2d8a4e' },
      { name:'İç Anadolu',   lon:33.5, lat:39.0, color:'#c8a84b' },
      { name:'Doğu Anadolu', lon:41.0, lat:39.5, color:'#8b4513' },
      { name:'Güneydoğu',    lon:38.5, lat:37.4, color:'#cc6633' },
    ];

    // Türkiye tek parça — bölge renklerini gradient gibi göster
    // Arka plan olarak her bölge için ayrı path (aynı geometry, farklı clip)
    cgiG.append('path').datum(turkey).attr('d', cgiPath)
      .style('fill','#2a4a7a').style('stroke','#fff').attr('stroke-width',0.8)
      .attr('vector-effect','non-scaling-stroke')
      .on('mousemove', (event) => {
        tooltip.style.display='block';
        tooltip.style.left=(event.offsetX+12)+'px';
        tooltip.style.top=(event.offsetY-22)+'px';
        tooltip.textContent='Türkiye';
      }).on('mouseleave', () => { tooltip.style.display='none'; });

    const labelG = cgiG.append('g').style('pointer-events','none');
    REGION_CENTERS.forEach(r => {
      const [px, py] = cgiProjection([r.lon, r.lat]);
      labelG.append('rect').attr('x', px-40).attr('y', py-9)
        .attr('width',80).attr('height',18).attr('rx',3)
        .style('fill', r.color).style('opacity',0.88);
      labelG.append('text').attr('x',px).attr('y',py+1)
        .attr('text-anchor','middle').attr('dominant-baseline','central')
        .attr('font-family','Space Mono,monospace').attr('font-size','5.5px')
        .attr('font-weight','700').attr('fill','#fff')
        .attr('stroke','rgba(0,0,0,0.5)').attr('stroke-width','0.4px')
        .attr('paint-order','stroke').text(r.name + ' Bölgesi');
    });
    window._cgiRedrawLabels = () => {};
    cgiShowLegend('turkey_regions');
    return;
  }

  if (mode === 'turkey_quake') {
    cgiG.append('path').datum(turkey).attr('d', cgiPath)
      .style('fill','#cc3300').style('stroke','#333').attr('stroke-width',0.5)
      .attr('vector-effect','non-scaling-stroke');

    const FAY_LINES = [
      { name:'Kuzey Anadolu Fay Hattı', color:'#ff0000', width:3,
        points:[[26.5,41],[28,40.8],[30,40.7],[32,40.6],[34,40.4],[36,40.0],[38,39.5],[40,39.0],[42,39.2],[44,39.5]] },
      { name:'Doğu Anadolu Fay Hattı', color:'#ff6600', width:2.5,
        points:[[36.1,36.8],[37.5,37.5],[38.5,38.0],[39.5,38.5],[40.5,39.0],[41.5,39.5]] },
      { name:'Ege Graben Sistemi', color:'#ffaa00', width:2,
        points:[[26.5,40.5],[27.5,39.5],[28.5,38.5],[29.5,37.8],[27,37.5]] },
    ];
    const lineGen = d3.line()
      .x(d => cgiProjection(d)[0]).y(d => cgiProjection(d)[1])
      .curve(d3.curveCatmullRom);
    FAY_LINES.forEach(fay => {
      cgiG.append('path').datum(fay.points).attr('d', lineGen)
        .attr('fill','none').attr('stroke',fay.color)
        .attr('stroke-width',fay.width).attr('stroke-dasharray','4,3')
        .attr('vector-effect','non-scaling-stroke').style('pointer-events','all')
        .on('mousemove', (event) => {
          tooltip.style.display='block';
          tooltip.style.left=(event.offsetX+12)+'px';
          tooltip.style.top=(event.offsetY-22)+'px';
          tooltip.textContent='⚠️ '+fay.name;
        }).on('mouseleave', () => { tooltip.style.display='none'; });
    });

    const CITIES = [
      [29.0,41.0,'İstanbul'],[32.8,39.9,'Ankara'],[27.1,38.4,'İzmir'],
      [30.7,36.9,'Antalya'],[35.3,37.0,'Adana'],[36.1,36.2,'Hatay'],
      [37.3,37.6,'K.Maraş'],[38.3,38.4,'Malatya'],[39.7,39.9,'Erzincan'],
      [41.3,39.9,'Erzurum'],[43.4,38.5,'Van'],
    ];
    const cityG = cgiG.append('g').style('pointer-events','none');
    CITIES.forEach(([lon,lat,name]) => {
      const [px,py] = cgiProjection([lon,lat]);
      cityG.append('circle').attr('cx',px).attr('cy',py).attr('r',2)
        .style('fill','#fff').style('stroke','#000').attr('stroke-width',0.3)
        .attr('vector-effect','non-scaling-stroke');
      cityG.append('text').attr('x',px+3).attr('y',py+1)
        .attr('font-family','Space Mono,monospace').attr('font-size','4px')
        .attr('fill','#fff').attr('stroke','rgba(0,0,0,0.7)').attr('stroke-width','0.5px')
        .attr('paint-order','stroke').text(name);
    });
    window._cgiRedrawLabels = () => {};
    cgiShowLegend('turkey_quake');
    return;
  }

  // Siyasi harita
  cgiG.append('path').datum(turkey).attr('d', cgiPath)
    .style('fill','#c8273c').style('stroke','#fff').attr('stroke-width',0.8)
    .attr('vector-effect','non-scaling-stroke')
    .on('mousemove', (event) => {
      tooltip.style.display='block';
      tooltip.style.left=(event.offsetX+12)+'px';
      tooltip.style.top=(event.offsetY-22)+'px';
      tooltip.textContent='🇹🇷 Türkiye';
    }).on('mouseleave', () => { tooltip.style.display='none'; });

  const NEIGHBOR_NAMES = {300:'Yunanistan',31:'Azerbaycan',51:'Ermenistan',268:'Gürcistan',364:'İran',368:'Irak',760:'Suriye',100:'Bulgaristan'};
  features.filter(f => +f.id !== 792).forEach(f => {
    const id = +f.id;
    let c; try { c = cgiPath.centroid(f); } catch(e) {}
    if (!c || isNaN(c[0])) return;
    cgiG.append('text').attr('x',c[0]).attr('y',c[1])
      .attr('text-anchor','middle').attr('dominant-baseline','central')
      .attr('font-family','Space Mono,monospace').attr('font-size','5px')
      .attr('fill','rgba(255,255,255,0.6)').style('pointer-events','none')
      .text(NEIGHBOR_NAMES[id] || '');
  });

  const tc = cgiPath.centroid(turkey);
  cgiG.append('text').attr('x',tc[0]).attr('y',tc[1])
    .attr('text-anchor','middle').attr('dominant-baseline','central')
    .attr('font-family','Space Mono,monospace').attr('font-size','12px').attr('font-weight','800')
    .attr('fill','#fff').attr('stroke','rgba(0,0,0,0.5)').attr('stroke-width','1px')
    .attr('paint-order','stroke').style('pointer-events','none').text('TÜRKİYE');

  window._cgiRedrawLabels = () => {};
  cgiShowLegend('turkey_political');
}

function cgiBuildMap(region, mode) {
  const container = document.getElementById('cg-imap-svg-container');
  const w = container.clientWidth  || window.innerWidth;
  const h = container.clientHeight || (window.innerHeight - 90);

  // Türkiye modları özel render
  if (mode === 'turkey_political' || mode === 'turkey_regions' || mode === 'turkey_quake') {
    buildTurkeyMap(mode);
    return;
  }

  cgiSvg = d3.select('#cg-imap-svg');
  const regionCfg = region ? CGI_REGIONS[region] : null;

  // Tüm haritalar için aynı NaturalEarth projeksiyon — bölge haritaları başlangıçta zoom ile odaklanır
  cgiProjection = d3.geoNaturalEarth1()
    .scale(w / 6.2)
    .translate([w / 2, h / 2 + 20]);

  cgiPath = d3.geoPath().projection(cgiProjection);
  cgiBaseStroke = 0.4;

  cgiZoom = d3.zoom()
    .scaleExtent([0.4, 80])
    .on('zoom', (e) => {
      cgiG.attr('transform', e.transform);
      const k = e.transform.k;
      cgiG.selectAll('.cgi-country.cgi-small-dot')
        .attr('r', 2.5 / Math.sqrt(k));
      // Etiketleri yeniden çiz
      if (window._cgiRedrawLabels) window._cgiRedrawLabels(e.transform);
      if (window._cgiTradeLabels) window._cgiTradeLabels(e.transform);
      if (window._cgiPortDots) window._cgiPortDots(e.transform);
      document.getElementById('cg-imap-zoomval').textContent = k.toFixed(1) + '×';
    });

  cgiSvg.call(cgiZoom);

  // sürükleme animasyonu
  cgiSvg.on('mousedown', () => container.classList.add('dragging'));
  window.addEventListener('mouseup', () => container.classList.remove('dragging'));

  cgiG = cgiSvg.append('g');

  // Okyanus arka planı
  cgiG.append('rect')
    .attr('class', 'cgi-ocean')
    .attr('x', -w * 10).attr('y', -h * 10)
    .attr('width', w * 20).attr('height', h * 20);

  // Graticule
  cgiG.append('path')
    .datum(d3.geoGraticule()())
    .attr('class', 'cgi-graticule')
    .attr('d', cgiPath);

  // Tooltip
  const tooltip = document.getElementById('cg-imap-tooltip');

  // Dünya verisini yükle — mevcut _worldData varsa kullan, yoksa fetch et
  // Otomatik renk paleti — komşu ülkeler farklı renk alır
  const AUTO_COLORS = [
    '#1a5c8a', // mavi
    '#2e7d4f', // yeşil
    '#8a6208', // hardal
    '#7a2040', // bordo
    '#1e5c5c', // petrol
    '#5a2070', // mor
    '#7a4010', // kahverengi
    '#1a4a6a', // çelik mavi
    '#3a6a2a', // açık yeşil
    '#6a1a2a', // koyu kırmızı
  ];

  function autoColorCountries(features, world) {
    const allGeoms = world.objects.countries.geometries;
    const neighbors = topojson.neighbors(allGeoms);

    // id → dünya index haritası
    const idToWorldIdx = {};
    allGeoms.forEach((g, i) => { idToWorldIdx[+g.id] = i; });

    const colorMap = {};
    features.forEach(f => {
      const id = +f.id;
      const worldIdx = idToWorldIdx[id];
      if (worldIdx === undefined) { colorMap[id] = AUTO_COLORS[0]; return; }
      const usedColors = new Set();
      (neighbors[worldIdx] || []).forEach(ni => {
        const ng = allGeoms[ni];
        if (ng && colorMap[+ng.id]) usedColors.add(colorMap[+ng.id]);
      });
      for (let c of AUTO_COLORS) {
        if (!usedColors.has(c)) { colorMap[id] = c; break; }
      }
      if (!colorMap[id]) colorMap[id] = AUTO_COLORS[Object.keys(colorMap).length % AUTO_COLORS.length];
    });
    return colorMap;
  }

  // Nüfus yoğunluğu verisi (kişi/km²) — yaklaşık değerler
  const POPULATION_DENSITY = {
    4:120, 8:105, 12:18, 20:160, 24:26, 28:92, 31:120, 32:17, 36:3,
    40:109, 44:395, 48:2000, 50:1240, 51:105, 52:674, 56:376, 60:5,
    64:20, 68:11, 70:70, 72:4, 76:25, 84:17, 96:83, 100:67, 104:83,
    108:444, 112:48, 116:94, 120:46, 124:4, 132:135, 136:600, 140:8,
    144:341, 148:12, 152:26, 156:148, 158:650, 170:45, 174:415,
    175:700, 178:16, 180:36, 188:97, 191:73, 192:102, 196:131,
    203:138, 204:101, 208:137, 212:186, 214:407, 218:68, 222:306,
    231:115, 232:55, 233:31, 234:35, 246:18, 250:119, 262:40,
    266:6, 268:60, 270:190, 275:813, 276:236, 288:128, 296:140,
    300:82, 304:0.1, 308:310, 312:250, 320:160, 324:53, 328:4,
    332:413, 340:89, 348:107, 352:3, 356:464, 360:145, 364:52,
    368:92, 372:72, 376:400, 380:200, 388:274, 392:347, 398:7,
    400:115, 404:95, 408:212, 410:527, 414:231, 417:34, 418:31,
    422:667, 426:72, 428:32, 430:49, 434:4, 438:236, 440:47,
    442:214, 450:44, 454:198, 458:98, 462:1800, 466:17, 470:1581,
    478:4, 480:626, 484:64, 492:20000, 496:2, 498:122, 499:46,
    504:92, 508:39, 516:3, 524:204, 528:508, 531:360, 533:590,
    534:1500, 558:52, 562:17, 566:218, 578:15, 586:281, 591:54,
    598:18, 600:18, 604:25, 608:368, 616:124, 620:112, 626:85,
    630:390, 634:281, 638:350, 642:90, 643:9, 646:500, 659:200,
    660:200, 662:300, 663:400, 666:25, 670:280, 678:190, 682:17,
    686:82, 688:80, 690:213, 694:85, 703:113, 704:308, 705:103,
    706:24, 710:47, 716:37, 724:93, 728:15, 729:25, 732:4,
    740:4, 748:79, 752:25, 756:219, 760:103, 762:64, 764:135,
    768:105, 780:269, 784:119, 788:76, 792:106, 795:12, 796:33,
    800:231, 804:77, 807:80, 818:98, 826:281, 834:68, 840:36,
    850:100, 854:68, 858:20, 860:75, 862:36, 887:55, 894:19,
  };

  function getPopColor(density) {
    if (!density || density === 0) return '#1a2a1a';
    // Beyaz (seyrek) → turuncu → kırmızı (kalabalık)
    const max = 2000;
    const t = Math.min(density / max, 1);
    const log_t = Math.log1p(t * 10) / Math.log1p(10); // logaritmik ölçek
    if (log_t < 0.33) {
      // beyaz → sarı
      const r = Math.round(255);
      const g = Math.round(255 - log_t * 3 * 80);
      const b = Math.round(255 - log_t * 3 * 255);
      return `rgb(${r},${g},${b})`;
    } else if (log_t < 0.66) {
      const s = (log_t - 0.33) * 3;
      const r = 255;
      const g = Math.round(175 - s * 130);
      const b = 0;
      return `rgb(${r},${g},${b})`;
    } else {
      const s = (log_t - 0.66) * 3;
      const r = Math.round(255 - s * 100);
      const g = 0;
      const b = 0;
      return `rgb(${r},${g},${b})`;
    }
  }

  // Toplam nüfus (milyon kişi) — yaklaşık 2024 değerleri
  const POPULATION_COUNT = {
    4:42, 8:3, 12:46, 20:0.08, 24:37, 28:0.1, 31:10, 32:46, 36:26,
    40:9, 44:0.4, 48:1.5, 50:173, 51:3, 52:0.3, 56:11, 60:0.06,
    64:0.8, 68:12, 70:3, 72:2.6, 76:217, 84:0.4, 96:0.5, 100:7,
    104:54, 108:13, 112:9, 116:17, 120:28, 124:38, 132:0.6, 136:0.07,
    140:5, 144:22, 148:18, 152:19, 156:1400, 158:23, 170:52, 174:0.9,
    175:0.3, 178:6, 180:102, 188:5, 191:4, 192:11, 196:1.2,
    203:11, 204:14, 208:6, 212:0.07, 214:11, 218:18, 222:6.5,
    231:128, 232:3.5, 233:1.4, 234:0.05, 246:5.5, 250:68, 262:1,
    266:2.3, 268:3.7, 270:2.7, 275:5.4, 276:84, 288:33, 296:0.12,
    300:11, 304:0.06, 308:0.12, 312:0.4, 320:17, 324:14, 328:0.8,
    332:11, 340:10, 348:10, 352:0.37, 356:1430, 360:278, 364:87,
    368:42, 372:5, 376:9.5, 380:60, 388:3, 392:124, 398:19,
    400:10, 404:56, 408:26, 410:52, 414:4.5, 417:7, 418:7.4,
    422:5.5, 426:2.3, 428:1.8, 430:5.4, 434:7, 438:0.04, 440:2.8,
    442:0.65, 450:29, 454:21, 458:33, 462:0.52, 466:23, 470:0.54,
    478:4.6, 480:1.3, 484:130, 492:0.04, 496:3.3, 498:2.6, 499:0.62,
    504:37, 508:33, 516:3, 524:30, 528:17.9, 531:0.19, 533:0.11,
    534:0.04, 558:7, 562:26, 566:223, 578:5.5, 586:231, 591:4.4,
    598:10, 600:7, 604:33, 608:115, 616:38, 620:10, 626:1.3,
    630:3.2, 634:2.9, 638:0.97, 642:19, 643:144, 646:14, 659:0.05,
    660:0.02, 662:0.18, 663:0.04, 666:0.005, 670:0.1, 678:0.24,
    682:36, 686:17, 688:7, 690:0.1, 694:8.4, 703:5.5, 704:98,
    705:2.1, 706:18, 710:60, 716:16, 724:47, 728:11, 729:46,
    732:0.6, 740:0.6, 748:1.2, 752:10, 756:8.7, 760:22, 762:10,
    764:72, 768:9, 780:1.4, 784:10, 788:12, 792:85, 795:6,
    796:0.04, 800:49, 804:44, 807:2, 818:106, 826:68, 834:64,
    840:335, 850:0.1, 854:23, 858:3.5, 860:36, 862:28, 887:34, 894:20,
  };

  function getPopCountColor(pop) {
    if (!pop || pop === 0) return '#1a2a1a';
    const max = 1430;
    const t = Math.min(pop / max, 1);
    const log_t = Math.log1p(t * 20) / Math.log1p(20);
    if (log_t < 0.33) {
      return `rgb(255,${Math.round(255 - log_t*3*80)},${Math.round(255 - log_t*3*255)})`;
    } else if (log_t < 0.66) {
      const s = (log_t - 0.33) * 3;
      return `rgb(255,${Math.round(175 - s*130)},0)`;
    } else {
      const s = (log_t - 0.66) * 3;
      return `rgb(${Math.round(255 - s*100)},0,0)`;
    }
  }

  // ── SICAKLIK verisi (yıllık ort. °C)
  const TEMPERATURE_DATA = {
    4:12, 8:11, 12:23, 20:3, 24:22, 28:-2, 31:12, 32:14, 36:22,
    40:8, 44:25, 48:27, 50:26, 51:8, 52:27, 56:10, 60:-4,
    64:4, 68:24, 70:17, 72:21, 76:26, 84:20, 96:27, 100:10,
    104:24, 108:20, 112:7, 116:26, 120:24, 124:-4, 132:26, 136:28,
    140:24, 144:28, 148:17, 152:9, 156:8, 158:24, 170:24, 174:26,
    175:26, 178:22, 180:24, 188:22, 191:12, 192:26, 196:19,
    203:9, 204:28, 208:8, 212:28, 214:27, 218:23, 222:23,
    231:16, 232:17, 233:9, 234:6, 246:4, 250:12, 262:29,
    266:24, 268:12, 270:29, 275:20, 276:9, 288:26, 296:28,
    300:16, 304:-8, 308:27, 312:26, 320:19, 324:26, 328:26,
    332:25, 340:22, 348:11, 352:4, 356:25, 360:26, 364:17,
    368:22, 372:10, 376:20, 380:14, 388:27, 392:14, 398:8,
    400:17, 404:20, 408:4, 410:13, 414:25, 417:8, 418:24,
    422:18, 426:16, 428:7, 430:25, 434:27, 438:6, 440:7,
    442:10, 450:23, 454:22, 458:27, 462:28, 466:26, 470:19,
    478:28, 480:22, 484:21, 492:14, 496:0, 498:11, 499:12,
    504:17, 508:22, 516:22, 524:18, 528:10, 531:22, 533:22,
    534:28, 558:23, 562:28, 566:27, 578:2, 586:22, 591:27,
    598:26, 600:23, 604:18, 608:27, 616:9, 620:15, 626:27,
    630:24, 634:28, 638:23, 642:10, 643:0, 646:19, 659:28,
    660:28, 662:28, 663:28, 670:28, 678:26, 682:27, 686:28,
    688:12, 690:27, 694:26, 703:10, 704:23, 705:10, 706:28,
    710:18, 716:20, 724:15, 728:22, 729:26, 732:22, 740:27,
    748:17, 752:4, 756:9, 760:17, 762:12, 764:26, 768:27,
    780:28, 784:27, 788:19, 792:12, 795:17, 800:21, 804:9,
    807:12, 818:22, 826:10, 834:23, 840:9, 854:28, 858:18,
    860:14, 862:26, 887:25, 894:20,
  };

  function getTempColor(temp) {
    if (temp === undefined) return '#1a2a1a';
    // -10°C (koyu mavi) → 0 (mavi) → 15 (sarı) → 30 (kırmızı)
    if (temp <= -10) return '#00008b';
    if (temp <= 0) {
      const t = (temp + 10) / 10;
      return `rgb(${Math.round(t*0)},${Math.round(t*100)},${Math.round(139 + t*116)})`;
    }
    if (temp <= 15) {
      const t = temp / 15;
      return `rgb(${Math.round(t*255)},${Math.round(100 + t*155)},${Math.round(255 - t*255)})`;
    }
    const t = Math.min((temp - 15) / 20, 1);
    return `rgb(255,${Math.round(255 - t*255)},0)`;
  }

  // ── YAĞIŞ verisi (yıllık ort. mm)
  const RAINFALL_DATA = {
    4:327, 8:1485, 12:89, 20:660, 24:1010, 28:600, 31:447, 32:591, 36:465,
    40:711, 44:1200, 48:77, 50:2666, 51:562, 52:1800, 56:847, 60:550,
    64:2200, 68:1146, 70:1500, 72:400, 76:1761, 84:2000, 96:2722, 100:595,
    104:2091, 108:1274, 112:618, 116:1904, 120:1604, 124:537, 132:1000, 136:1500,
    140:1500, 144:1712, 148:241, 152:1522, 156:645, 158:2502, 170:3240, 174:900,
    175:1100, 178:1646, 180:1543, 188:2926, 191:833, 192:1335, 196:503,
    203:677, 204:1167, 208:703, 212:2083, 214:1400, 218:2087, 222:1784,
    231:848, 232:397, 233:626, 234:1600, 246:673, 250:867, 262:220,
    266:1831, 268:716, 270:1600, 275:402, 276:700, 288:1187, 296:2000,
    300:652, 304:660, 308:2000, 312:1500, 320:1987, 324:1651, 328:2387,
    332:1400, 340:1900, 348:589, 352:789, 356:1083, 360:2702, 364:228,
    368:216, 372:1118, 376:435, 380:832, 388:1947, 392:1668, 398:280,
    400:111, 404:630, 408:600, 410:1274, 414:121, 417:380, 418:1834,
    422:661, 426:724, 428:641, 430:1200, 434:56, 438:1200, 440:656,
    442:860, 450:1513, 454:1181, 458:2875, 462:1972, 466:282, 470:691,
    478:158, 480:1027, 484:752, 492:1200, 496:241, 498:550, 499:1500,
    504:346, 508:1032, 516:285, 524:1500, 528:778, 531:1100, 533:1000,
    534:1300, 558:2391, 562:151, 566:1150, 578:1414, 586:494, 591:1987,
    598:2000, 600:1130, 604:1738, 608:2348, 616:600, 620:854, 626:1500,
    630:1476, 634:74, 638:1500, 642:637, 643:531, 646:1212, 659:1500,
    660:1500, 662:2000, 663:2000, 670:2100, 678:1000, 682:59, 686:686,
    688:680, 690:2330, 694:2526, 703:605, 704:1821, 705:1001, 706:1000,
    710:464, 716:657, 724:636, 728:800, 729:416, 732:252, 740:2331,
    748:1144, 752:624, 756:1537, 760:252, 762:691, 764:1622, 768:1168,
    780:2200, 784:78, 788:207, 792:593, 795:161, 800:1180, 804:565,
    807:619, 818:51, 826:1220, 834:1071, 840:715, 854:748, 858:1100,
    860:209, 862:1800, 887:167, 894:1020,
  };

  function getRainfallColor(mm) {
    if (mm === undefined) return '#1a2a1a';
    // 0 (sarı/kum) → 500 (açık mavi) → 2000 (koyu mavi) → 3000+ (mor)
    if (mm < 100)  { const t=mm/100; return `rgb(${Math.round(210-t*30)},${Math.round(180-t*30)},${Math.round(80+t*80)})`; }
    if (mm < 500)  { const t=(mm-100)/400; return `rgb(${Math.round(180-t*180)},${Math.round(150+t*50)},${Math.round(160+t*60)})`; }
    if (mm < 1500) { const t=(mm-500)/1000; return `rgb(0,${Math.round(200-t*100)},${Math.round(220+t*35)})`; }
    const t=Math.min((mm-1500)/1500,1); return `rgb(${Math.round(t*100)},0,${Math.round(200+t*55)})`;
  }

  // ── ÇÖLLEŞme RİSKİ — 5 seviye: 'very_high','high','medium','low','none'
  const DESERTIFICATION_DATA = {
    36:'very_high', 795:'very_high', 288:'high',
    12:'very_high', 434:'very_high', 504:'very_high', 818:'very_high',
    729:'very_high', 682:'very_high', 788:'very_high', 466:'very_high',
    562:'very_high', 148:'very_high', 706:'very_high', 516:'very_high',
    686:'very_high', 478:'very_high', 4:'very_high', 48:'very_high',
    // Yüksek risk
    404:'high', 800:'high', 140:'high', 270:'high', 204:'high',
    566:'high', 728:'high', 524:'high', 398:'high', 860:'high',
    496:'high', 364:'high', 400:'high', 512:'high', 887:'high',
    634:'high', 784:'high', 368:'high', 760:'high', 104:'high',
    356:'high', 710:'high', 484:'high', 152:'high', 32:'high',
    858:'high', 600:'high', 218:'high', 170:'high',
    // Orta risk
    792:'medium', 724:'medium', 300:'medium', 380:'medium', 620:'medium',
    642:'medium', 840:'medium', 604:'medium', 76:'medium',
    276:'medium', 616:'medium', 498:'medium', 804:'medium',
    156:'medium', 762:'medium', 528:'medium', 710:'medium',
    // Düşük risk
    826:'low', 372:'low', 246:'low', 208:'low', 578:'low',
    752:'low', 756:'low', 40:'low', 250:'low', 56:'low',
    348:'low', 203:'low', 703:'low', 191:'low', 705:'low',
    643:'low', 124:'low', 304:'low', 352:'low', 392:'low',
    442:'low', 438:'low', 492:'low',
    // Risk yok / nemli
    50:'none', 116:'none', 180:'none', 360:'none', 596:'none',
    598:'none', 626:'none', 694:'none', 324:'none', 288:'none',
    174:'none', 690:'none', 480:'none', 132:'none', 388:'none',
  };

  function getDesertificationColor(risk) {
    const colors = {
      'very_high': '#cc2200',  // Çok yüksek — koyu kırmızı
      'high':      '#ff6600',  // Yüksek — turuncu
      'medium':    '#ffcc00',  // Orta — sarı
      'low':       '#99cc44',  // Düşük — açık yeşil
      'none':      '#2d7a2d',  // Risk yok — koyu yeşil
    };
    return colors[risk] || '#99cc44'; // tanımsız → düşük risk
  }

  // ── GSYİH verisi (milyar USD, 2023 tahmini)
  const GDP_DATA = {
    4:22, 8:18, 12:239, 20:3, 24:124, 28:641, 31:78, 32:620, 36:1693,
    40:470, 44:13, 48:44, 50:460, 51:24, 52:6, 56:582, 60:7,
    64:3, 68:45, 70:24, 72:19, 76:2174, 84:3, 96:15, 100:97,
    104:66, 108:3, 112:73, 116:31, 120:45, 124:2140, 132:1, 136:7,
    140:3, 144:84, 148:13, 152:344, 156:17700, 158:751, 170:363, 174:1,
    175:1, 178:65, 180:65, 188:77, 191:70, 192:107, 196:32,
    203:330, 204:19, 208:406, 212:1, 214:24, 218:118, 222:32,
    231:156, 232:3, 233:38, 234:3, 246:301, 250:3031, 262:4,
    266:20, 268:28, 270:2, 275:20, 276:4430, 288:77, 296:0,
    300:239, 304:57, 308:1, 312:1, 320:95, 324:16, 328:5,
    332:24, 340:31, 348:196, 352:31, 356:3730, 360:1371, 364:702,
    368:268, 372:594, 376:521, 380:2255, 388:19, 392:4410, 398:261,
    400:50, 404:118, 408:34, 410:1710, 414:185, 417:13, 418:15,
    422:23, 426:3, 428:43, 430:4, 434:50, 438:7, 440:79,
    442:86, 450:15, 454:7, 458:430, 462:6, 466:22, 470:20,
    478:10, 480:14, 484:1466, 492:9, 496:14, 498:16, 499:6,
    504:142, 508:20, 516:13, 524:40, 528:1080, 531:1, 533:3,
    534:1, 558:15, 562:17, 566:477, 578:546, 586:341, 591:72,
    598:28, 600:43, 604:267, 608:435, 616:842, 620:287, 626:3,
    630:118, 634:235, 638:10, 642:351, 643:2240, 646:14, 659:1,
    660:0, 662:2, 663:1, 670:1, 678:2, 682:1069, 686:27,
    688:72, 690:2, 694:5, 703:132, 704:433, 705:67, 706:10,
    710:405, 716:29, 724:1580, 728:11, 729:170, 732:14, 740:4,
    748:5, 752:597, 756:870, 760:22, 762:10, 764:574, 768:19,
    780:27, 784:509, 788:49, 792:1154, 795:59, 800:45, 804:179,
    807:14, 818:396, 826:3080, 834:79, 840:27360, 854:20, 858:77,
    860:100, 862:95, 887:21, 894:29,
  };

  function getGdpColor(gdp) {
    if (!gdp) return '#1a2a1a';
    // Yeşil tonu: az → koyu, çok → parlak/sarı
    if (gdp < 10)    return '#0d2211';
    if (gdp < 50)    return '#1a4422';
    if (gdp < 150)   return '#2d7a3a';
    if (gdp < 500)   return '#44aa55';
    if (gdp < 1500)  return '#88dd44';
    if (gdp < 5000)  return '#ffdd00';
    if (gdp < 10000) return '#ff8800';
    return '#ff2200'; // 10 trilyon+
  }

  // Yıllık nüfus artış hızı (%) — yaklaşık 2023 değerleri
  const POPULATION_GROWTH = {
    4:2.3, 8:0.3, 12:1.7, 20:0.6, 24:3.2, 28:0.9, 31:0.6, 32:0.9, 36:1.2,
    40:0.4, 44:1.3, 48:1.4, 50:1.0, 51:0.1, 52:0.2, 56:0.4, 60:-0.3,
    64:1.0, 68:1.4, 70:0.6, 72:2.0, 76:0.7, 84:1.9, 96:1.1, 100:0.3,
    104:0.8, 108:3.0, 112:0.0, 116:1.4, 120:2.6, 124:0.9, 132:0.8, 136:1.4,
    140:2.5, 144:0.5, 148:3.0, 152:0.8, 156:0.0, 158:0.2, 170:1.4, 174:2.6,
    175:2.6, 178:3.1, 180:3.2, 188:0.8, 191:-0.2, 192:0.2, 196:0.9,
    203:0.1, 204:2.7, 208:0.4, 212:0.8, 214:1.4, 218:1.4, 222:0.9,
    231:2.6, 232:2.3, 233:0.0, 234:0.5, 246:0.2, 250:0.3, 262:1.6,
    266:2.5, 268:-0.5, 270:2.8, 275:2.0, 276:0.1, 288:2.2, 296:1.4,
    300:-0.2, 304:-0.2, 308:0.5, 312:0.5, 320:1.8, 324:2.9, 328:0.6,
    332:1.3, 340:1.7, 348:-0.2, 352:0.8, 356:0.8, 360:1.1, 364:1.1,
    368:2.3, 372:0.9, 376:1.5, 380:0.2, 388:0.5, 392:-0.4, 398:1.2,
    400:1.5, 404:2.2, 408:0.4, 410:0.2, 414:1.4, 417:1.5, 418:1.5,
    422:0.8, 426:1.1, 428:-1.0, 430:2.5, 434:3.0, 438:0.7, 440:-0.8,
    442:1.8, 450:2.7, 454:2.6, 458:1.1, 462:2.2, 466:3.0, 470:0.2,
    478:2.7, 480:0.4, 484:1.0, 492:0.7, 496:1.5, 498:-0.2, 499:0.4,
    504:1.2, 508:2.9, 516:1.9, 524:1.8, 528:0.4, 531:0.5, 533:0.4,
    534:1.2, 558:1.3, 562:3.8, 566:2.5, 578:0.6, 586:1.9, 591:1.6,
    598:1.7, 600:1.2, 604:1.4, 608:1.6, 616:-0.1, 620:-0.2, 626:2.1,
    630:0.1, 634:1.5, 638:0.9, 642:-0.7, 643:0.0, 646:2.6, 659:0.6,
    660:0.2, 662:0.5, 663:0.4, 670:0.8, 678:2.3, 682:1.7, 686:2.7,
    688:0.0, 690:0.7, 694:2.0, 703:0.1, 704:0.9, 705:0.4, 706:2.9,
    710:1.1, 716:1.5, 724:0.1, 728:3.0, 729:2.4, 732:1.3, 740:0.8,
    748:1.3, 752:0.6, 756:0.7, 760:0.8, 762:1.8, 764:0.3, 768:2.5,
    780:0.3, 784:1.5, 788:1.0, 792:0.5, 795:1.6, 800:3.4, 804:-0.6,
    807:0.1, 818:1.7, 826:0.5, 834:3.0, 840:0.5, 854:2.9, 858:0.4,
    860:1.6, 862:2.8, 887:2.3, 894:2.9,
  };

  function getPopGrowthColor(rate) {
    if (rate === undefined || rate === null) return '#1a2a1a';
    if (rate < 0) {
      // Azalan — kırmızı tonu, ne kadar az o kadar koyu
      const t = Math.min(Math.abs(rate) / 2, 1);
      return `rgb(${Math.round(180 + t*75)},${Math.round(30 - t*30)},${Math.round(30 - t*30)})`;
    } else if (rate < 0.5) {
      // Durağan — beyazımsı/gri
      const t = rate / 0.5;
      return `rgb(${Math.round(220 + t*35)},${Math.round(220 + t*35)},${Math.round(200 + t*55)})`;
    } else if (rate < 2) {
      // Orta artış — sarı/açık yeşil
      const t = (rate - 0.5) / 1.5;
      return `rgb(${Math.round(255 - t*130)},${Math.round(230 - t*30)},${Math.round(100 - t*100)})`;
    } else {
      // Hızlı artış — koyu yeşil
      const t = Math.min((rate - 2) / 2.5, 1);
      return `rgb(${Math.round(125 - t*80)},${Math.round(200 - t*60)},${Math.round(0)})`;
    }
  }

  // ── PETROL REZERVLERİ (milyar varil, kanıtlanmış 2023)
  const OIL_DATA = {
    682:267, 368:145, 784:98, 364:209, 414:102, 784:98,
    862:304, 400:26, 634:25, 784:98, 512:5, 887:3,
    784:98, 48:12, 760:2.5, 336:0,
    // Diğer büyük üreticiler
    643:80, 840:69, 124:170, 156:26, 484:8, 276:0.1,
    288:2, 404:0.4, 710:0.1, 76:13, 170:2, 604:1,
    24:0, 706:0, 818:3.3, 504:0.7, 716:0.2,
    12:12, 434:48, 729:5, 800:0.6, 566:37,
    360:3, 356:4, 586:0.4, 116:0.1, 104:0.1,
    702:0, 608:0.1, 764:0.2, 703:0, 276:0.1,
    840:69, 36:1.5, 578:8, 208:0.1, 826:3,
    250:0.1, 380:0.5, 724:0.2,
  };

  function getOilColor(barrels) {
    if (!barrels || barrels < 0.05) return '#0d1117'; // yok — neredeyse siyah
    if (barrels < 1)   return '#1a3a5c'; // çok az — koyu mavi
    if (barrels < 5)   return '#9933cc'; // az — mor
    if (barrels < 20)  return '#00aacc'; // orta — cyan
    if (barrels < 50)  return '#44dd88'; // önemli — yeşil
    if (barrels < 100) return '#ffdd00'; // büyük — sarı
    if (barrels < 200) return '#ff8800'; // çok büyük — turuncu
    return '#ff2200';                    // devasa — kırmızı
  }

  // ── İNSANİ GELİŞME ENDEKSİ (HDI 0-1, 2022)
  const HDI_DATA = {
    4:0.478, 8:0.796, 12:0.745, 20:0.858, 24:0.586, 28:0.778, 31:0.760,
    32:0.842, 36:0.946, 40:0.926, 44:0.812, 48:0.875, 50:0.661, 51:0.769,
    52:0.790, 56:0.937, 60:0.894, 64:0.666, 68:0.698, 70:0.718, 72:0.693,
    76:0.760, 84:0.700, 96:0.838, 100:0.795, 104:0.585, 108:0.423,
    112:0.801, 116:0.593, 120:0.576, 124:0.936, 132:0.648, 136:0.854,
    140:0.404, 144:0.782, 148:0.394, 152:0.860, 156:0.788, 158:0.926,
    170:0.758, 174:0.558, 175:0.538, 178:0.571, 180:0.481, 188:0.809,
    191:0.871, 192:0.764, 196:0.896, 203:0.895, 204:0.525, 208:0.952,
    212:0.720, 214:0.535, 218:0.765, 222:0.675, 231:0.492, 232:0.492,
    233:0.899, 234:0.961, 246:0.942, 250:0.910, 262:0.509, 266:0.703,
    268:0.812, 270:0.500, 275:0.715, 276:0.950, 288:0.602, 296:0.623,
    300:0.893, 304:0.940, 308:0.741, 312:0.740, 320:0.627, 324:0.465,
    328:0.714, 332:0.535, 340:0.621, 348:0.851, 352:0.959, 356:0.644,
    360:0.705, 364:0.774, 368:0.686, 372:0.945, 376:0.919, 380:0.906,
    388:0.706, 392:0.920, 398:0.802, 400:0.736, 404:0.601, 408:0.766,
    410:0.929, 414:0.831, 417:0.692, 418:0.607, 422:0.706, 426:0.514,
    428:0.879, 430:0.481, 434:0.716, 438:0.935, 440:0.879, 442:0.930,
    450:0.519, 454:0.512, 458:0.803, 462:0.747, 466:0.428, 470:0.918,
    478:0.540, 480:0.802, 484:0.781, 492:0.956, 496:0.737, 498:0.813,
    499:0.832, 504:0.698, 508:0.456, 516:0.615, 524:0.601, 528:0.946,
    531:0.800, 533:0.773, 534:0.810, 558:0.667, 562:0.394, 566:0.548,
    578:0.966, 586:0.544, 591:0.720, 598:0.558, 600:0.717, 604:0.762,
    608:0.710, 616:0.876, 620:0.866, 626:0.607, 630:0.847, 634:0.855,
    638:0.785, 642:0.827, 643:0.821, 646:0.534, 659:0.777, 662:0.730,
    670:0.748, 678:0.618, 682:0.875, 686:0.475, 688:0.805, 690:0.785,
    694:0.477, 703:0.855, 704:0.703, 705:0.926, 706:0.426, 710:0.717,
    716:0.550, 724:0.911, 728:0.381, 729:0.510, 732:0.596, 740:0.730,
    748:0.611, 752:0.952, 756:0.962, 760:0.577, 762:0.685, 764:0.803,
    768:0.539, 780:0.814, 784:0.937, 788:0.731, 792:0.838, 795:0.770,
    800:0.544, 804:0.773, 807:0.770, 818:0.728, 826:0.940, 834:0.532,
    840:0.927, 854:0.449, 858:0.830, 860:0.727, 862:0.699, 887:0.455,
    894:0.565,
  };

  function getHdiColor(hdi) {
    if (!hdi) return '#1a2a1a';
    if (hdi < 0.45) return '#8b0000';      // çok düşük — koyu kırmızı
    if (hdi < 0.55) return '#cc3300';      // düşük — kırmızı
    if (hdi < 0.65) return '#ff8800';      // orta-düşük — turuncu
    if (hdi < 0.75) return '#ffdd00';      // orta — sarı
    if (hdi < 0.80) return '#aadd00';      // orta-yüksek — sarı-yeşil
    if (hdi < 0.85) return '#44cc44';      // yüksek — yeşil
    if (hdi < 0.90) return '#00aacc';      // çok yüksek — cyan
    return '#0055ff';                       // en yüksek — mavi
  }

  // ── TİCARET YOLLARI — önemli deniz güzergahları
  const TRADE_ROUTES = [
    // Kuzey Atlantik
    { name:'Kuzey Atlantik', points:[[-74,41],[-45,42],[-20,46],[-5,48],[2,51],[4,52]], width:4, color:'#00aaff' },
    // Güney Atlantik
    { name:'Güney Atlantik', points:[[-43,-23],[-15,-10],[0,-2],[10,-5],[17,-33]], width:2, color:'#00aaff' },
    // Akdeniz - Süveyş
    { name:'Akdeniz - Süveyş', points:[[-5,36],[5,37],[15,37],[25,35],[32,31],[32,28],[33,25],[38,15],[43,12]], width:4, color:'#ff8800' },
    // Hint Okyanusu
    { name:'Hint Okyanusu', points:[[43,12],[55,13],[65,22],[72,19],[80,10],[90,6],[100,3],[104,1]], width:4, color:'#ff8800' },
    // Malaka - Uzak Doğu
    { name:'Malaka - Asya', points:[[104,1],[108,3],[114,22],[121,31],[130,33],[140,35]], width:5, color:'#ff4400' },
    // Panama - Pasifik
    { name:'Panama - Pasifik', points:[[-79,9],[-90,14],[-105,22],[-120,34],[-130,38],[-145,40],[-155,22],[-158,21]], width:3, color:'#44ff88' },
    // Ümit Burnu
    { name:'Ümit Burnu', points:[[17,-33],[19,-35],[25,-34],[30,-28],[36,-20],[42,-12],[47,-5],[50,0]], width:2, color:'#aaaaff' },
    // Kuzey Denizi - Baltık
    { name:'Kuzey Denizi', points:[[-5,51],[2,52],[5,53],[9,54],[10,56],[15,58],[18,59],[22,60]], width:2, color:'#00aaff' },
  ];

  // Önemli limanlar
  const MAJOR_PORTS = [
    { name:'Şangay', lon:121.5, lat:31.2 },
    { name:'Singapur', lon:103.8, lat:1.3 },
    { name:'Rotterdam', lon:4.5, lat:51.9 },
    { name:'Los Angeles', lon:-118.2, lat:33.7 },
    { name:'Dubai', lon:55.3, lat:25.2 },
    { name:'Hong Kong', lon:114.2, lat:22.3 },
    { name:'Ningbo', lon:121.5, lat:29.9 },
    { name:'Busan', lon:129.0, lat:35.1 },
    { name:'New York', lon:-74.0, lat:40.7 },
    { name:'Hamburg', lon:9.9, lat:53.5 },
    { name:'Antwerp', lon:4.4, lat:51.2 },
    { name:'Süveyş', lon:32.5, lat:29.9 },
    { name:'Panama', lon:-79.5, lat:8.9 },
    { name:'Mumbai', lon:72.8, lat:19.0 },
    { name:'İstanbul', lon:29.0, lat:41.0 },
  ];

  // ── DEPREM RİSKİ (0=yok, 1=düşük, 2=orta, 3=yüksek, 4=çok yüksek)
  const EARTHQUAKE_DATA = {
    // Çok yüksek — Pasifik Ateş Çemberi + Alpin Kuşak
    392:4, 360:4, 604:4, 152:4, 218:4, 170:4, 484:4, 608:4, 764:4,
    356:4, 586:4, 356:4, 792:4, 300:4, 380:4, 724:4, 31:4, 51:4,
    268:4, 364:4, 368:3, 760:3, 400:3, 422:3, 275:3, 376:3, 356:4,
    // Yüksek
    840:3, 124:2, 36:3, 554:3, 458:2, 156:3, 104:3, 116:2, 144:3,
    50:2, 524:3, 4:3, 64:2, 116:2, 704:2, 408:2, 410:3, 860:2,
    496:2, 762:2, 417:2, 398:2, 795:2, 642:2, 100:2, 191:2, 705:2,
    703:2, 196:2, 807:2,
    // Orta
    276:1, 250:1, 826:1, 372:1, 208:1, 752:1, 578:1, 246:1, 233:1,
    428:1, 440:1, 616:1, 804:1, 498:1, 112:1, 566:1, 288:1,
    710:1, 716:1, 404:1,
    // Düşük/yok — Kararlı kratonal bölgeler
    76:1, 32:0, 858:0, 600:0, 124:1, 826:1, 208:0, 752:0,
    36:2, 710:1, 716:0,
  };

  function getEarthquakeColor(risk) {
    const colors = { 0:'#0d1a2a', 1:'#1a4a8a', 2:'#ffcc00', 3:'#ff6600', 4:'#cc0000' };
    return colors[risk] ?? '#0d1a2a';
  }

  // ── AKTİF VOLKANLAR — ülke bazlı risk + nokta konumları
  const VOLCANO_COUNTRY = {
    // Çok aktif
    360:4, 392:4, 604:4, 152:4, 218:4, 840:3, 554:3, 36:3,
    608:4, 764:3, 356:3, 170:3, 124:2, 458:2, 104:2, 116:2,
    792:3, 380:3, 300:3, 724:3, 364:3, 31:3, 51:3, 268:3,
    // Orta aktif
    76:2, 484:2, 862:2, 566:2, 120:2, 800:2, 231:2, 706:2,
    410:2, 626:2, 50:2, 524:2, 704:2,
    // Düşük
    276:1, 250:1, 826:1, 643:1, 840:2,
  };

  // Aktif volkan noktaları [lon, lat, isim]
  const VOLCANO_POINTS = [
    [140.7,36.4,'Fuji (Japonya)'],
    [121.5,14.8,'Mayon (Filipinler)'],
    [-155.3,19.4,'Kilauea (ABD/Hawaii)'],
    [-78.4,-0.7,'Cotopaxi (Ekvador)'],
    [-72.5,-38.7,'Villarrica (Şili)'],
    [107.7,-7.9,'Merapi (Endonezya)'],
    [125.4,1.5,'Soputan (Endonezya)'],
    [28.3,-2.5,'Nyiragongo (Kongo)'],
    [37.7,15.0,'Erta Ale (Etiyopya)'],
    [14.4,40.8,'Vezüv (İtalya)'],
    [25.4,36.4,'Santorini (Yunanistan)'],
    [-17.6,27.7,'Teide (İspanya/Kanarya)'],
    [130.7,31.9,'Sakurajima (Japonya)'],
    [-63.7,16.7,'Soufrière (Montserrat)'],
    [167.8,-16.3,'Yasur (Vanuatu)'],
    [152.2,-4.3,'Tavurvur (Papua YG)'],
    [-91.5,14.5,'Santiaguito (Guatemala)'],
    [176.1,-37.7,'Whakaari (YZ)'],
    [-13.5,28.0,'Cumbre Vieja (Kanarya)'],
    [123.5,52.5,'Klyuchevskaya (Rusya)'],
    [-87.0,12.0,'Momotombo (Nikaragua)'],
    [66.9,54.0,'Shiveluch (Rusya)'],
    [104.7,-8.4,'Semeru (Endonezya)'],
  ];

  function getVolcanoColor(risk) {
    const colors = { 0:'#0d1a0d', 1:'#1a3a1a', 2:'#8b3a00', 3:'#cc5500', 4:'#ff2200' };
    return colors[risk] ?? '#0d1a0d';
  }

  // ── SEL VE TAŞKIN RİSKİ
  const FLOOD_DATA = {
    // Çok yüksek
    50:4, 356:4, 116:4, 104:4, 764:4, 704:4, 720:4, 360:4,
    566:4, 180:4, 800:4, 50:4, 524:4, 608:4, 144:3,
    // Yüksek
    156:3, 586:3, 76:3, 170:3, 218:3, 604:3, 152:3, 484:3,
    716:3, 404:3, 800:3, 706:3, 862:3, 231:3, 120:3, 270:3,
    204:3, 288:3, 324:3, 728:3, 729:3, 140:3,
    // Orta
    276:2, 840:2, 124:2, 826:2, 250:2, 380:2, 724:2, 792:2,
    616:2, 348:2, 642:2, 804:2, 498:2, 458:2, 710:2, 566:2,
    840:2, 300:2, 191:2, 203:2, 703:2,
    // Düşük
    752:1, 578:1, 246:1, 208:1, 372:1, 826:1, 36:1,
    398:1, 860:1, 496:1, 643:1, 682:1, 12:1,
  };

  function getFloodColor(risk) {
    const colors = { 0:'#041018', 1:'#1a3a6a', 2:'#0077cc', 3:'#0099ff', 4:'#00ddff' };
    return colors[risk] ?? '#041018';
  }


  function buildCountries(world, mode) {
    const isPopulation  = mode === 'population';
    const isPopCount    = mode === 'popcount';
    const isPopGrowth   = mode === 'popgrowth';
    const isKoppen      = mode === 'koppen';
    const isTemperature      = mode === 'temperature';
    const isRainfall         = mode === 'rainfall';
    const isDesertification  = mode === 'desertification';
    const isGdp              = mode === 'gdp';
    const isOil              = mode === 'oil';
    const isHdi              = mode === 'hdi';
    const isTrade            = mode === 'trade';
    const isEarthquake       = mode === 'earthquake';
    const isVolcano          = mode === 'volcano';
    const isFlood            = mode === 'flood';
    const isPopMap = isPopulation || isPopCount || isPopGrowth || isTemperature || isRainfall || isDesertification || isGdp || isOil || isHdi || isTrade || isEarthquake || isVolcano || isFlood;

    // Köppen uyarısını temizle (başka mod açıldıysa)
    if (!isKoppen) {
      const oldDisc = document.getElementById('cg-koppen-disc');
      if (oldDisc) oldDisc.remove();
    }
    const allCountries = topojson.feature(world, world.objects.countries);
    const regionCfg = region ? CGI_REGIONS[region] : null;

    // Bölge filtresi
    const countries = regionCfg
      ? { type: 'FeatureCollection', features: allCountries.features.filter(f => regionCfg.ids.has(+f.id)) }
      : allCountries;

    const cgiPaths = {};

    const autoColors = (isPopMap || isKoppen) ? {} : autoColorCountries(countries.features, world);
    if (!isPopMap && !isKoppen) Object.assign(cgiCountryColors, autoColors);

    // Köppen modunda iklim bölgelerini algoritmik olarak boya
    if (isKoppen) {
      // Her ülke path'ini çiz, Köppen algoritmasıyla renklendir
      // Ülkenin centroid koordinatına göre iklim sınıfı belirle
      
      // Ülke bazlı manuel Köppen atamaları (doğruluk için)
      const KOPPEN_MANUAL = {
        // A - Tropikal (koyu mavi/açık mavi tonları)
        50:'Af', 104:'Am', 116:'Af', 180:'Af', 566:'Am', 404:'Am',
        800:'Am', 706:'Bsh', 360:'Af', 764:'Am', 104:'Am', 608:'Af',
        626:'Am', 598:'Af', 76:'Af', 170:'Am', 218:'Af', 604:'Af',
        690:'Af', 174:'Af', 480:'Am',
        // B - Kurak (sarı/turuncu/kahve)
        12:'BWh', 434:'BWh', 504:'BSh', 729:'BWh', 818:'BWh',
        682:'BWh', 400:'BWh', 784:'BWh', 48:'BWh', 512:'BWh',
        634:'BWh', 887:'BWh', 364:'BSk', 398:'BSk', 860:'BSk',
        4:'BWh', 36:'BWh', 516:'BWh', 710:'BSh', 504:'BSh',
        788:'BWh', 368:'BWh', 760:'BWh',
        // C - Ilıman (yeşil tonları)
        792:'Csa', 724:'Csb', 250:'Cfb', 380:'Csa', 300:'Csa',
        620:'Csb', 826:'Cfb', 372:'Cfb', 56:'Cfb', 528:'Cfb',
        276:'Cfb', 756:'Cfb', 40:'Cfb', 196:'Csa', 191:'Cfb',
        705:'Cfb', 203:'Cfb', 703:'Dfb', 688:'Cfb', 642:'Cfb',
        32:'Cfb', 152:'Cfb', 858:'Cfb', 600:'Cfb',
        // D - Kıta (mavi/cyan)
        643:'Dfc', 616:'Dfb', 348:'Dfb', 752:'Dfc', 246:'Dfc',
        233:'Dfb', 428:'Dfb', 440:'Dfb', 112:'Dfb', 124:'Dfc',
        840:'Dfb', 496:'BSk', 156:'Dwa', 392:'Cfa',
        // E - Kutup
        304:'ET', 352:'ET',
      };

      const KOPPEN_COLORS = {
        // A - Tropikal
        'Af': '#0000ff',  // Tropikal yağmur ormanı
        'Am': '#0077ff',  // Tropikal muson
        'Aw': '#46aafa',  // Tropikal savan
        // B - Kurak
        'BWh': '#ff0000', // Sıcak çöl
        'BWk': '#ff9999', // Soğuk çöl
        'BSh': '#f4a460', // Sıcak step
        'BSk': '#d2b48c', // Soğuk step
        // C - Ilıman
        'Csa': '#ffff00', // Akdeniz (yaz kuru)
        'Csb': '#c8ff00', // Akdeniz (serin)
        'Cfa': '#00ff00', // Nem li subtropikal
        'Cfb': '#00c800', // Okyanus iklimi
        'Cfc': '#008000', // Serin okyanus
        // D - Kıta
        'Dfa': '#00ffff', // Nemli kıta
        'Dfb': '#00c8c8', // Nemli kıta (serin)
        'Dfc': '#007d7d', // Subarktik
        'Dwa': '#9900ff', // Kışı kuru kıta
        'Dwb': '#7700dd',
        // E - Kutup
        'ET':  '#b2b2b2', // Tundra
        'EF':  '#ffffff', // Buz örtüsü
      };

      function getKoppenColor(id, centroid) {
        const manual = KOPPEN_MANUAL[id];
        if (manual) return KOPPEN_COLORS[manual] || '#1e3222';
        // Koordinat bazlı tahmin
        if (!centroid || isNaN(centroid[0])) return '#1e3222';
        const [px, py] = centroid;
        // Projeksiyon tersine çevir
        let lonlat;
        try { lonlat = cgiProjection.invert([px, py]); } catch(e) { return '#1e3222'; }
        if (!lonlat) return '#1e3222';
        const lat = lonlat[1];
        const lon = lonlat[0];
        if (Math.abs(lat) > 65) return KOPPEN_COLORS['ET'];
        if (Math.abs(lat) > 55) return KOPPEN_COLORS['Dfc'];
        if (Math.abs(lat) > 40) return KOPPEN_COLORS['Dfb'];
        if (Math.abs(lat) > 25) return KOPPEN_COLORS['Cfb'];
        if (Math.abs(lat) > 15) return KOPPEN_COLORS['BSh'];
        return KOPPEN_COLORS['Af'];
      }

      cgiG.selectAll('.cgi-country')
        .data(countries.features)
        .join('path')
          .attr('class', 'cgi-country')
          .attr('d', cgiPath)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('stroke', 'rgba(0,0,0,0.4)')
          .style('stroke-width', '0.5px')
          .style('fill', d => {
            const id = +d.id;
            let centroid;
            try { centroid = cgiPath.centroid(d); } catch(e) {}
            return getKoppenColor(id, centroid);
          })
          .on('mousemove', (event, d) => {
            const id = +d.id;
            const name = COUNTRY_NAMES && COUNTRY_NAMES[id] ? COUNTRY_NAMES[id] : '';
            const k = KOPPEN_MANUAL[id] || '';
            const klabel = {
              'Af':'Tropikal Yağmur Ormanı','Am':'Tropikal Muson','Aw':'Tropikal Savan',
              'BWh':'Sıcak Çöl','BWk':'Soğuk Çöl','BSh':'Sıcak Step','BSk':'Soğuk Step',
              'Csa':'Akdeniz (yaz kuru)','Csb':'Akdeniz (serin)','Cfa':'Nemli Subtropikal',
              'Cfb':'Okyanus','Cfc':'Serin Okyanus','Dfa':'Nemli Kıta','Dfb':'Nemli Kıta (serin)',
              'Dfc':'Subarktik','Dwa':'Kışı Kuru Kıta','ET':'Tundra','EF':'Buz Örtüsü',
            }[k] || '';
            tooltip.style.display = 'block';
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top  = (event.offsetY - 22) + 'px';
            tooltip.textContent = name + (klabel ? ` — ${k}: ${klabel}` : '');
          })
          .on('mouseleave', () => { tooltip.style.display = 'none'; })
          .on('click', null);

      // Merkez uyarı overlay
      const disc = document.createElement('div');
      disc.id = 'cg-koppen-disc';
      disc.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(8,12,16,0.95);border:1px solid rgba(255,200,0,0.4);padding:18px 20px;font-family:Space Mono,monospace;font-size:10px;letter-spacing:1px;color:rgba(255,200,0,0.9);z-index:20;border-radius:4px;max-width:260px;text-align:center;line-height:1.8';
      disc.innerHTML = `
        <div style="font-size:18px;margin-bottom:8px">⚠️</div>
        <div style="margin-bottom:12px">${t('koppen_disc_text')||'Her ülke <b>genel baskın iklimiyle</b> gösterilmiştir.<br>Gerçekte bir ülke içinde birden fazla iklim bölgesi bulunabilir.'}</div>
        <button onclick="document.getElementById('cg-koppen-disc').remove()" style="font-family:Space Mono,monospace;font-size:9px;letter-spacing:1px;padding:6px 16px;border:1px solid rgba(255,200,0,0.5);background:transparent;color:rgba(255,200,0,0.9);cursor:pointer;text-transform:uppercase">✕ ${t('koppen_disc_ok')||'Tamam'}</button>
      `;
      document.getElementById('cg-imap-svg-container').appendChild(disc);

      // fitExtent
      const fcKop = { type:'FeatureCollection', features: countries.features };
      const [[kx0,ky0],[kx1,ky1]] = cgiPath.bounds(fcKop);
      const kpad = 24;
      const kScale = Math.min((w-kpad*2)/(kx1-kx0),(h-kpad*2)/(ky1-ky0));
      const ktx = (w-(kx0+kx1)*kScale)/2;
      const kty = (h-(ky0+ky1)*kScale)/2;
      cgiSvg.call(cgiZoom.transform, d3.zoomIdentity.translate(ktx,kty).scale(kScale));

      window._cgiRedrawLabels = () => {};
      window._cgiLabelData = [];
      cgiUpdateCounter();
      cgiShowLegend('koppen');
      return;
    }

    cgiG.selectAll('.cgi-country')
      .data(countries.features)
      .join('path')
        .attr('class', 'cgi-country')
        .attr('d', cgiPath)
        .attr('stroke-width', cgiBaseStroke)
        .style('fill', d => {
          const id = +d.id;
          if (isPopulation)  return getPopColor(POPULATION_DENSITY[id]);
          if (isPopCount)    return getPopCountColor(POPULATION_COUNT[id]);
          if (isPopGrowth)   return getPopGrowthColor(POPULATION_GROWTH[id]);
          if (isTemperature)     return getTempColor(TEMPERATURE_DATA[id]);
          if (isRainfall)        return getRainfallColor(RAINFALL_DATA[id]);
          if (isDesertification) return getDesertificationColor(DESERTIFICATION_DATA[id]);
          if (isGdp)             return getGdpColor(GDP_DATA[id]);
          if (isOil)             return getOilColor(OIL_DATA[id]);
          if (isHdi)             return getHdiColor(HDI_DATA[id]);
          if (isTrade)           return '#1a2a1a';
          if (isEarthquake)      return getEarthquakeColor(EARTHQUAKE_DATA[id] ?? 0);
          if (isVolcano)         return getVolcanoColor(VOLCANO_COUNTRY[id] ?? 0);
          if (isFlood)           return getFloodColor(FLOOD_DATA[id] ?? 0);
          return autoColors[id] || '#1e3222';
        })
        .each(function(d) {
          const id = +d.id;
          const area = cgiPath.area(d);
          if (!cgiPaths[id] || area > (cgiPaths[id].__area || 0)) {
            this.__area = area;
            cgiPaths[id] = this;
          }
        })
        .on('mousemove', (event, d) => {
          const id = +d.id;
          const name = (COUNTRY_NAMES && COUNTRY_NAMES[id]) ? COUNTRY_NAMES[id] : ('ID:' + id);
          let tip = name;
          if (isPopulation && POPULATION_DENSITY[id]) tip += ` — ${POPULATION_DENSITY[id]} kişi/km²`;
          if (isPopCount && POPULATION_COUNT[id]) {
            const p = POPULATION_COUNT[id];
            tip += ` — ${p >= 1 ? p.toFixed(0) + ' mn' : (p*1000).toFixed(0) + ' bin'}`;
          }
          if (isPopGrowth && POPULATION_GROWTH[id] !== undefined) {
            const g = POPULATION_GROWTH[id];
            tip += ` — %${g > 0 ? '+' : ''}${g.toFixed(1)} / yıl`;
          }
          if (isTemperature && TEMPERATURE_DATA[id] !== undefined) tip += ` — ${TEMPERATURE_DATA[id]}°C`;
          if (isRainfall && RAINFALL_DATA[id]) tip += ` — ${RAINFALL_DATA[id]} mm/yıl`;
          if (isGdp && GDP_DATA[id]) {
            const g = GDP_DATA[id];
            tip += g >= 1000 ? ` — $${(g/1000).toFixed(1)} trilyon` : ` — $${g} milyar`;
          }
          if (isOil && OIL_DATA[id]) tip += ` — ${OIL_DATA[id]} milyar varil`;
          if (isHdi && HDI_DATA[id]) tip += ` — HDI: ${HDI_DATA[id].toFixed(3)}`;
          if (isEarthquake) {
            const r = EARTHQUAKE_DATA[id] ?? 0;
            const rl = ['Risk Yok','Düşük','Orta','Yüksek','Çok Yüksek'];
            tip += ` — Deprem Riski: ${rl[r]}`;
          }
          if (isVolcano) {
            const r = VOLCANO_COUNTRY[id] ?? 0;
            const rl = ['Volkan Yok','Düşük','Orta','Aktif','Çok Aktif'];
            tip += ` — Volkanik Aktivite: ${rl[r]}`;
          }
          if (isFlood) {
            const r = FLOOD_DATA[id] ?? 0;
            const rl = ['Risk Yok','Düşük','Orta','Yüksek','Çok Yüksek'];
            tip += ` — Sel Riski: ${rl[r]}`;
          }
          if (isDesertification && DESERTIFICATION_DATA[id]) {
            const dl = {'very_high':'Çok Yüksek Risk','high':'Yüksek Risk','medium':'Orta Risk','low':'Düşük Risk','none':'Risk Yok'};
            tip += ` — ${dl[DESERTIFICATION_DATA[id]] || ''}`;
          }
          tooltip.style.display = 'block';
          tooltip.style.left = (event.offsetX + 12) + 'px';
          tooltip.style.top  = (event.offsetY - 22) + 'px';
          tooltip.textContent = tip;
        })
        .on('mouseleave', () => { tooltip.style.display = 'none'; })
        .on('click', isPopMap ? null : (event, d) => {
          const id = +d.id;
          if (cgiCountryColors[id] === cgiSelectedColor) {
            delete cgiCountryColors[id];
            d3.select(event.currentTarget).style('fill', '#1e3222');
          } else {
            cgiCountryColors[id] = cgiSelectedColor;
            d3.select(event.currentTarget).style('fill', cgiSelectedColor);
          }
          cgiUpdateCounter();
        });

    // Label layer — sadece siyasi modda
    const labelG = cgiG.append('g').attr('class', 'cgi-label-layer').style('pointer-events', 'none');
    window._cgiLabelData = [];

    if (!isPopMap) {

    const areaById = {};
    countries.features.forEach(f => {
      const id = +f.id;
      const a = cgiPath.area(f);
      if (!areaById[id] || a > areaById[id]) areaById[id] = a;
    });


    // Manuel koordinat düzeltmeleri — çok parçalı ülkeler için
    const MANUAL_CENTROIDS = {
      250: [2.5, 46.5],      // Fransa (ana kara)
      528: [5.3, 52.1],      // Hollanda
      208: [10.0, 56.0],     // Danimarka (ana kara)
      616: [19.5, 52.0],     // Polonya
      724: [-3.7, 40.4],     // İspanya (ana kara)
      566: [8.0, 9.0],       // Nijerya
      710: [25.0, -29.0],    // Güney Afrika
      764: [101.0, 15.5],    // Tayland
      360: [118.0, -2.5],    // Endonezya
      840: [-96.0, 38.0],    // ABD (ana kara)
      124: [-96.0, 60.0],    // Kanada
      643: [60.0, 60.0],     // Rusya
      36: [134.0, -25.0],    // Avustralya
    };

    countries.features.forEach(f => {
      const id = +f.id;
      const name = getCountryName(id) || COUNTRY_NAMES[id];
      if (!name) return;

      let cx, cy;

      if (MANUAL_CENTROIDS[id]) {
        // Manuel koordinat — projeksiyon üzerinden dönüştür
        const proj = cgiProjection(MANUAL_CENTROIDS[id]);
        if (!proj || isNaN(proj[0])) return;
        cx = proj[0]; cy = proj[1];
      } else if (f.geometry && f.geometry.type === 'MultiPolygon') {
        // En büyük parçanın centroid'ini al
        let bestArea = -1, bestCx, bestCy;
        f.geometry.coordinates.forEach(polyCoords => {
          const singleFeature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: polyCoords } };
          const a = cgiPath.area(singleFeature);
          if (a > bestArea) {
            bestArea = a;
            const c = cgiPath.centroid(singleFeature);
            if (c && !isNaN(c[0])) { bestCx = c[0]; bestCy = c[1]; }
          }
        });
        if (bestCx === undefined) return;
        cx = bestCx; cy = bestCy;
      } else {
        try {
          const c = cgiPath.centroid(f);
          if (!c || isNaN(c[0]) || isNaN(c[1])) return;
          cx = c[0]; cy = c[1];
        } catch(e) { return; }
      }

      const area = areaById[id] || 1;
      const displayName = name.length > 18 ? name.split(' ').slice(0, 2).join(' ') : name;
      const minZoom = area > 3000 ? 0.3
                    : area > 500  ? 0.8
                    : area > 50   ? 2.0
                    :               4.0;

      window._cgiLabelData.push({ cx, cy, displayName, area, minZoom });
    });

    } // end if (!isPopulation)

    function cgiRedrawLabels(transform) {
      const k = transform ? transform.k : 1;
      labelG.selectAll('text')
        .style('display', function() {
          const mz = +d3.select(this).attr('data-minzoom');
          return k >= mz ? null : 'none';
        })
        .attr('font-size', function() {
          const base = +d3.select(this).attr('data-basesize');
          return (base / k) + 'px';
        });
    }

    // Text elementlerini bir kez oluştur — sadece siyasi modda
    if (!isPopMap) {
      window._cgiLabelData.forEach(({ cx, cy, displayName, area, minZoom }) => {
        const fontSize = area > 5000 ? 14
                       : area > 2000 ? 12
                       : area > 600  ? 10
                       : area > 100  ? 8
                       : 7;
        labelG.append('text')
          .attr('x', cx)
          .attr('y', cy)
          .attr('data-minzoom', minZoom)
          .attr('data-basesize', fontSize)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-family', 'Space Mono, monospace')
          .attr('font-size', fontSize + 'px')
          .attr('font-weight', '700')
          .attr('fill', 'rgba(255,255,255,0.95)')
          .attr('stroke', 'rgba(0,0,0,0.8)')
          .attr('stroke-width', '0.5px')
          .attr('paint-order', 'stroke')
          .attr('letter-spacing', '0.4px')
          .attr('vector-effect', 'non-scaling-stroke')
          .text(displayName);
      });
    }

    // Nüfus modunda legend göster
    // Ticaret yolları modu — güzergahları ve limanları çiz
    if (isTrade) {
      const tradeG = cgiG.append('g').attr('class', 'cgi-trade-layer').style('pointer-events', 'none');
      const lineGen = d3.line()
        .x(d => cgiProjection(d)[0])
        .y(d => cgiProjection(d)[1])
        .curve(d3.curveCatmullRom);

      TRADE_ROUTES.forEach(route => {
        tradeG.append('path')
          .datum(route.points)
          .attr('d', lineGen)
          .attr('fill', 'none')
          .attr('stroke', route.color)
          .attr('stroke-width', route.width)
          .attr('stroke-opacity', 0.75)
          .attr('vector-effect', 'non-scaling-stroke');
      });

      // Limanlar — cgiG dışında ayrı overlay (zoom'da büyümez)
      const portOverlay = document.createElement('canvas');
      portOverlay.id = 'cgi-port-overlay';
      portOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:3';
      container.appendChild(portOverlay);

      const portDotG = cgiSvg.append('g').attr('class','cgi-port-dots').style('pointer-events','all');

      MAJOR_PORTS.forEach(port => {
        const [px, py] = cgiProjection([port.lon, port.lat]);
        portDotG.append('circle')
          .attr('cx', px).attr('cy', py)
          .attr('r', 2)
          .attr('fill', '#ffcc00')
          .attr('stroke', '#000')
          .attr('stroke-width', 0.5)
          .attr('vector-effect', 'non-scaling-stroke')
          .style('pointer-events', 'all')
          .on('mousemove', (event) => {
            tooltip.style.display = 'block';
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top  = (event.offsetY - 22) + 'px';
            tooltip.textContent = '⚓ ' + port.name;
          })
          .on('mouseleave', () => { tooltip.style.display = 'none'; });
      });

      // Liman isimleri — ayrı g, zoom'a göre yeniden çizilir
      const portLabelG = cgiSvg.append('g').attr('class','cgi-port-labels').style('pointer-events','none');

      function updatePortLabels(transform) {
        portLabelG.selectAll('*').remove();
        const k = transform ? transform.k : 1;
        if (k < 2.5) return;
        const tx = transform ? transform.x : 0;
        const ty = transform ? transform.y : 0;
        const sw = container.clientWidth, sh = container.clientHeight;
        MAJOR_PORTS.forEach(port => {
          const [px, py] = cgiProjection([port.lon, port.lat]);
          const sx = px * k + tx, sy = py * k + ty;
          if (sx < 0 || sx > sw || sy < 0 || sy > sh) return;
          portLabelG.append('text')
            .attr('x', sx).attr('y', sy - 7)
            .attr('text-anchor', 'middle')
            .attr('font-family', 'Space Mono, monospace')
            .attr('font-size', '9px')
            .attr('font-weight', '700')
            .attr('fill', '#ffcc00')
            .attr('stroke', 'rgba(0,0,0,0.9)')
            .attr('stroke-width', '2.5px')
            .attr('paint-order', 'stroke')
            .text(port.name);
        });
      }
      updatePortLabels(null);
      window._cgiTradeLabels = updatePortLabels;

      // port dot'ları zoom'a göre konumlandır
      function updatePortDots(transform) {
        portDotG.attr('transform', transform ? `translate(${transform.x},${transform.y}) scale(${transform.k})` : '');
      }
      window._cgiPortDots = updatePortDots;
    }

    // Volkan noktaları
    if (isVolcano) {
      const volcG = cgiG.append('g').attr('class','cgi-volcano-layer').style('pointer-events','all');
      VOLCANO_POINTS.forEach(([lon, lat, name]) => {
        const [px, py] = cgiProjection([lon, lat]);
        volcG.append('circle')
          .attr('cx', px).attr('cy', py)
          .attr('r', 3)
          .attr('fill', '#ff4400')
          .attr('stroke', '#ffcc00')
          .attr('stroke-width', 0.8)
          .attr('vector-effect', 'non-scaling-stroke')
          .on('mousemove', (event) => {
            tooltip.style.display = 'block';
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top  = (event.offsetY - 22) + 'px';
            tooltip.textContent = '🌋 ' + name;
          })
          .on('mouseleave', () => { tooltip.style.display = 'none'; });
      });
    }
    cgiShowLegend(mode);

    window._cgiRedrawLabels = cgiRedrawLabels;

    // Haritayı ekrana sığdır — label sistemi hazır olduktan sonra
    if (region) {
      const featureCollection = { type: 'FeatureCollection', features: countries.features };
      const [[x0,y0],[x1,y1]] = cgiPath.bounds(featureCollection);
      const pad = 24;
      const fitScale = Math.min((w - pad*2) / (x1 - x0), (h - pad*2) / (y1 - y0));
      const tx = (w - (x0 + x1) * fitScale) / 2;
      const ty = (h - (y0 + y1) * fitScale) / 2;
      const initTransform = d3.zoomIdentity.translate(tx, ty).scale(fitScale);
      cgiSvg.call(cgiZoom.transform, initTransform);
    }

    // Küçük ülkeler nokta olarak — sadece dünya ve Avrupa/Amerika haritalarında
    const SMALL = window._smallCountries || {};
    const noDotsRegions = new Set(['africa', 'asia', 'middleeast']);
    if (!noDotsRegions.has(region)) {
      const missingSmall = {};
      countries.features.forEach(f => {
        const id = +f.id;
        if (SMALL[id]) {
          const b = cgiPath.bounds(f);
          if ((b[1][0]-b[0][0]) < 2 && (b[1][1]-b[0][1]) < 2) missingSmall[id] = SMALL[id];
        }
        if (!cgiPaths[+f.id]) {
          if (SMALL[+f.id]) missingSmall[+f.id] = SMALL[+f.id];
        }
      });
      if (!region) Object.keys(SMALL).forEach(id => { if (!cgiPaths[+id]) missingSmall[+id] = SMALL[+id]; });

      Object.entries(missingSmall).forEach(([id, info]) => {
        const [x, y] = cgiProjection([info.lon, info.lat]);
        const c = autoColors[+id] || AUTO_COLORS[+id % AUTO_COLORS.length];
        cgiCountryColors[+id] = c;
        cgiG.append('circle')
          .attr('class', 'cgi-country cgi-small-dot')
          .attr('cx', x).attr('cy', y)
          .attr('r', 2.5)
          .attr('data-id', id)
          .style('fill', c)
          .on('mousemove', (event) => {
            tooltip.style.display = 'block';
            tooltip.style.left = (event.offsetX + 12) + 'px';
            tooltip.style.top  = (event.offsetY - 22) + 'px';
            tooltip.textContent = (COUNTRY_NAMES && COUNTRY_NAMES[+id]) ? COUNTRY_NAMES[+id] : info.name;
          })
          .on('mouseleave', () => { tooltip.style.display = 'none'; })
          .on('click', (event) => {
            const cid = +id;
            if (cgiCountryColors[cid] === cgiSelectedColor) {
              delete cgiCountryColors[cid];
              d3.select(event.currentTarget).style('fill', '#1e3222');
            } else {
              cgiCountryColors[cid] = cgiSelectedColor;
              d3.select(event.currentTarget).style('fill', cgiSelectedColor);
            }
            cgiUpdateCounter();
          });
      });
    }

    cgiUpdateCounter();
  }

  if (window._worldData) {
    buildCountries(window._worldData, mode);
  } else {
    loadWorldAtlas()
      .then(world => {
        buildCountries(world, mode);
      })
      .catch(() => { /* hata banner'ı loadWorldAtlas() içinde gösterildi */ });
  }

  // Ekran yeniden boyutlanınca haritayı güncelle
  const resizeObs = new ResizeObserver(() => {
    const nw = container.clientWidth;
    const nh = container.clientHeight;
    if (!nw || !nh) return;
    cgiProjection.scale(nw / 6.2).translate([nw / 2, nh / 2 + 20]);
    cgiPath = d3.geoPath().projection(cgiProjection);
    cgiG.selectAll('.cgi-country:not(.cgi-small-dot)').attr('d', cgiPath);
    cgiG.selectAll('.cgi-graticule').attr('d', cgiPath);
    cgiSvg.call(cgiZoom.transform, d3.zoomIdentity);
  });
  resizeObs.observe(container);
}

// ══════════════════════════════════════════════
function cgCloseModal() {
  if (document.getElementById('cg-map-zoom-wrap').classList.contains('cg-fullscreen')) {
    cgToggleFullscreen();
  }
  document.getElementById('cg-modal').classList.remove('open');
  document.getElementById('cg-modal-svg-wrap').innerHTML = '';
  cgZoomReset();
}

let cgIsFullscreen = false;
function cgToggleFullscreen() {
  const wrap = document.getElementById('cg-map-zoom-wrap');
  const closeBtn = document.getElementById('cg-fs-close');
  const fsBtn = document.getElementById('cg-fs-btn');
  cgIsFullscreen = !cgIsFullscreen;
  if (cgIsFullscreen) {
    wrap.classList.add('cg-fullscreen');
    closeBtn.classList.add('show');
    fsBtn.textContent = '⛶';
    document.body.style.overflow = 'hidden';
  } else {
    wrap.classList.remove('cg-fullscreen');
    closeBtn.classList.remove('show');
    fsBtn.textContent = '⛶';
    document.body.style.overflow = '';
    cgZoomReset();
  }
}

// ── Pinch-to-zoom + Pan ──
let cgScale = 1, cgPanX = 0, cgPanY = 0;
let cgLastDist = 0, cgLastMidX = 0, cgLastMidY = 0;
let cgDragging = false, cgDragStartX = 0, cgDragStartY = 0, cgDragPanX = 0, cgDragPanY = 0;
const CG_MIN_SCALE = 1, CG_MAX_SCALE = 8;

function cgZoomReset() {
  cgScale = 1; cgPanX = 0; cgPanY = 0;
  const inner = document.getElementById('cg-map-zoom-inner');
  if (inner) inner.style.transform = '';
}

function cgApplyTransform() {
  const wrap = document.getElementById('cg-map-zoom-wrap');
  const inner = document.getElementById('cg-map-zoom-inner');
  if (!inner || !wrap) return;
  // Sınırla
  const ww = wrap.offsetWidth, ih = inner.offsetHeight * cgScale;
  const maxPanX = Math.max(0, ww * cgScale - ww) / 2;
  const maxPanY = Math.max(0, ih - wrap.offsetHeight) / 2;
  cgPanX = Math.max(-maxPanX, Math.min(maxPanX, cgPanX));
  cgPanY = Math.max(-maxPanY, Math.min(maxPanY, cgPanY));
  inner.style.transform = `translate(${cgPanX}px,${cgPanY}px) scale(${cgScale})`;
  inner.style.transformOrigin = 'center top';
}

function cgInitZoom() {
  const wrap = document.getElementById('cg-map-zoom-wrap');
  if (!wrap || wrap._cgZoomInited) return;
  wrap._cgZoomInited = true;
  cgZoomReset();

  // Touch: pinch zoom + pan
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const t = e.touches;
      cgLastDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      cgLastMidX = (t[0].clientX + t[1].clientX) / 2;
      cgLastMidY = (t[0].clientY + t[1].clientY) / 2;
    } else if (e.touches.length === 1 && cgScale > 1) {
      cgDragging = true;
      cgDragStartX = e.touches[0].clientX;
      cgDragStartY = e.touches[0].clientY;
      cgDragPanX = cgPanX; cgDragPanY = cgPanY;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t = e.touches;
      const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      const delta = dist / cgLastDist;
      cgScale = Math.max(CG_MIN_SCALE, Math.min(CG_MAX_SCALE, cgScale * delta));
      cgLastDist = dist;
      cgApplyTransform();
    } else if (e.touches.length === 1 && cgDragging) {
      cgPanX = cgDragPanX + (e.touches[0].clientX - cgDragStartX);
      cgPanY = cgDragPanY + (e.touches[0].clientY - cgDragStartY);
      cgApplyTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', () => { cgDragging = false; });

  // Double tap to zoom in/reset
  let cgLastTap = 0;
  wrap.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - cgLastTap < 300) {
      if (cgScale > 1) { cgScale = 1; cgPanX = 0; cgPanY = 0; }
      else { cgScale = 3; }
      cgApplyTransform();
    }
    cgLastTap = now;
  });
}


// Topbar: masaüstünde dikey fare tekerleği hareketini yatay kaydırmaya çevir
(function initTopbarWheelScroll() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  topbar.addEventListener('wheel', function (e) {
    // Zaten yatay bir hareket varsa (trackpad shift+scroll vb.) dokunma
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;
    e.preventDefault();
    topbar.scrollLeft += e.deltaY;
  }, { passive: false });
})();

function cgGetPattern(id) {
  const BG_OCEAN = '#0d2137';
  const DUNYA = '<rect width="200" height="133" fill="' + BG_OCEAN + '"/>'
    + '<rect width="200" height="133" fill="#0a1a2a"/>'
    // Kuzey Amerika
    + '<path d="M5,15 Q15,8 28,10 Q42,8 50,18 Q58,26 56,40 Q54,52 46,60 Q36,68 24,70 Q14,66 8,56 Q2,44 3,30 Z" fill="#1a6b3e" stroke="#2ecc71" stroke-width="0.6" opacity="0.9"/>'
    // Güney Amerika
    + '<path d="M30,74 Q42,68 52,74 Q60,82 60,96 Q58,112 50,120 Q40,126 30,122 Q20,116 16,102 Q14,88 20,80 Z" fill="#155c32" stroke="#27ae60" stroke-width="0.6" opacity="0.9"/>'
    // Avrupa
    + '<path d="M84,14 Q94,8 104,12 Q114,16 116,26 Q118,36 110,42 Q100,48 90,44 Q80,40 78,30 Q76,20 84,14 Z" fill="#1a5c8a" stroke="#3498db" stroke-width="0.6" opacity="0.9"/>'
    // Afrika
    + '<path d="M88,48 Q102,42 114,48 Q126,54 128,68 Q130,84 124,98 Q116,112 104,118 Q92,122 82,114 Q72,106 70,90 Q68,74 72,62 Q78,52 88,48 Z" fill="#8a6a08" stroke="#f4d03f" stroke-width="0.6" opacity="0.9"/>'
    // Asya
    + '<path d="M108,8 Q132,4 158,8 Q178,12 188,26 Q194,40 190,56 Q184,70 168,78 Q150,84 132,80 Q114,76 106,62 Q98,48 100,34 Q104,18 108,8 Z" fill="#1a6b3e" stroke="#2ecc71" stroke-width="0.5" opacity="0.85"/>'
    // Avustralya
    + '<path d="M152,86 Q166,80 178,86 Q188,92 188,104 Q186,116 174,120 Q160,124 150,116 Q140,108 140,98 Q140,88 152,86 Z" fill="#7a3a1a" stroke="#e67e22" stroke-width="0.6" opacity="0.9"/>'
    // Ekvator çizgisi
    + '<line x1="0" y1="72" x2="200" y2="72" stroke="#fff" stroke-width="0.4" opacity="0.15" stroke-dasharray="4,6"/>';

  const AVRUPA = '<rect width="200" height="133" fill="#0c1e30"/>'
    // İskandinavya
    + '<path d="M96,6 Q108,2 118,10 Q124,18 122,32 Q118,42 108,46 Q98,48 90,40 Q82,30 84,18 Q88,8 96,6 Z" fill="#1a6b8a" stroke="#5dade2" stroke-width="0.7" opacity="0.95"/>'
    // Britanya
    + '<path d="M72,20 Q80,14 88,18 Q94,24 92,34 Q88,42 80,44 Q72,42 68,34 Q66,26 72,20 Z" fill="#2471a3" stroke="#5dade2" stroke-width="0.6" opacity="0.9"/>'
    // Fransa + İspanya
    + '<path d="M76,46 Q90,40 104,44 Q114,50 114,62 Q112,74 100,80 Q86,84 74,78 Q64,70 64,58 Q64,50 76,46 Z" fill="#1a6b4b" stroke="#27ae60" stroke-width="0.6" opacity="0.95"/>'
    // Almanya + Orta Avrupa
    + '<path d="M104,40 Q120,34 136,38 Q148,44 148,56 Q146,68 134,74 Q120,78 108,72 Q96,64 96,54 Q98,44 104,40 Z" fill="#1e5c7a" stroke="#3498db" stroke-width="0.6" opacity="0.95"/>'
    // İtalya
    + '<path d="M106,74 Q114,70 120,76 Q126,86 124,100 Q120,112 114,116 Q108,112 104,100 Q100,88 106,74 Z" fill="#784212" stroke="#e67e22" stroke-width="0.6" opacity="0.9"/>'
    // Balkanlar + Doğu Avrupa
    + '<path d="M136,40 Q158,34 170,42 Q180,52 178,66 Q174,78 160,84 Q146,88 134,80 Q124,70 124,58 Q126,46 136,40 Z" fill="#1a5276" stroke="#2980b9" stroke-width="0.6" opacity="0.9"/>';

  const TURKIYE = '<rect width="200" height="133" fill="#0a180a"/>'
    // Karadeniz
    + '<path d="M28,18 Q80,10 120,12 Q160,14 174,28 Q178,38 168,42 Q120,38 80,36 Q46,36 28,44 Q20,38 20,28 Z" fill="#0d3a5c" opacity="0.85"/>'
    // Türkiye ana gövde
    + '<path d="M18,46 Q36,36 64,34 Q100,30 130,32 Q160,34 176,42 Q188,52 186,64 Q182,76 164,82 Q136,90 100,92 Q66,92 42,84 Q22,76 16,64 Q12,56 18,46 Z" fill="#c0392b" stroke="#e74c3c" stroke-width="1" opacity="0.95"/>'
    // İç yapı vurgusu
    + '<path d="M64,38 Q100,34 140,36 Q160,38 172,46 Q170,60 154,66 Q120,72 90,72 Q62,70 46,62 Q38,56 42,48 Q52,40 64,38 Z" fill="#e74c3c" opacity="0.2"/>'
    // Boğaz
    + '<line x1="62" y1="34" x2="58" y2="62" stroke="#4fc3f7" stroke-width="2" opacity="0.9"/>'
    // Akdeniz
    + '<path d="M16,86 Q80,96 130,92 Q170,88 188,76 Q192,96 180,108 Q120,118 60,112 Q20,104 10,92 Z" fill="#0d3a5c" opacity="0.75"/>'
    // Ankara
    + '<circle cx="108" cy="58" r="4" fill="#f4d03f" opacity="0.95"/>'
    + '<text x="116" y="56" font-size="7" fill="#f4d03f" font-family="monospace" font-weight="bold">ANKARA</text>';

  const ASYA = '<rect width="200" height="133" fill="#081a08"/>'
    + '<path d="M6,10 Q50,4 90,6 Q130,6 160,14 Q184,22 194,40 Q198,58 190,74 Q178,90 156,100 Q130,110 100,112 Q70,114 46,106 Q22,96 10,78 Q0,60 2,40 Q4,22 6,10 Z" fill="#1a6b3e" stroke="#27ae60" stroke-width="0.6" opacity="0.9"/>'
    // Hindistan
    + '<path d="M86,96 Q96,92 108,96 Q116,106 114,120 Q108,130 100,132 Q90,130 84,118 Q80,106 86,96 Z" fill="#155c2a" stroke="#2ecc71" stroke-width="0.5" opacity="0.85"/>'
    // Japonya/SE Asya ipucu
    + '<ellipse cx="175" cy="88" rx="12" ry="18" fill="#1a4a2a" stroke="#2ecc71" stroke-width="0.4" opacity="0.7"/>';

  const AFRIKA = '<rect width="200" height="133" fill="#140e00"/>'
    + '<path d="M56,4 Q80,0 106,4 Q130,8 146,20 Q160,34 164,52 Q166,70 158,88 Q146,106 128,118 Q108,128 88,128 Q68,128 52,116 Q36,104 28,84 Q22,64 24,46 Q28,28 40,16 Q48,8 56,4 Z" fill="#8a6a08" stroke="#f4d03f" stroke-width="0.7" opacity="0.95"/>'
    // Sahra
    + '<path d="M24,46 Q28,34 40,28 Q80,20 120,22 Q150,24 162,36 Q164,52 158,56 Q120,52 80,50 Q40,50 24,58 Z" fill="#c87a08" opacity="0.25"/>'
    // Madagaskar
    + '<path d="M168,54 Q178,50 184,58 Q188,70 184,88 Q178,100 170,100 Q162,96 160,82 Q158,66 168,54 Z" fill="#7a5808" stroke="#f4d03f" stroke-width="0.4" opacity="0.8"/>';

  const ORTADOGU = '<rect width="200" height="133" fill="#160a00"/>'
    // Arap Yarımadası
    + '<path d="M70,30 Q100,24 128,28 Q154,34 168,50 Q178,66 174,86 Q166,108 148,120 Q124,130 98,126 Q74,120 58,102 Q44,84 46,64 Q48,46 70,30 Z" fill="#c87408" stroke="#f4d03f" stroke-width="0.7" opacity="0.9"/>'
    // İran
    + '<path d="M130,20 Q158,14 180,24 Q196,36 196,54 Q194,70 178,78 Q160,84 144,78 Q128,70 124,54 Q120,36 130,20 Z" fill="#784212" stroke="#e67e22" stroke-width="0.6" opacity="0.85"/>'
    // Körfez
    + '<path d="M120,80 Q150,74 172,80 Q174,92 160,94 Q136,96 120,88 Z" fill="#0d4a6b" opacity="0.8"/>'
    // Nil
    + '<path d="M52,4 Q54,20 56,40 Q58,60 60,74 Q62,88 66,98" stroke="#4fc3f7" stroke-width="2.5" fill="none" opacity="0.8"/>';

  const maps = {
    1:DUNYA, 2:AVRUPA, 3:ASYA, 4:AFRIKA, 5:DUNYA, 6:ORTADOGU,
    7:DUNYA, 8:DUNYA, 9:DUNYA, 10:DUNYA, 11:TURKIYE, 12:DUNYA,
    13:DUNYA, 14:DUNYA, 15:DUNYA, 16:DUNYA, 17:DUNYA, 18:AFRIKA,
    19:DUNYA, 20:DUNYA, 21:DUNYA, 22:ORTADOGU, 23:DUNYA, 24:DUNYA,
    25:ASYA, 26:TURKIYE, 27:TURKIYE, 28:TURKIYE, 29:TURKIYE, 30:TURKIYE,
  };
  return maps[id] || DUNYA;
}



