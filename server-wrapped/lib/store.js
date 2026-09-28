const fs = require('fs');
const path = require('path');
const { monthKey, dayKey, hourOf } = require('./time.js');

// Everything Wrapped knows, in one JSON file, per server and per month:
//
// { guilds: { [guildId]: {
//     months: { ["YYYY-MM"]: {
//       users: { [userId]: { messages, reactions, voiceMinutes, hours: [24], days: { "YYYY-MM-DD": n }, emojis: { key: n }, duo: { otherId: points } } },
//       music: { plays, seconds, songs: { [key]: { title, artist, imageUrl, count } }, artists: { name: n }, djs: { userId: n } },
//       songs: [ { id, userId, title, audioUrl, score, at } ], (AI song generations)
//       aiChats: { userId: n },                                 (AI chatbot replies)
//       money: { [userId]: { plays, net, bestWin, worstLoss, firstWorth, lastWorth } },
//     } },
//     autopost: { channelId, lastPosted } } } }
//
// It's kept in memory and written at most once a minute — it's touched on every message, far too often for a write
// each time (a crash loses at most a minute of counts). An emoji key is "u:<emoji>" or "c:<name>:<id>" (a custom one).
// Duo points: a reply to someone is 2, a reaction 1.

const FLUSH_MS = 60 * 1000;
const MAX_SONGS_PER_MONTH = 500; // keeps a busy month's lists from growing without limit (least-played dropped)
const MAX_KEYS_PER_USER = 60; // same idea for someone's emoji / duo lists
const EMOJI_RE = /<a?:(\w+):(\d+)>|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

