// Visitor and like counts, stored in Upstash Redis over its REST API.
//   GET              -> { visitors, likes }
//   POST ?action=visit -> counts this visitor once per day
//   POST ?action=like  -> counts one like per visitor
//   POST ?action=unlike -> takes that like back
// Counts below the thresholds come back as null, so small numbers stay private.
const crypto = require('crypto');

const env = process.env;
const REDIS_URL = env.KV_REST_API_URL || env.STORAGE_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const TOKEN = env.KV_REST_API_TOKEN || env.STORAGE_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
const SALT = process.env.STATS_SALT || TOKEN || '';
const MIN_VISITORS = Number(process.env.STATS_MIN_VISITORS ?? 300);
const MIN_LIKES = Number(process.env.STATS_MIN_LIKES ?? 10);

const DAY = 60 * 60 * 24;
// Days are counted in Indian Standard Time (UTC+5:30): a new day starts at 12:00 AM IST.
const IST_OFFSET = 5.5 * 60 * 60 * 1000;
const istDate = (ms = Date.now()) => new Date(ms + IST_OFFSET).toISOString().slice(0, 10);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|curl|wget|python|headless|lighthouse/i;

async function redis(commands) {
  const response = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`Redis answered ${response.status}`);
  return (await response.json()).map((entry) => entry.result);
}

const hash = (value) => crypto.createHash('sha256').update(`${SALT}|${value}`).digest('hex').slice(0, 32);
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
const visitorId = (req) => hash(`${clientIp(req)}|${req.headers['user-agent'] || ''}`);
const ipId = (req) => hash(`ip|${clientIp(req)}`);

// Browsers always send Origin on a POST, so a POST without one is a script.
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Per-IP limits. Changing the User-Agent makes a new visitorId, so these are
// keyed on the IP alone: they stop one machine from inflating the counts.
const RATE_WINDOW = 10 * 60;          // seconds
const RATE_MAX = 30;                  // POSTs per IP per window
const LIKES_PER_IP_PER_DAY = 3;       // a shared network (home, office) still gets a few

async function overLimit(req) {
  const key = `rl:${ipId(req)}:${Math.floor(Date.now() / 1000 / RATE_WINDOW)}`;
  const [count] = await redis([['INCR', key], ['EXPIRE', key, RATE_WINDOW]]);
  return count > RATE_MAX;
}

const shown = (value, min) => {
  const n = Number(value) || 0;
  return n >= min ? n : null;
};

