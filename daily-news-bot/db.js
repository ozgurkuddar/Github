const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const FILES = {
  sources: path.join(DATA_DIR, 'sources.json'),
  favorites: path.join(DATA_DIR, 'favorites.json'),
  sent: path.join(DATA_DIR, 'sent.json')
};

// Klasörü oluştur
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// --- SOURCES ---
function getSources() {
  return readJSON(FILES.sources);
}

function addSource(item) {
  const sources = getSources();
  const exists = sources.some(s => s.url === item.url);
  if (!exists) {
    sources.push({ ...item, addedAt: new Date().toISOString() });
    writeJSON(FILES.sources, sources);
  }
}

// --- FAVORITES ---
function getFavorites() {
  return readJSON(FILES.favorites);
}

function addFavorite(item) {
  const favs = getFavorites();
  const exists = favs.some(f => f.title === item.title && f.category === item.category);
  if (!exists) {
    favs.push({ ...item, savedAt: new Date().toLocaleDateString('tr-TR') });
    writeJSON(FILES.favorites, favs);
  }
}

// --- SENT HISTORY (tekrar önleme) ---
function getSent() {
  return readJSON(FILES.sent);
}

function getSentToday() {
  const today = new Date().toISOString().split('T')[0];
  return getSent().filter(s => s.date && s.date.startsWith(today));
}

function markSent(item) {
  const sent = getSent();
  sent.push(item);
  // Son 500 kaydı tut
  if (sent.length > 500) sent.splice(0, sent.length - 500);
  writeJSON(FILES.sent, sent);
}

function clearSentToday() {
  const today = new Date().toISOString().split('T')[0];
  const sent = getSent().filter(s => !s.date.startsWith(today));
  writeJSON(FILES.sent, sent);
}

module.exports = {
  getSources, addSource,
  getFavorites, addFavorite,
  getSent, getSentToday, markSent, clearSentToday
};
