const cron = require('node-cron');
const { sendDailyReport } = require('./reporter');

function start(bot, chatId) {
  const zamanlar = [
    { cron: '0 7 * * *', saat: '07:00' },
    { cron: '0 12 * * *', saat: '12:00' },
    { cron: '0 18 * * *', saat: '18:00' }
  ];

  zamanlar.forEach(({ cron: cronExpr, saat }) => {
    cron.schedule(cronExpr, async () => {
      console.log(`⏰ [${new Date().toLocaleString('tr-TR')}] ${saat} raporu gönderiliyor...`);
      try {
        await sendDailyReport(bot, chatId);
        console.log(`✅ ${saat} raporu gönderildi.`);
      } catch (e) {
        console.error(`❌ ${saat} rapor hatası:`, e.message);
      }
    }, { timezone: 'Europe/Istanbul' });
  });

  console.log('⏰ Zamanlayıcı aktif: 07:00, 12:00, 18:00 (İstanbul) rapor gönderilecek.');
}

module.exports = { start };
