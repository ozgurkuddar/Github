const { scrapeAllCategories } = require('./scraper');
const db = require('./db');

function formatNewsMessage(categoryData) {
  const messages = [];

  for (const [id, { category, news }] of Object.entries(categoryData)) {
    let msg = `${category.label}\n`;
    msg += `${'─'.repeat(30)}\n`;

    if (!news) {
      msg += `_Bu kategori için bugün haber bulunamadı._\n`;
    } else {
      msg += `*${escapeMarkdown(news.title)}*\n\n`;
      msg += `${escapeMarkdown(news.summary)}\n\n`;
      if (news.source) msg += `📌 Kaynak: _${escapeMarkdown(news.source)}_\n`;
      if (news.date) msg += `📅 Tarih: _${news.date}_\n`;
      if (news.url) msg += `🔗 [Habere git](${news.url})\n`;
    }

    messages.push({ text: msg, news, categoryId: id, categoryLabel: category.label });
  }

  return messages;
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function buildInlineKeyboard(news, categoryLabel) {
  if (!news) return null;

  const favoriteData = JSON.stringify({
    action: 'favorite',
    item: {
      title: news.title,
      url: news.url || '',
      category: categoryLabel,
      savedAt: new Date().toLocaleDateString('tr-TR')
    }
  });

  const sourceData = JSON.stringify({
    action: 'save_source',
    item: {
      title: news.title,
      url: news.url || '',
      category: categoryLabel,
      source: news.source || ''
    }
  });

  // Telegram callback_data max 64 byte - truncate if needed
  if (favoriteData.length > 60 || sourceData.length > 60) {
    return null; // skip buttons if data too large
  }

  return {
    inline_keyboard: [
      [
        { text: '⭐ Favorilere Ekle', callback_data: favoriteData },
        { text: '📚 Kaynağı Kaydet', callback_data: sourceData }
      ]
    ]
  };
}

async function sendDailyReport(bot, chatId) {
  const today = new Date().toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Başlık mesajı
  await bot.sendMessage(chatId,
    `📰 *GÜNLÜK ENDÜSTRİ RAPORU*\n` +
    `📅 ${today}\n\n` +
    `Aşağıdaki kategorilerde güncel haberler toplanıyor... Hazır olunca her kategori ayrı mesaj olarak gelecek.`,
    { parse_mode: 'Markdown' }
  );

  // Haber topla
  const categoryData = await scrapeAllCategories();

  // Gönderilenleri kontrol et (tekrar önleme)
  const sentToday = db.getSentToday();
  let sentCount = 0;

  const messages = formatNewsMessage(categoryData);

  for (const msgData of messages) {
    // Daha önce gönderilmiş mi?
    const alreadySent = sentToday.some(s =>
      s.categoryId === msgData.categoryId && s.title === msgData.news?.title
    );

    if (alreadySent && msgData.news) {
      await bot.sendMessage(chatId,
        `${msgData.categoryLabel}\n_Bu kategori için yeni haber yok (önceki haber aynı)._`,
        { parse_mode: 'Markdown' }
      );
      continue;
    }

    try {
      const keyboard = msgData.news ? buildInlineKeyboard(msgData.news, msgData.categoryLabel) : null;
      const opts = { parse_mode: 'Markdown', disable_web_page_preview: false };
      if (keyboard) opts.reply_markup = keyboard;

      await bot.sendMessage(chatId, msgData.text, opts);

      // Gönderileni kaydet
      if (msgData.news) {
        db.markSent({
          categoryId: msgData.categoryId,
          title: msgData.news.title,
          url: msgData.news.url,
          date: new Date().toISOString()
        });
        sentCount++;
      }

      // Mesajlar arası kısa bekleme
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error('Mesaj gönderme hatası:', e.message);
    }
  }

  // Özet
  await bot.sendMessage(chatId,
    `✅ *Rapor tamamlandı!*\n` +
    `${sentCount} kategoride yeni haber gönderildi.\n\n` +
    `_/favorites — Favori haberler_\n` +
    `_/sources — Kayıtlı kaynaklar_`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { sendDailyReport };
