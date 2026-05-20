require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const scheduler = require('./scheduler');
const { sendDailyReport } = require('./reporter');
const db = require('./db');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function isAuthorized(chatId) {
  return String(chatId) === String(ALLOWED_CHAT_ID);
}

// /start
bot.onText(/\/start/, (msg) => {
  if (!isAuthorized(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id,
    `📰 *Günlük Haber Botu Aktif!*\n\n` +
    `Mevcut komutlar:\n` +
    `▸ /news — Anlık haber raporu al\n` +
    `▸ /sources — Kayıtlı kaynakları listele\n` +
    `▸ /favorites — Favori haberlerini gör\n` +
    `▸ /help — Yardım\n\n` +
    `Her gün 07:00, 12:00 ve 18:00'de otomatik rapor gönderilecek. ✅`,
    { parse_mode: 'Markdown' }
  );
});

// /news — anlık rapor
bot.onText(/\/news/, async (msg) => {
  if (!isAuthorized(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id, '⏳ Haberler toplanıyor, lütfen bekle...');
  try {
    await sendDailyReport(bot, msg.chat.id);
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ Haber toplanırken hata oluştu: ' + e.message);
  }
});

// /sources
bot.onText(/\/sources/, (msg) => {
  if (!isAuthorized(msg.chat.id)) return;
  const sources = db.getSources();
  if (!sources.length) {
    return bot.sendMessage(msg.chat.id, '📭 Henüz kaydedilmiş kaynak yok.\n\nBir haber gönderildiğinde altındaki "⭐ Kaydet" butonuna basarak kaynak ekleyebilirsin.');
  }
  let text = `📚 *Kaydedilen Kaynaklar (${sources.length})*\n\n`;
  const byCategory = {};
  sources.forEach(s => {
    if (!byCategory[s.category]) byCategory[s.category] = [];
    byCategory[s.category].push(s);
  });
  Object.entries(byCategory).forEach(([cat, items]) => {
    text += `*${cat}*\n`;
    items.forEach((s, i) => {
      text += `  ${i + 1}. [${s.title}](${s.url})\n`;
    });
    text += '\n';
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// /favorites
bot.onText(/\/favorites/, (msg) => {
  if (!isAuthorized(msg.chat.id)) return;
  const favs = db.getFavorites();
  if (!favs.length) {
    return bot.sendMessage(msg.chat.id, '⭐ Henüz favori haber yok.\n\nHaber mesajlarının altındaki butona basarak favorilere ekleyebilirsin.');
  }
  let text = `⭐ *Favori Haberler (${favs.length})*\n\n`;
  favs.slice(-20).reverse().forEach((f, i) => {
    text += `*${i + 1}. ${f.category}*\n`;
    text += `${f.title}\n`;
    if (f.url) text += `[Kaynağa git](${f.url})\n`;
    text += `_${f.savedAt}_\n\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// /help
bot.onText(/\/help/, (msg) => {
  if (!isAuthorized(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id,
    `ℹ️ *Yardım*\n\n` +
    `*Kategoriler:*\n` +
    `🔵 Cam Elyaf Sektörü\n` +
    `🔴 Vergi & Antidamping\n` +
    `🟢 Rüzgar Enerjisi\n` +
    `🟡 Otomotiv Sektörü\n` +
    `🟠 CTP Boru & Altyapı\n` +
    `⚪ Firma Haberleri\n\n` +
    `*Komutlar:*\n` +
    `/news — Şu an için rapor al\n` +
    `/sources — Kaydedilen kaynaklar\n` +
    `/favorites — Favori haberler\n\n` +
    `Her gün 07:00, 12:00 ve 18:00'de otomatik rapor gelir.`,
    { parse_mode: 'Markdown' }
  );
});

// Inline buton callback (favori / kaynak kaydetme)
bot.on('callback_query', async (query) => {
  if (!isAuthorized(query.message.chat.id)) return;
  const data = JSON.parse(query.data);

  if (data.action === 'favorite') {
    db.addFavorite(data.item);
    bot.answerCallbackQuery(query.id, { text: '⭐ Favorilere eklendi!' });
  }

  if (data.action === 'save_source') {
    db.addSource(data.item);
    bot.answerCallbackQuery(query.id, { text: '📚 Kaynak kaydedildi!' });
  }
});

// Zamanlayıcıyı başlat
scheduler.start(bot, ALLOWED_CHAT_ID);

console.log('🤖 Bot başlatıldı. Ctrl+C ile durdur.');
