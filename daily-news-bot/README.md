# 📡 Endüstri Radar — Günlük Haber Botu

Cam elyaf, CTP boru, rüzgar enerjisi ve diğer sektörlerde günlük haber takibi yapan Telegram botu.

---

## 🗂️ Dosya Yapısı

```
daily-news-bot/
├── index.html          ← Yönetim paneli (GitHub Pages)
├── .env.example        ← API anahtarları şablonu
├── .env                ← Gerçek API anahtarları (git'e ekleme!)
├── package.json
└── bot/
    ├── index.js        ← Ana bot + komut yönetimi
    ├── scraper.js      ← Perplexity API ile haber toplama
    ├── reporter.js     ← Mesaj formatlama ve Telegram'a gönderme
    ├── scheduler.js    ← Sabah 07:00 cron job
    └── db.js           ← JSON tabanlı veri saklama
```

---

## 🚀 Kurulum (Adım Adım)

### 1. Telegram Bot Oluştur

1. Telegram'da `@BotFather`'a git
2. `/newbot` komutunu gönder
3. Bot adı ver (örn: `EndüstriRadar`)
4. Kullanıcı adı ver (örn: `endustri_radar_bot`)
5. **Token'ı kopyala** → `.env` dosyasına yapıştır

### 2. Chat ID'ni Öğren

1. Yeni botu aç, `/start` gönder
2. Telegram'da `@userinfobot`'a mesaj gönder
3. **Chat ID'ni kopyala** → `.env` dosyasına yapıştır

### 3. Perplexity API Key Al

1. https://www.perplexity.ai/settings/api adresine git
2. "Generate" ile API key oluştur
3. **Key'i kopyala** → `.env` dosyasına yapıştır
4. Kart ekle (aylık ~$5-10 kadara kadar bu proje için)

### 4. .env Dosyasını Oluştur

```bash
cp .env.example .env
```

`.env` dosyasını düzenle:
```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=123456789
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5. Bağımlılıkları Yükle

```bash
npm install
```

### 6. Botu Başlat

```bash
npm start
```

Telegram'dan `/start` gönder → çalışıyor! 🎉

### 7. İlk Raporu Test Et

```
/news
```

---

## ☁️ Railway'e Deploy (Ücretsiz Bulut)

1. [railway.app](https://railway.app) hesabı aç
2. "New Project" → "Deploy from GitHub Repo"
3. Bu repo'yu seç
4. "Variables" bölümüne `.env` içindeki 3 değişkeni ekle
5. Deploy! Bot 7/24 çalışacak.

---

## 📄 GitHub Pages Paneli

1. `index.html`'i GitHub repo'nun root'una koy
2. GitHub → Settings → Pages → Branch: main, folder: / (root)
3. Save → Birkaç dakika sonra panel yayında!

---

## 📊 Kategoriler

| # | Kategori | Arama Konuları |
|---|---|---|
| 🔵 | Cam Elyaf Sektörü | Yurtiçi/yurtdışı üretim, pazar haberleri |
| 🔴 | Vergi & Antidamping | AB, ABD, Hindistan soruşturmaları |
| 🟢 | Rüzgar Enerjisi | Saertex, Metyx, Telateks, kanat üretimi |
| 🟡 | Otomotiv | Kompozit malzeme, hafifletme teknolojileri |
| 🟠 | CTP Boru & Altyapı | GRP/FRP boru, su altyapısı projeleri |
| ⚪ | Firma Haberleri | Amiblu, Subor, Superlit, Alfebor, vs. |

---

## 💬 Telegram Komutları

| Komut | Açıklama |
|---|---|
| `/start` | Botu başlat |
| `/news` | Anlık rapor al |
| `/sources` | Kayıtlı kaynakları listele |
| `/favorites` | Favori haberler |
| `/help` | Yardım |

---

## 🔧 .gitignore (oluşturman gereken)

```
.env
data/
node_modules/
```

---

## 💡 İpuçları

- **Yeni kategori eklemek:** `bot/scraper.js` içindeki `CATEGORIES` dizisine yeni obje ekle
- **Saat değiştirmek:** `bot/scheduler.js` içindeki cron ifadesini düzenle
- **Perplexity yerine ücretsiz:** `scraper.js`'i RSS feed ile de yazabiliriz

---

## 📞 Destek

Sorun yaşarsan Cursor AI'ya şunu söyle:
> "daily-news-bot projesinde [sorun] var, nasıl düzeltirim?"
