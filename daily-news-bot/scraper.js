const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const CATEGORIES = [
  {
    id: 'cam-elyaf',
    label: '🔵 Cam Elyaf Sektörü',
    emoji: '🔵',
    queries: [
      'glass fiber fiberglass industry news latest 2024 2025 production market',
      'cam elyaf sektörü haberler Türkiye 2024 2025',
      'fiberglass composite materials manufacturing news'
    ]
  },
  {
    id: 'antidamping',
    label: '🔴 Vergi & Antidamping',
    emoji: '🔴',
    queries: [
      'antidumping anti-subsidy glass fiber fiberglass tariff investigation 2024 2025',
      'cam elyaf antidamping vergi soruşturması gümrük 2024 2025',
      'fiberglass trade remedy countervailing duty investigation'
    ]
  },
  {
    id: 'ruzgar',
    label: '🟢 Rüzgar Enerjisi & Elyaf',
    emoji: '🟢',
    queries: [
      'wind energy fiberglass composite blade manufacturing Saertex Metyx Telateks 2024 2025',
      'wind turbine blade glass fiber demand production news',
      'rüzgar enerjisi elyaf kanat üretimi haberler 2024 2025'
    ]
  },
  {
    id: 'otomotiv',
    label: '🟡 Otomotiv Sektörü',
    emoji: '🟡',
    queries: [
      'automotive composite fiberglass glass fiber lightweight materials 2024 2025 news',
      'otomotiv sektörü kompozit malzeme haberler Türkiye 2024 2025'
    ]
  },
  {
    id: 'ctp-boru',
    label: '🟠 CTP Boru & Altyapı',
    emoji: '🟠',
    queries: [
      'GRP FRP pipe infrastructure pipeline fiberglass Turkey Middle East 2024 2025',
      'CTP boru altyapı su kanalizasyon haberler 2024 2025',
      'glass reinforced plastic pipe water infrastructure project news'
    ]
  },
  {
    id: 'firma',
    label: '⚪ Firma Haberleri',
    emoji: '⚪',
    queries: [
      'Amiblu pipe GRP FRP news 2024 2025',
      'Subor Superlit Alfebor pipe news Turkey 2024 2025',
      'Esen Plastik Kuzeyboru Akbor Niğbor haber 2024 2025'
    ]
  }
];

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
    const block = match[1];

    const titleRaw = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || '';
    const title = titleRaw.replace(/ - [^-]+$/, '').trim();

    const url = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() || '';
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    const date = pubDate ? new Date(pubDate).toISOString().split('T')[0] : '';

    if (title && url) items.push({ title, url, source, date });
  }

  return items;
}

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
  });
  if (!response.ok) throw new Error(`RSS hatası: ${response.status}`);
  return parseRSS(await response.text());
}

async function analyzeWithGemini(articles, categoryLabel) {
  if (!articles.length) return null;

  const articleList = articles
    .slice(0, 10)
    .map((a, i) => `${i + 1}. Başlık: ${a.title}\n   Kaynak: ${a.source}\n   Tarih: ${a.date}\n   URL: ${a.url}`)
    .join('\n\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Sen bir endüstriyel haber analistisisin. "${categoryLabel}" kategorisi için aşağıdaki haberlerden en önemlisini seç.

SADECE şu JSON formatında yanıt ver, başka hiçbir şey yazma:
{"title": "Türkçe haber başlığı", "summary": "2-3 cümle Türkçe özet", "url": "haber URL'si", "source": "kaynak adı", "date": "YYYY-MM-DD", "relevance": "high|medium|low"}

Haberler:
${articleList}`
          }]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
      })
    }
  );

  if (!response.ok) throw new Error(`Gemini API hatası: ${response.status}`);
  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!content) return null;

  try {
    return JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

async function scrapeCategory(category) {
  const allArticles = [];

  for (const query of category.queries) {
    try {
      const articles = await fetchGoogleNews(query);
      allArticles.push(...articles);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`RSS hatası (${category.id} - ${query}):`, e.message);
    }
  }

  if (!allArticles.length) return null;

  // URL'ye göre tekrar eden haberleri çıkar
  const unique = allArticles.filter((a, i, arr) => arr.findIndex(b => b.url === a.url) === i);
  return await analyzeWithGemini(unique, category.label);
}

async function scrapeAllCategories() {
  console.log('📡 Haberler toplanıyor...');
  const categoryResults = {};

  for (const category of CATEGORIES) {
    console.log(`  → ${category.label} taranıyor...`);
    try {
      const result = await scrapeCategory(category);
      categoryResults[category.id] = { category, news: result };
    } catch (e) {
      console.error(`Kategori hatası (${category.id}):`, e.message);
      categoryResults[category.id] = { category, news: null };
    }
  }

  return categoryResults;
}

module.exports = { scrapeAllCategories, CATEGORIES };
