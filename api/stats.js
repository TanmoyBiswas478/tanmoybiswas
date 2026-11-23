// Visitor and like counts, stored in Upstash Redis over its REST API.
//   GET              -> { visitors, likes }
//   POST ?action=visit -> counts this visitor once per day
//   POST ?action=like  -> counts one like per visitor
// Counts below the thresholds come back as null, so small numbers stay private.
const crypto = require('crypto');

const env = process.env;
const REDIS_URL = env.KV_REST_API_URL || env.STORAGE_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const TOKEN = env.KV_REST_API_TOKEN || env.STORAGE_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
const SALT = process.env.STATS_SALT || TOKEN || '';
const MIN_VISITORS = Number(process.env.STATS_MIN_VISITORS ?? 300);
const MIN_LIKES = Number(process.env.STATS_MIN_LIKES ?? 10);

const DAY = 60 * 60 * 24;
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

function visitorId(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(`${SALT}|${ip}|${req.headers['user-agent'] || ''}`).digest('hex').slice(0, 32);
}

function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const shown = (value, min) => {
  const n = Number(value) || 0;
  return n >= min ? n : null;
};

module.exports = async function handler(req, res) {
  if (!REDIS_URL || !TOKEN) {
    res.status(503).json({ error: 'Stats storage is not configured' });
    return;
  }

  try {
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
    const isBot = BOT.test(req.headers['user-agent'] || '');
    const id = visitorId(req);
    let liked = false;

    if (action === 'visit' && !isBot) {
      const today = new Date().toISOString().slice(0, 10);
      const [fresh] = await redis([['SET', `seen:visit:${today}:${id}`, '1', 'NX', 'EX', DAY]]);
      if (fresh === 'OK') await redis([['INCR', 'stats:visitors']]);
    } else if (action === 'like' && !isBot) {
      const [fresh] = await redis([['SET', `seen:like:${id}`, '1', 'NX', 'EX', DAY * 365]]);
      if (fresh === 'OK') await redis([['INCR', 'stats:likes']]);
      liked = true;
    } else if (action !== 'visit' && action !== 'like') {
      res.status(400).json({ error: 'Unknown action' });
      return;
    }

    const [visitors, likes] = await redis([['GET', 'stats:visitors'], ['GET', 'stats:likes']]);
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({ visitors: shown(visitors, MIN_VISITORS), likes: shown(likes, MIN_LIKES), liked });
  } catch (error) {
    res.status(502).json({ error: String(error.message || error) });
  }
};
