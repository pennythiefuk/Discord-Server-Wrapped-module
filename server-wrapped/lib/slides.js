const { textWidth, drawable } = require('./render.js');
const { monthKey, monthsBetween, previousMonth } = require('./time.js');

// Builds the list of slides for a server or one person. A section is only added when it's switched on in the config
// AND there's something to show — a server with no music bot never sees a music slide.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Spotify Wrapped-style two-tone palettes: [gradient start, gradient end, text colour, accent].
const THEMES = [
  ['#1ED760', '#119C4B', '#121212', '#FFFFFF'],
  ['#FF4FB8', '#6A1B9A', '#FFFFFF', '#CDF564'],
  ['#FF7A1A', '#C2185B', '#FFFFFF', '#FFE14D'],
  ['#2D46B9', '#0B1240', '#FFFFFF', '#CDF564'],
  ['#CDF564', '#72B82E', '#121212', '#121212'],
  ['#9B5DE5', '#240B4F', '#FFFFFF', '#FF4FB8'],
  ['#FF3B3B', '#5C0A0A', '#FFFFFF', '#FFE14D'],
];
const DARK = ['#191414', '#2E2E2E', '#FFFFFF', '#1ED760'];

const n = (x) => Math.round(x).toLocaleString('en-US');
const plural = (x, word, words = `${word}s`) => `${n(x)} ${Math.round(x) === 1 ? word : words}`;
const hourText = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
function topBy(obj, limit = 5) {
  return Object.entries(obj || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Periods: "m2026-09" (a month) or "y2026" (a year)
// ---------------------------------------------------------------------------
function periodFor(word, timeZone, now = Date.now()) {
  const current = monthKey(now, timeZone);
  if (word === 'year') return `y${current.slice(0, 4)}`;
  if (word === 'last') return `m${previousMonth(current)}`;
  return `m${current}`;
}

function describePeriod(code, timeZone, now = Date.now()) {
  const current = monthKey(now, timeZone);
  if (code.startsWith('y')) {
    const year = code.slice(1);
    const isNow = year === current.slice(0, 4);
    return { months: monthsBetween(`${year}-01`, isNow ? current : `${year}-12`), label: isNow ? `${year} so far` : year };
  }
  const key = code.slice(1);
  const [y, m] = key.split('-').map(Number);
  return { months: [key], label: `${MONTH_NAMES[m - 1]} ${y}${key === current ? ' so far' : ''}` };
}

function dayText(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

/** A picture of an emoji key ("u:😭" → Twemoji's artwork, "c:name:id" → the server's own emoji). */
function emojiImage(key) {
  if (key.startsWith('c:')) return `https://cdn.discordapp.com/emojis/${key.split(':')[2]}.png?size=256`;
  const points = [...key.slice(2)].map((c) => c.codePointAt(0));
  const code = (points.includes(0x200d) ? points : points.filter((p) => p !== 0xfe0f)).map((p) => p.toString(16)).join('-');
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`;
}

// ---------------------------------------------------------------------------
// Slide layouts (900 × 1125)
// ---------------------------------------------------------------------------
/** The largest of `sizes` at which `text` fits in `maxWidth` (the smallest if none do — it's then cut to fit). */
function fitSize(text, maxWidth, sizes, font = 'black') {
  const t = drawable(text);
  return sizes.find((size) => textWidth(t, size, font) <= maxWidth) || sizes[sizes.length - 1];
}

function makeLayouts(config) {
  const brand = config.name;
  const footer = config.footer;

  function frame(theme, kicker) {
    const [c0, c1, fg] = theme;
    return {
      bg: [c0, c1],
      elements: [
        { type: 'text', text: brand, x: 60, y: 56, size: 26, font: 'black', color: fg, alpha: 0.85, maxWidth: kicker ? 520 : 780 },
        ...(kicker ? [{ type: 'text', text: kicker.toUpperCase(), x: 840, y: 56, size: 26, font: 'black', color: fg, alpha: 0.85, align: 'right' }] : []),
        ...(footer ? [{ type: 'text', text: footer, x: 60, y: 1060, size: 24, font: 'bold', color: fg, alpha: 0.6 }] : []),
      ],
    };
  }

  function introSlide(theme, { title, subtitle, period, image }) {
    const s = frame(theme);
    s.name = 'Intro';
    const [, , fg, accent] = theme;
    const width = image ? 520 : 780;
    s.elements.push(
      { type: 'text', text: 'Your', x: 60, y: 200, size: 124, font: 'black', color: fg },
      { type: 'text', text: 'Wrapped', x: 60, y: 340, size: 140, font: 'black', color: accent, maxWidth: 800 },
      { type: 'text', text: 'is here.', x: 60, y: 510, size: 124, font: 'black', color: fg },
      { type: 'box', x: 60, y: 720, w: 120, h: 12, color: accent },
      { type: 'text', text: title, x: 60, y: 765, size: fitSize(title, width, [56, 48, 42, 36]), font: 'black', color: fg, maxWidth: width }
    );
    [subtitle, period].filter(Boolean).forEach((line, i) => s.elements.push({ type: 'text', text: line, x: 60, y: 850 + i * 52, size: fitSize(line, width, [36, 32, 28], 'bold'), font: 'bold', color: fg, alpha: 0.85, maxWidth: width }));
    if (image) s.elements.push({ type: 'image', url: image, x: 620, y: 740, w: 220, h: 220, round: true });
    return s;
  }

  function listSlide(theme, { kicker, title, rows, image }) {
    const s = frame(theme, kicker);
    s.name = title.join(' ');
    const [, , fg, accent] = theme;
    const width = image ? 520 : 780;
    s.elements.push({ type: 'text', text: title[0], x: 60, y: 130, size: fitSize(title[0], width, [72, 62, 54]), font: 'black', color: fg, maxWidth: width });
    if (title[1]) s.elements.push({ type: 'text', text: title[1], x: 60, y: 215, size: fitSize(title[1], width, [72, 62, 54]), font: 'black', color: fg, maxWidth: width });
    if (image) s.elements.push({ type: 'image', url: image, x: 620, y: 120, w: 220, h: 220 });
    rows.slice(0, 5).forEach((row, i) => {
      const y = 390 + i * 128;
      s.elements.push(
        { type: 'text', text: String(i + 1), x: 60, y: y - 6, size: 72, font: 'black', color: i === 0 ? accent : fg },
        { type: 'text', text: row[0], x: 165, y, size: 42, font: 'bold', color: fg, maxWidth: 675 },
        { type: 'text', text: row[1] || '', x: 165, y: y + 56, size: 28, font: 'regular', color: fg, alpha: 0.75, maxWidth: 675 }
      );
    });
    return s;
  }

  function bigStatSlide(theme, { kicker, lead, big, unit, lines = [], image }) {
    const s = frame(theme, kicker);
    s.name = `${lead} ${big} ${unit}`;
    const [, , fg, accent] = theme;
    s.elements.push(
      { type: 'text', text: lead, x: 60, y: 170, size: fitSize(lead, 780, [50, 44, 38]), font: 'black', color: fg, maxWidth: 780 },
      { type: 'text', text: big, x: 60, y: 290, size: fitSize(big, 790, [190, 160, 140, 120, 100]), font: 'black', color: accent, maxWidth: 800 },
      { type: 'text', text: unit, x: 60, y: 540, size: fitSize(unit, 780, [60, 52, 44]), font: 'black', color: fg, maxWidth: 780 }
    );
    // All of a slide's lines share one size — the biggest at which they all fit — and a line that still doesn't fit
    // wraps onto a second line rather than being cut short. Beside a picture the lines get less room.
    const lineWidth = image ? 510 : 780;
    const sizes = [36, 32, 28];
    const size = sizes.find((sz) => lines.every((l) => textWidth(drawable(l), sz, 'bold') <= lineWidth)) || sizes[sizes.length - 1];
    const rows = [];
    for (const line of lines.slice(0, 4)) {
      if (textWidth(drawable(line), size, 'bold') <= lineWidth) {
        rows.push(line);
        continue;
      }
      const words = line.split(' ');
      let first = '';
      while (words.length && textWidth(drawable(`${first} ${words[0]}`.trim()), size, 'bold') <= lineWidth) first = `${first} ${words.shift()}`.trim();
      rows.push(first || words.shift(), words.join(' '));
    }
    const gap = Math.round(size * 1.6);
    rows.slice(0, 6).forEach((row, i) => s.elements.push({ type: 'text', text: row, x: 60, y: 690 + i * gap, size, font: 'bold', color: fg, alpha: 0.9, maxWidth: lineWidth }));
    if (image) s.elements.push({ type: 'image', url: image, x: 600, y: 760, w: 240, h: 240, round: true });
    return s;
  }

  function personSlide(theme, { kicker, lead, name, stat, sub, image, square = false }) {
    const s = frame(theme, kicker);
    s.name = lead;
    const [, , fg, accent] = theme;
    s.elements.push({ type: 'text', text: lead, x: 450, y: 150, size: fitSize(lead, 800, [50, 44, 38]), font: 'black', color: fg, align: 'center', maxWidth: 800 });
    if (image) s.elements.push(square ? { type: 'image', url: image, x: 300, y: 280, w: 300, h: 300 } : { type: 'image', url: image, x: 270, y: 260, w: 360, h: 360, round: true });
    const top = image ? 680 : 430; // no picture → the text moves up into its place rather than leaving a gap
    s.elements.push(
      ...(name ? [{ type: 'text', text: name, x: 450, y: top, size: fitSize(name, 820, [80, 68, 56, 46]), font: 'black', color: accent, align: 'center', maxWidth: 820 }] : []),
      { type: 'text', text: stat, x: 450, y: name ? top + 115 : top + 10, size: fitSize(stat, 820, [42, 36, 32, 28], 'bold'), font: 'bold', color: fg, align: 'center', maxWidth: 820 }
    );
    if (sub) s.elements.push({ type: 'text', text: sub, x: 450, y: top + 185, size: fitSize(sub, 820, [32, 28, 24], 'regular'), font: 'regular', color: fg, alpha: 0.8, align: 'center', maxWidth: 820 });
    return s;
  }

  function summarySlide(theme, { title, subtitle, period, image, leftTitle, left, rightTitle, right, stats }) {
    const [c0, c1, fg, accent] = theme;
    const s = { bg: [c0, c1], elements: [], name: 'Summary' };
    if (image) s.elements.push({ type: 'image', url: image, x: 60, y: 60, w: 300, h: 300 });
    const tx = image ? 400 : 60;
    const width = 840 - tx;
    s.elements.push(
      { type: 'text', text: brand, x: tx, y: 90, size: 26, font: 'black', color: accent, maxWidth: width },
      { type: 'text', text: title, x: tx, y: 138, size: fitSize(title, width, [52, 44, 38, 32]), font: 'black', color: fg, maxWidth: width },
      ...[subtitle, period].filter(Boolean).map((line, i) => ({ type: 'text', text: line, x: tx, y: 218 + i * 46, size: fitSize(line, width, [32, 28, 24], 'bold'), font: 'bold', color: fg, alpha: 0.8, maxWidth: width }))
    );
    const clean = (list) => (list || []).filter(Boolean);
    const leftItems = clean(left);
    const rightItems = clean(right);
    const stat = ([label, value], x, y) =>
      s.elements.push(
        { type: 'text', text: label, x, y, size: 30, font: 'bold', color: fg, alpha: 0.75, maxWidth: 370 },
        { type: 'text', text: value, x, y: y + 45, size: fitSize(value, 370, [68, 56, 46, 38, 32]), font: 'black', color: accent, maxWidth: 370 }
      );
    if (!leftItems.length && !rightItems.length) {
      stats.slice(0, 4).forEach((row, i) => stat(row, i % 2 ? 470 : 60, 440 + Math.floor(i / 2) * 230)); // a 2×2 grid instead of empty columns
    } else if (!rightItems.length || !leftItems.length) {
      // One list — it gets the left half, the stats stack on the right.
      const [t, items] = leftItems.length ? [leftTitle, leftItems] : [rightTitle, rightItems];
      s.elements.push({ type: 'text', text: t, x: 60, y: 420, size: 30, font: 'bold', color: fg, alpha: 0.75 });
      items.slice(0, 5).forEach((item, i) => s.elements.push({ type: 'text', text: `${i + 1}  ${item}`, x: 60, y: 475 + i * 56, size: 32, font: 'bold', color: fg, maxWidth: 380 }));
      stats.slice(0, 3).forEach((row, i) => stat(row, 470, 420 + i * 190));
    } else {
      s.elements.push({ type: 'text', text: leftTitle, x: 60, y: 420, size: 30, font: 'bold', color: fg, alpha: 0.75 }, { type: 'text', text: rightTitle, x: 470, y: 420, size: 30, font: 'bold', color: fg, alpha: 0.75 });
      const column = (items, x) => items.slice(0, 5).forEach((t, i) => s.elements.push({ type: 'text', text: `${i + 1}  ${t}`, x, y: 475 + i * 56, size: 32, font: 'bold', color: fg, maxWidth: 380 }));
      column(leftItems, 60);
      column(rightItems, 470);
      stats.slice(0, 2).forEach((row, i) => stat(row, i ? 470 : 60, 820));
    }
    if (footer) s.elements.push({ type: 'text', text: footer, x: 60, y: 1060, size: 24, font: 'bold', color: fg, alpha: 0.6 });
    return s;
  }

  return { introSlide, listSlide, bigStatSlide, personSlide, summarySlide };
}

// ---------------------------------------------------------------------------
// The slide lists
// ---------------------------------------------------------------------------
function createSlides({ config, store }) {
  const L = makeLayouts(config);
  const on = config.sections;
  const tz = config.timezone;
  const words = config.words;
  const shortMoney = (x) => formatMoney(x, config.currency, Math.abs(x) >= 1000 ? 0 : undefined);
  const signedMoney = (x) => `${x >= 0 ? '+' : '−'}${shortMoney(Math.abs(x))}`;

  async function member(guild, id) {
    if (!id) return null;
    return guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
  }
  const nameOf = (m, fallback = 'Someone') => m?.displayName || m?.user?.username || fallback;
  const avatarOf = (m) => m?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;

  function musicSummary(act) {
    const m = act.music;
    const songs = Object.entries(m.songs).map(([url, s]) => ({ ...s, url })).sort((a, b) => b.count - a.count);
    return { plays: m.plays, minutes: m.seconds / 60, songs: songs.slice(0, 5), pool: songs.slice(0, 12), artists: topBy(m.artists), djs: topBy(m.djs) };
  }

  function songSummary(act, userId = null) {
    const list = act.songs.filter((s) => !userId || s.userId === userId);
    const makers = {};
    for (const s of list) makers[s.userId] = (makers[s.userId] || 0) + 1;
    const best = list.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)[0] || null;
    return { count: list.length, best, topMaker: topBy(makers, 1)[0] || null };
  }

  async function serverSlides(guild, periodCode, now = Date.now()) {
    const period = describePeriod(periodCode, tz, now);
    const act = store.getPeriod(guild.id, period.months);
    const ids = new Set([...Object.keys(act.users), ...Object.keys(act.money), ...Object.keys(act.music.djs)]);
    await loadMembers(guild, [...ids]);
    const inServer = (id) => guild.members.cache.has(id);
    const users = Object.entries(act.users).filter(([id]) => inServer(id));
    const chat = users.filter(([, r]) => r.messages > 0).sort((a, b) => b[1].messages - a[1].messages);
    const loved = users.filter(([, r]) => r.reactions > 0).sort((a, b) => b[1].reactions - a[1].reactions);
    const voice = users.filter(([, r]) => r.voiceMinutes > 0).sort((a, b) => b[1].voiceMinutes - a[1].voiceMinutes);
    const totalMessages = Object.values(act.users).reduce((s, r) => s + (r.messages || 0), 0);
    const icon = guild.iconURL?.({ extension: 'png', size: 256 }) || null;
    const slides = [L.introSlide(THEMES[0], { title: guild.name, period: period.label, image: icon })];
    slides.heading = `${guild.name} Wrapped`;
    slides.periodLabel = period.label;
    // For the video (lib/video.js): the soundtrack is drawn from these.
    slides.musicPool = on.music ? musicSummary(act).pool.filter((s) => /^https?:\/\//.test(s.url || '')) : [];
    slides.songPool = on.aiSongs ? act.songs.filter((s) => s.audioUrl) : [];
    let t = 1;
    const theme = () => THEMES[t++ % THEMES.length];

    const music = musicSummary(act);
    if (on.music && music.songs.length) {
      slides.push(L.listSlide(theme(), { kicker: 'Music', title: ['The server’s', 'top songs'], image: music.songs[0].imageUrl, rows: music.songs.map((s) => [s.title, `${s.artist ? `${s.artist} · ` : ''}${plural(s.count, 'play')}`]) }));
      const topArtist = music.artists[0];
      if (music.minutes >= 1) slides.push(L.bigStatSlide(theme(), { kicker: 'Music', lead: 'Together you listened for', big: n(music.minutes), unit: 'minutes', lines: [`That’s ${plural(music.plays, 'song')}.`, ...(topArtist ? [`Most played artist: ${topArtist[0]}`] : [])] }));
      const dj = music.djs.find(([id]) => inServer(id));
      if (dj) {
        const m = await member(guild, dj[0]);
        slides.push(L.personSlide(theme(), { kicker: 'Music', lead: 'Your resident DJ', name: nameOf(m), stat: `queued ${plural(dj[1], 'song')}`, image: avatarOf(m) }));
      }
    }
    if (on.chat && chat.length) {
      const rows = await Promise.all(chat.slice(0, 5).map(async ([id, r]) => [nameOf(await member(guild, id)), plural(r.messages, 'message')]));
      const top = await member(guild, chat[0][0]);
      slides.push(L.listSlide(theme(), { kicker: 'Chat', title: ['Top', 'chatters'], image: avatarOf(top), rows }));
      const people = Object.values(act.users).filter((r) => r.messages > 0).length;
      slides.push(L.bigStatSlide(theme(), { kicker: 'Chat', lead: 'The server sent', big: n(totalMessages), unit: totalMessages === 1 ? 'message' : 'messages', lines: [`from ${plural(people, 'person', 'people')}.`, `${nameOf(top)} alone sent ${n(chat[0][1].messages)}.`] }));
    }
    if (on.reactions && loved.length) {
      const m = await member(guild, loved[0][0]);
      slides.push(L.personSlide(theme(), { kicker: 'Chat', lead: 'Most loved messages', name: nameOf(m), stat: `${plural(loved[0][1].reactions, 'reaction')} from others`, image: avatarOf(m) }));
    }
    if (on.voice && voice.length) {
      const rows = await Promise.all(voice.slice(0, 5).map(async ([id, r]) => [nameOf(await member(guild, id)), `${n(r.voiceMinutes)} minutes in voice`]));
      slides.push(L.listSlide(theme(), { kicker: 'Voice', title: ['Always in', 'voice'], rows }));
    }
    const songs = songSummary(act);
    if (on.aiSongs && songs.count) {
      const maker = songs.topMaker && inServer(songs.topMaker[0]) ? await member(guild, songs.topMaker[0]) : null;
      const bestBy = songs.best ? await member(guild, songs.best.userId) : null;
      slides.push(
        L.bigStatSlide(theme(), {
          kicker: words.aiSongsKicker,
          lead: 'Together you made',
          big: n(songs.count),
          unit: songs.count === 1 ? words.aiSong : words.aiSongs,
          lines: [...(songs.best ? [`Best rated: ${songs.best.title || 'a banger'}`, `by ${nameOf(bestBy)}`] : []), ...(maker ? [`Top songwriter: ${nameOf(maker)}`] : [])],
          image: avatarOf(maker),
        })
      );
      slides[slides.length - 1].section = 'aiSongs'; // the video plays one of the month's AI songs on this slide
    }
    const chats = topBy(act.aiChats, 1)[0];
    if (on.aiChat && chats) {
      const total = Object.values(act.aiChats).reduce((a, b) => a + b, 0);
      const fan = await member(guild, chats[0]);
      slides.push(L.bigStatSlide(theme(), { kicker: words.aiChatKicker, lead: `${capitalise(words.aiChatName)} answered`, big: n(total), unit: total === 1 ? 'message' : 'messages', lines: [`Biggest fan: ${nameOf(fan)}`, `(${plural(chats[1], 'chat')})`], image: avatarOf(fan) }));
    }
    if (on.economy) {
      const rich = Object.entries(act.money)
        .filter(([id, g]) => inServer(id) && g.lastWorth != null)
        .sort((a, b) => b[1].lastWorth - a[1].lastWorth);
      if (rich.length) {
        const rows = await Promise.all(rich.slice(0, 5).map(async ([id, g]) => [nameOf(await member(guild, id)), shortMoney(g.lastWorth)]));
        slides.push(L.listSlide(theme(), { kicker: 'Money', title: ['The richest', 'members'], rows }));
      }
      const gamblers = Object.entries(act.money).filter(([id, g]) => inServer(id) && g.plays > 0);
      if (gamblers.length) {
        const plays = gamblers.reduce((s, [, g]) => s + g.plays, 0);
        const lucky = [...gamblers].sort((a, b) => b[1].net - a[1].net)[0];
        const m = await member(guild, lucky[0]);
        slides.push(L.bigStatSlide(theme(), { kicker: 'Money', lead: 'The server placed', big: n(plays), unit: plays === 1 ? 'bet' : 'bets', lines: lucky[1].net > 0 ? [`Luckiest: ${nameOf(m)}`, `(${signedMoney(lucky[1].net)} overall)`] : ['The house always wins.'], image: lucky[1].net > 0 ? avatarOf(m) : null }));
      }
    }

    const chatNames = on.chat ? await Promise.all(chat.slice(0, 5).map(async ([id]) => nameOf(await member(guild, id)))) : [];
    const topSongs = on.music ? music.songs.map((s) => s.title) : [];
    const stats = [
      ...(on.chat ? [['Messages', n(totalMessages)]] : []),
      ...(on.music && music.minutes >= 1 ? [['Minutes listened', n(music.minutes)]] : []),
      ...(on.voice ? [['Minutes in voice', n(Object.values(act.users).reduce((s, r) => s + (r.voiceMinutes || 0), 0))]] : []),
      ...(on.aiSongs && songs.count ? [[capitalise(words.aiSongs), n(songs.count)]] : []),
    ];
    slides.push(L.summarySlide(DARK, { title: guild.name, period: period.label, image: icon, leftTitle: 'Top chatters', left: chatNames, rightTitle: 'Top songs', right: topSongs, stats }));
    return slides;
  }

  async function userSlides(guild, userId, periodCode, now = Date.now()) {
    const period = describePeriod(periodCode, tz, now);
    const m = await member(guild, userId);
    const name = nameOf(m, 'You');
    const avatar = avatarOf(m);
    const act = store.getPeriod(guild.id, period.months);
    const me = act.users[userId] || { messages: 0, reactions: 0, voiceMinutes: 0, hours: [], days: {}, emojis: {}, duo: {} };
    const chatters = Object.values(act.users).filter((r) => r.messages > 0).length;
    const rank = Object.values(act.users).filter((r) => r.messages > me.messages).length + 1;
    const pct = chatters > 1 ? Math.max(1, Math.round((rank / chatters) * 100)) : 100;
    const slides = [L.introSlide(THEMES[1], { title: name, subtitle: guild.name, period: period.label, image: avatar })];
    slides.heading = `${name}’s Wrapped`;
    slides.periodLabel = `${guild.name} · ${period.label}`;
    let t = 2;
    const theme = () => THEMES[t++ % THEMES.length];

    const queued = on.music ? act.music.djs[userId] || 0 : 0; // songs they queued (per-person song lists aren't kept)
    if (queued) slides.push(L.bigStatSlide(theme(), { kicker: 'Music', lead: 'You queued', big: n(queued), unit: queued === 1 ? 'song' : 'songs', lines: ['The server’s soundtrack thanks you.'] }));
    if (on.chat && me.messages) {
      slides.push(L.bigStatSlide(theme(), { kicker: 'Chat', lead: 'You sent', big: n(me.messages), unit: me.messages === 1 ? 'message' : 'messages', lines: [`#${rank} of ${chatters} chatters —`, `top ${pct}% of the server.`, ...(on.reactions && me.reactions ? [`${plural(me.reactions, 'reaction')} from others.`] : [])], image: avatar }));
    }
    const hours = me.hours || [];
    if (on.peakHour && hours.some((v) => v > 0)) {
      const peak = hours.indexOf(Math.max(...hours));
      const [bigDay, bigCount] = Object.entries(me.days || {}).sort((a, b) => b[1] - a[1])[0] || [];
      const when = peak === 0 ? 'midnight — go to sleep.' : peak < 5 ? 'go to sleep.' : peak < 12 ? 'in the morning' : peak === 12 ? 'at midday' : peak < 18 ? 'in the afternoon' : 'at night';
      const lines = bigDay ? [`Your biggest day: ${dayText(bigDay)}`, `${plural(bigCount, 'message')} in one day.`] : [];
      if (config.showTimezone) lines.push(`Times in ${config.timezoneLabel || tz}.`);
      const s = L.bigStatSlide(theme(), { kicker: 'Peak', lead: 'You were most active at', big: hourText(peak), unit: when, lines });
      s.name = `You were most active at ${hourText(peak)}`;
      slides.push(s);
    }
    if (on.duo) {
      const duoScores = {};
      for (const [other, pts] of Object.entries(me.duo || {})) duoScores[other] = (duoScores[other] || 0) + pts;
      for (const [other, row] of Object.entries(act.users)) if (row.duo?.[userId]) duoScores[other] = (duoScores[other] || 0) + row.duo[userId];
      delete duoScores[userId];
      const [duoId, duoPoints] = topBy(duoScores, 1)[0] || [];
      if (duoId && duoPoints >= 3) {
        const partner = await member(guild, duoId);
        slides.push(L.personSlide(theme(), { kicker: 'Duo', lead: 'Your duo', name: nameOf(partner), stat: 'You two were inseparable.', sub: 'The person you replied to and reacted to most.', image: avatarOf(partner) }));
      }
    }
    if (on.voice && me.voiceMinutes) slides.push(L.bigStatSlide(theme(), { kicker: 'Voice', lead: 'You hung out in voice for', big: n(me.voiceMinutes), unit: 'minutes', lines: [`That’s ${(me.voiceMinutes / 60).toFixed(1)} hours with the gang.`] }));
    const songs = songSummary(act, userId);
    if (on.aiSongs && songs.count) {
      slides.push(L.bigStatSlide(theme(), { kicker: words.aiSongsKicker, lead: 'You made', big: n(songs.count), unit: songs.count === 1 ? words.aiSong : words.aiSongs, lines: songs.best ? [`Your best: ${songs.best.title || 'a banger'}`] : [] }));
    }
    const aiChats = act.aiChats[userId] || 0;
    if (on.aiChat && aiChats) slides.push(L.bigStatSlide(theme(), { kicker: words.aiChatKicker, lead: `You talked to ${words.aiChatName}`, big: n(aiChats), unit: aiChats === 1 ? 'time' : 'times', lines: ['It’ll pretend it didn’t enjoy it.'] }));
    const [emojiKey, emojiCount] = topBy(me.emojis || {}, 1)[0] || [];
    if (on.emoji && emojiKey && emojiCount >= 3) {
      slides.push(L.personSlide(theme(), { kicker: 'Emoji', lead: 'Your go-to emoji', name: emojiKey.startsWith('c:') ? `:${emojiKey.split(':')[1]}:` : null, stat: `used ${plural(emojiCount, 'time')}`, image: emojiImage(emojiKey), square: true }));
    }
    const cash = act.money[userId] || { plays: 0, net: 0 };
    const worthChange = cash.firstWorth != null && cash.lastWorth != null ? cash.lastWorth - cash.firstWorth : null;
    if (on.economy && (cash.plays || worthChange)) {
      const lines = [];
      if (cash.plays) lines.push(`${plural(cash.plays, 'bet')}: ${signedMoney(cash.net)} overall`);
      if (cash.bestWin) lines.push(`Best win: ${shortMoney(cash.bestWin.amount)} on ${cash.bestWin.game}`);
      if (cash.worstLoss) lines.push(`Worst loss: ${shortMoney(-cash.worstLoss.amount)} on ${cash.worstLoss.game}`);
      slides.push(L.bigStatSlide(theme(), { kicker: 'Money', lead: 'Your money month', big: worthChange ? signedMoney(worthChange) : signedMoney(cash.net), unit: worthChange ? 'net worth' : 'from betting', lines }));
    }
    let personality = null;
    if (on.personality) {
      personality = personalityFor({ me, on, queued, aiChats, songs: songs.count, bets: cash.plays || 0, pct, words });
      slides.push(L.personSlide(theme(), { kicker: 'You', lead: 'Your chat personality', name: personality.name, stat: personality.line, image: avatar }));
    }
    const stats = [
      ...(on.chat ? [['Messages', n(me.messages)]] : []),
      ...(personality ? [['Personality', personality.name.replace(/^The /, '')]] : []),
      ...(on.peakHour && hours.some((v) => v > 0) ? [['Peak hour', hourText(hours.indexOf(Math.max(...hours)))]] : []),
      ...(on.voice && me.voiceMinutes ? [['Minutes in voice', n(me.voiceMinutes)]] : []),
      ...(on.peakHour && Object.keys(me.days || {}).length ? [['Biggest day', dayText(Object.entries(me.days).sort((a, b) => b[1] - a[1])[0][0]).replace(/ (\w{3})\w*/, ' $1')]] : []),
    ].slice(0, 4);
    slides.push(L.summarySlide(DARK, { title: name, subtitle: guild.name, period: period.label, image: avatar, left: [], right: [], stats }));
    return slides;
  }

  return { serverSlides, userSlides, periodFor: (word, now) => periodFor(word, tz, now), describePeriod: (code, now) => describePeriod(code, tz, now) };
}

/**
 * A chat personality, like Spotify's listening personality: every archetype gets a score (how far past its bar they
 * are) and the strongest wins; "The Regular" if nothing stands out. Only archetypes for switched-on sections compete.
 */
function personalityFor({ me, on, queued, aiChats, songs, bets, pct, words }) {
  const total = me.messages || 0;
  const hours = me.hours || [];
  const share = (from, to) => (total ? hours.slice(from, to).reduce((a, b) => a + b, 0) / total : 0);
  const candidates = [
    on.peakHour && { name: 'The Night Owl', line: 'Most of your chatting happened after midnight.', score: total >= 20 ? share(0, 6) / 0.3 : 0 },
    on.peakHour && { name: 'The Early Bird', line: 'Up and chatting before most people had coffee.', score: total >= 20 ? share(5, 10) / 0.3 : 0 },
    on.reactions && { name: 'The Hype Machine', line: 'People couldn’t stop reacting to your messages.', score: me.reactions >= 10 && total ? me.reactions / total / 0.5 : 0 },
    on.chat && { name: 'The Chatterbox', line: 'If the chat was moving, it was probably you.', score: total >= 100 ? (100 - pct) / 85 : 0 },
    on.music && { name: 'The DJ', line: 'The server’s soundtrack was mostly your picks.', score: queued / 15 },
    on.voice && { name: 'The Voice of the Server', line: 'Basically lived in the voice channels.', score: (me.voiceMinutes || 0) / 300 },
    on.voice && { name: 'The Lurker', line: 'Always around, rarely typing.', score: (me.voiceMinutes || 0) >= 60 && total < 30 ? 1.2 : 0 },
    on.aiChat && { name: `${capitalise(words.aiChatName)}’s Best Friend`, line: 'You kept coming back for more.', score: aiChats / 15 },
    on.aiSongs && { name: 'The Songwriter', line: `The server’s biggest ${words.aiSong} maker.`, score: songs / 6 },
    on.economy && { name: 'The High Roller', line: 'The casino knows you by name.', score: bets / 25 },
  ].filter(Boolean);
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 1 ? best : { name: 'The Regular', line: 'A bit of everything — the glue of the server.' };
}

const capitalise = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

function formatMoney(amount, currency, decimals) {
  const d = decimals ?? currency.decimals;
  const text = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = amount < 0 ? '-' : '';
  return currency.after ? `${sign}${text}${currency.symbol}` : `${sign}${currency.symbol}${text}`;
}

/** Makes sure the given members are known (not just whoever the bot has seen since its last restart). */
async function loadMembers(guild, ids) {
  const missing = [...new Set(ids)].filter((id) => /^\d{15,25}$/.test(id) && !guild.members.cache.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    await guild.members.fetch({ user: missing.slice(i, i + 100) }).catch(() => null);
  }
}

module.exports = { createSlides, THEMES };