function createStore({ file, timeZone }) {
  let data = null;
  let dirty = false;

  function load() {
    if (data) return data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = {};
    }
    data.guilds ||= {};
    return data;
  }

  function flush() {
    if (!dirty || !data) return;
    dirty = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  const timer = setInterval(() => {
    try {
      flush();
    } catch (err) {
      console.error('Wrapped: saving stats failed:', err.message);
    }
  }, FLUSH_MS);
  timer.unref?.();
  // Save on Ctrl+C / pm2 stop too. Listening for a signal cancels Node's normal exit, so if nothing else in the bot is
  // listening, exit the usual way afterwards.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      try {
        flush();
      } catch {}
      if (process.listenerCount(sig) === 0) process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
  process.once('beforeExit', () => {
    try {
      flush();
    } catch {}
  });

  const guildData = (guildId) => (load().guilds[guildId] ||= { months: {} });
  function bucket(guildId, ts) {
    const months = guildData(guildId).months;
    return (months[monthKey(ts, timeZone)] ||= { users: {}, music: emptyMusic(), songs: [], aiChats: {}, money: {} });
  }
  function userRow(b, userId) {
    const row = (b.users[userId] ||= { messages: 0, reactions: 0, voiceMinutes: 0 });
    row.hours ||= new Array(24).fill(0);
    row.days ||= {};
    row.emojis ||= {};
    row.duo ||= {};
    return row;
  }
  const touch = () => {
    dirty = true;
  };

  return {
    flush,
    guildData,
    touch,

    recordMessage(guildId, userId, ts, { content = '', replyTo = null } = {}) {
      const row = userRow(bucket(guildId, ts), userId);
      row.messages += 1;
      row.hours[hourOf(ts, timeZone)] += 1;
      const day = dayKey(ts, timeZone);
      row.days[day] = (row.days[day] || 0) + 1;
      for (const key of emojiKeys(content)) bump(row.emojis, key);
      if (replyTo && replyTo !== userId) bump(row.duo, replyTo, 2);
      touch();
    },

    recordReaction(guildId, authorId, reactorId, emoji, ts) {
      const b = bucket(guildId, ts);
      userRow(b, authorId).reactions += 1;
      const reactor = userRow(b, reactorId);
      bump(reactor.duo, authorId, 1);
      if (emoji) bump(reactor.emojis, emoji);
      touch();
    },

    recordVoiceMinutes(guildId, userId, minutes, ts) {
      userRow(bucket(guildId, ts), userId).voiceMinutes += minutes;
      touch();
    },

    recordPlay(guildId, track, ts) {
      const music = bucket(guildId, ts).music;
      music.plays += 1;
      const seconds = Number(track.durationSeconds);
      if (Number.isFinite(seconds) && seconds > 0 && !track.live) music.seconds += Math.round(seconds);
      const key = track.url || track.title;
      if (key) {
        const song = (music.songs[key] ||= { title: track.title || 'Unknown', artist: track.artist || null, imageUrl: track.imageUrl || null, count: 0 });
        song.count += 1;
        const keys = Object.keys(music.songs);
        if (keys.length > MAX_SONGS_PER_MONTH) {
          const least = keys.reduce((a, b) => (music.songs[a].count <= music.songs[b].count ? a : b));
          if (least !== key) delete music.songs[least];
        }
      }
      if (track.artist) music.artists[track.artist] = (music.artists[track.artist] || 0) + 1;
      if (track.requestedById) music.djs[track.requestedById] = (music.djs[track.requestedById] || 0) + 1;
      touch();
    },

    recordSong(guildId, userId, { id = null, title = null, audioUrl = null } = {}, ts) {
      const list = bucket(guildId, ts).songs;
      list.push({ id: id != null ? String(id) : null, userId, title: title || null, audioUrl: /^https?:\/\//.test(audioUrl || '') ? audioUrl : null, score: 0, at: ts });
      if (list.length > MAX_SONGS_PER_MONTH * 4) list.splice(0, list.length - MAX_SONGS_PER_MONTH * 4);
      touch();
    },

    setSongScore(guildId, songId, score) {
      for (const month of Object.values(guildData(guildId).months)) {
        const song = (month.songs || []).find((s) => s.id === String(songId));
        if (song) {
          song.score = Number(score) || 0;
          touch();
          return true;
        }
      }
      return false;
    },

    recordAiChat(guildId, userId, ts) {
      const chats = bucket(guildId, ts).aiChats;
      chats[userId] = (chats[userId] || 0) + 1;
      touch();
    },

    recordGamble(guildId, userId, game, net, ts) {
      const g = moneyRow(bucket(guildId, ts), userId);
      g.plays += 1;
      g.net += net;
      if (net > 0 && (!g.bestWin || net > g.bestWin.amount)) g.bestWin = { amount: net, game };
      if (net < 0 && (!g.worstLoss || net < g.worstLoss.amount)) g.worstLoss = { amount: net, game };
      touch();
    },

    recordWorth(guildId, userId, worth, ts) {
      const g = moneyRow(bucket(guildId, ts), userId);
      if (g.firstWorth == null) g.firstWorth = worth;
      g.lastWorth = worth;
      touch();
    },

    /** The given months of one server added together. */
    getPeriod(guildId, months) {
      const stored = guildData(guildId).months;
      const out = { users: {}, music: emptyMusic(), songs: [], aiChats: {}, money: {} };
      for (const key of months) {
        const b = stored[key];
        if (!b) continue;
        for (const [uid, row] of Object.entries(b.users || {})) {
          const o = userRow(out, uid);
          o.messages += row.messages || 0;
          o.reactions += row.reactions || 0;
          o.voiceMinutes += row.voiceMinutes || 0;
          (row.hours || []).forEach((v, h) => (o.hours[h] += v || 0));
          for (const [k, v] of Object.entries(row.days || {})) o.days[k] = (o.days[k] || 0) + v;
          for (const [k, v] of Object.entries(row.emojis || {})) o.emojis[k] = (o.emojis[k] || 0) + v;
          for (const [k, v] of Object.entries(row.duo || {})) o.duo[k] = (o.duo[k] || 0) + v;
        }
        const m = b.music || {};
        out.music.plays += m.plays || 0;
        out.music.seconds += m.seconds || 0;
        for (const [k, s] of Object.entries(m.songs || {})) (out.music.songs[k] ||= { ...s, count: 0 }).count += s.count || 0;
        for (const [k, v] of Object.entries(m.artists || {})) out.music.artists[k] = (out.music.artists[k] || 0) + v;
        for (const [k, v] of Object.entries(m.djs || {})) out.music.djs[k] = (out.music.djs[k] || 0) + v;
        out.songs.push(...(b.songs || []));
        for (const [k, v] of Object.entries(b.aiChats || {})) out.aiChats[k] = (out.aiChats[k] || 0) + v;
        for (const [uid, g] of Object.entries(b.money || {})) {
          const o = moneyRow(out, uid);
          o.plays += g.plays || 0;
          o.net += g.net || 0;
          if (g.bestWin && (!o.bestWin || g.bestWin.amount > o.bestWin.amount)) o.bestWin = g.bestWin;
          if (g.worstLoss && (!o.worstLoss || g.worstLoss.amount < o.worstLoss.amount)) o.worstLoss = g.worstLoss;
          if (g.firstWorth != null && o.firstWorth == null) o.firstWorth = g.firstWorth;
          if (g.lastWorth != null) o.lastWorth = g.lastWorth;
        }
      }
      return out;
    },
  };
}

const emptyMusic = () => ({ plays: 0, seconds: 0, songs: {}, artists: {}, djs: {} });
const moneyRow = (b, userId) => ((b.money ||= {})[userId] ||= { plays: 0, net: 0, bestWin: null, worstLoss: null, firstWorth: null, lastWorth: null });

/** Adds `amount` to `map[key]`, dropping the smallest entry once the map has too many. */
function bump(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
  const keys = Object.keys(map);
  if (keys.length > MAX_KEYS_PER_USER) {
    const least = keys.reduce((a, b) => (map[a] <= map[b] ? a : b));
    if (least !== key) delete map[least];
  }
}

/** Emoji keys in a message's text (at most 10 counted per message). */
function emojiKeys(content) {
  const out = [];
  for (const m of String(content || '').matchAll(EMOJI_RE)) {
    out.push(m[2] ? `c:${m[1]}:${m[2]}` : `u:${m[0]}`);
    if (out.length >= 10) break;
  }
  return out;
}

module.exports = { createStore, emojiKeys };
