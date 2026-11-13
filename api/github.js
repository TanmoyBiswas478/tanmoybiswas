/*
 * GET /api/github: the last twelve months of GitHub contributions, as
 * { total, days: [{ date, count, level }] }, read from GitHub's GraphQL API.
 *
 * Needs a GITHUB_TOKEN environment variable on Vercel (a fine-grained token
 * with no extra permissions is enough; public data only). Without one it
 * answers 503 and js/github.js falls back to a public mirror.
 *
 * The username is fixed here, so this cannot be used as an open proxy.
 */
const USER = process.env.GITHUB_USER || 'TanmoyBiswas478';

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const QUERY = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;

module.exports = async function handler(req, res) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'GITHUB_TOKEN is not set' });
    return;
  }

  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'portfolio-contributions',
      },
      body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
    });
    const json = await response.json();
    const calendar = json?.data?.user?.contributionsCollection?.contributionCalendar;
    if (!response.ok || !calendar) throw new Error(json?.errors?.[0]?.message || `GitHub answered ${response.status}`);

    const days = calendar.weeks.flatMap((week) => week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: LEVELS[day.contributionLevel] ?? 0,
    })));

    // Cached at Vercel's edge for an hour; a stale copy is served while it refreshes.
    res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ total: calendar.totalContributions, days });
  } catch (error) {
    res.status(502).json({ error: String(error.message || error) });
  }
};
