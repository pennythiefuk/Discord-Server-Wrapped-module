// Dates in the server's timezone (config.timezone, an IANA name like "America/New_York"). Months, days and the
// "most active hour" all follow it, so a server in New York doesn't see its month roll over at 7pm.

const formatters = new Map();
function partsFor(ts, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  const out = {};
  for (const p of f.formatToParts(new Date(ts))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out; // { year, month, day, hour }
}

/** Throws a clear error at startup if the timezone name is wrong. */
function checkTimezone(timeZone) {
  try {
    partsFor(Date.now(), timeZone);
  } catch {
    throw new Error(`Wrapped: "${timeZone}" isn't a timezone name. Use one like "Europe/London" or "America/New_York".`);
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** "2026-09" */
function monthKey(ts, timeZone) {
  const p = partsFor(ts, timeZone);
  return `${p.year}-${pad(p.month)}`;
}

/** "2026-09-27" */
function dayKey(ts, timeZone) {
  const p = partsFor(ts, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 0-23 */
function hourOf(ts, timeZone) {
  return partsFor(ts, timeZone).hour;
}

/** Every month key from `from` to `to` (inclusive, both "YYYY-MM"). */
function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The month before "YYYY-MM". */
function previousMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

module.exports = { checkTimezone, monthKey, dayKey, hourOf, monthsBetween, previousMonth, partsFor };