// Owner view: shows the exact numbers (no thresholds) and the last 14 days.
// A browser gets a small page, anything else gets JSON. The key can be sent as
// a header (`x-stats-key: <key>`), which stays out of logs and history, or as
// /api/stats?key=<key> for quick use in a browser.
function keyMatches(given) {
  const expected = env.STATS_ADMIN_KEY;
  if (!expected || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function ownerView(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex');
  res.setHeader('referrer-policy', 'no-referrer');
  if (!keyMatches(req.headers['x-stats-key'] ?? req.query?.key)) {
    res.status(401).json({ error: env.STATS_ADMIN_KEY ? 'Wrong key' : 'STATS_ADMIN_KEY is not set' });
    return;
  }

  const days = Array.from({ length: 14 }, (_, i) => istDate(Date.now() - i * DAY * 1000));
  const results = await redis([['GET', 'stats:visitors'], ['GET', 'stats:likes'], ...days.map((d) => ['GET', `stats:day:${d}`])]);
  const data = {
    visitors: Number(results[0]) || 0,
    likes: Number(results[1]) || 0,
    days: days.map((date, i) => ({ date, visitors: Number(results[i + 2]) || 0 })),
  };

  if (!String(req.headers.accept || '').includes('text/html')) {
    res.status(200).json(data);
    return;
  }

  const peak = Math.max(1, ...data.days.map((d) => d.visitors));
  const rows = data.days.map((d) => `<tr><td>${d.date}</td><td><i style="width:${(d.visitors / peak) * 100}%"></i></td><td>${d.visitors}</td></tr>`).join('');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Portfolio stats</title>
<style>
body{margin:0;padding:40px 20px;background:#07060d;color:#f4f3f9;font:15px/1.5 system-ui,sans-serif}
main{max-width:560px;margin:auto}
h1{font-size:14px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:#918da8;margin:0 0 24px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:32px}
.card{padding:20px;border:1px solid rgba(244,243,249,.16);border-radius:12px}
.card b{display:block;font-size:40px;font-weight:600;line-height:1.1}
.card span{color:#918da8;font-size:13px}
table{width:100%;border-collapse:collapse;font:13px ui-monospace,Consolas,monospace}
td{padding:7px 0;border-bottom:1px solid rgba(244,243,249,.1)}
td:nth-child(2){width:60%;padding:7px 12px}
td:last-child{text-align:right}
i{display:block;height:8px;min-width:2px;border-radius:4px;background:linear-gradient(90deg,#8b7bff,#ff6b8b)}
p{color:#918da8;font-size:13px}
</style></head><body><main>
<h1>Portfolio stats</h1>
<div class="cards"><div class="card"><b>${data.visitors}</b><span>visits in total</span></div><div class="card"><b>${data.likes}</b><span>appreciations</span></div></div>
<table>${rows}</table>
<p>Unique visitors per day (IST); the total adds these up, so a returning visitor counts once per day. Public thresholds: ${MIN_VISITORS} visits, ${MIN_LIKES} likes.</p>
</main></body></html>`);
}

module.exports = async function handler(req, res) {
  if (!REDIS_URL || !TOKEN) {
    res.status(503).json({ error: 'Stats storage is not configured' });
    return;
  }

  try {
    if (req.method === 'GET' && (req.query?.key !== undefined || req.headers['x-stats-key'] !== undefined)) {
      await ownerView(req, res);
      return;
    }

    if (req.method === 'GET') {
      const [visitors, likes] = await redis([['GET', 'stats:visitors'], ['GET', 'stats:likes']]);
      res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.status(200).json({ visitors: shown(visitors, MIN_VISITORS), likes: shown(likes, MIN_LIKES) });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      res.status(405).end();
      return;
    }
    if (!sameSite(req)) {
      res.status(403).json({ error: 'Cross-site request' });
      return;
    }

    const action = req.query?.action;
    if (!['visit', 'like', 'unlike'].includes(action)) {
      res.status(400).json({ error: 'Unknown action' });
      return;
    }
    if (await overLimit(req)) {
      res.setHeader('retry-after', String(RATE_WINDOW));
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    const isBot = BOT.test(req.headers['user-agent'] || '');
    const id = visitorId(req);
    let liked = false;

    if (action === 'visit' && !isBot) {
      const today = istDate();
      const [fresh] = await redis([['SET', `seen:visit:${today}:${id}`, '1', 'NX', 'EX', DAY]]);
      if (fresh === 'OK') {
        await redis([
          ['INCR', 'stats:visitors'],
          ['INCR', `stats:day:${today}`],
          ['EXPIRE', `stats:day:${today}`, DAY * 90],
        ]);
      }
    } else if (action === 'like' && !isBot) {
      const [fresh] = await redis([['SET', `seen:like:${id}`, '1', 'NX', 'EX', DAY * 365]]);
      if (fresh === 'OK') {
        const ipKey = `likes:ip:${istDate()}:${ipId(req)}`;
        const [fromIp] = await redis([['INCR', ipKey], ['EXPIRE', ipKey, DAY]]);
        if (fromIp <= LIKES_PER_IP_PER_DAY) await redis([['INCR', 'stats:likes']]);
        else await redis([['DEL', `seen:like:${id}`]]);   // not counted, so nothing to take back later
      }
      liked = true;
    } else if (action === 'unlike' && !isBot) {
      // Only takes back a like this visitor actually gave.
      const [removed] = await redis([['DEL', `seen:like:${id}`]]);
      if (removed === 1) {
        const [left] = await redis([['DECR', 'stats:likes']]);
        if (left < 0) await redis([['SET', 'stats:likes', '0']]);
      }
    }

    const [visitors, likes] = await redis([['GET', 'stats:visitors'], ['GET', 'stats:likes']]);
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({ visitors: shown(visitors, MIN_VISITORS), likes: shown(likes, MIN_LIKES), liked });
  } catch (error) {
    console.error('stats failed:', error);   // details stay in the server log
    res.status(502).json({ error: 'Stats are unavailable right now' });
  }
};
