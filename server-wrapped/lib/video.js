const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { renderSlide } = require('./render.js');

// OPTIONAL ADD-ON: the server Wrapped as a video, like Spotify Wrapped's story. Every slide in turn (held still, with a
// swipe / wipe / circle-reveal between them) and music under it:
//   - songs from the music section: 3 picked at random from the period's top 12, each from a random point (needs yt-dlp)
//   - an AI song from the period on the AI-songs slide (needs trackSong(..., { audioUrl }))
//   - otherwise config.video.backgroundMusic, if set
//   - otherwise silent.
// Everything is drawn and joined by ffmpeg, at low CPU priority so the bot stays responsive.

const TRANSITION_SECONDS = 0.8;
const AUDIO_FADE_SECONDS = 1.2;
const FPS = 24;
const OUT_W = 720;
const OUT_H = 900;
const TRANSITIONS = ['slideleft', 'circleopen', 'wipeup', 'smoothleft', 'radial', 'slideup', 'diagtr', 'circlecrop', 'smoothup', 'hrslice'];

/** Runs a program; resolves with its output, rejects with the end of its error output. */
function run(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    try {
      os.setPriority(child.pid, 10); // below normal — the bot itself keeps priority
    } catch {}
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      if (process.env.WRAPPED_DEBUG) console.error(`[wrapped] ${cmd} ${args.join(' ')}\n${stderr}`); // full details for troubleshooting
      reject(new Error(`${path.basename(cmd)} failed (${code === null ? 'timed out' : `exit ${code}`}): ${stderr.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

/** Checks which tools are installed: { ffmpeg: 'version text' | null, ytdlp: 'version' | null }. */
async function checkTools({ ffmpegPath, ytdlpPath }) {
  const version = async (cmd, arg) => {
    try {
      const { stdout } = await run(cmd, [arg], { timeoutMs: 20000 });
      return stdout.split('\n')[0].trim() || 'installed';
    } catch {
      return null;
    }
  };
  return { ffmpeg: await version(ffmpegPath, '-version'), ytdlp: ytdlpPath ? await version(ytdlpPath, '--version') : null };
}

/** Where the audio comes from for each slide: 'song:<n>' (the nth song clip), 'ai', or null (silence). */
function planSoundtrack(slides, { songCount, hasAi }) {
  const plan = new Array(slides.length).fill(null);
  if (!songCount && !hasAi) return plan;
  const special = (s) => (hasAi && s.section === 'aiSongs') || s.name === 'Summary';
  const regular = slides.map((s, i) => (special(s) ? null : i)).filter((i) => i !== null);
  const perSong = Math.max(1, Math.ceil(regular.length / Math.max(1, songCount)));
  regular.forEach((slideIndex, k) => {
    plan[slideIndex] = songCount ? `song:${Math.min(songCount - 1, Math.floor(k / perSong))}` : 'ai';
  });
  slides.forEach((s, i) => {
    if (hasAi && s.section === 'aiSongs') plan[i] = 'ai';
    if (s.name === 'Summary') plan[i] = songCount ? 'song:0' : 'ai'; // the first song comes back for the ending
  });
  return plan;
}

/** Consecutive slides with the same clip merged: [{ clip, from, count }]. */
function segmentsOf(plan) {
  const segments = [];
  plan.forEach((clip, i) => {
    const last = segments[segments.length - 1];
    if (last && last.clip === clip) last.count += 1;
    else segments.push({ clip, from: i, count: 1 });
  });
  return segments;
}

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function createVideoMaker({ config, serverSlides }) {
  const opts = config.video;
  const ffmpeg = opts.ffmpegPath;
  const ytdlp = opts.ytdlpPath;
  const SLIDE_SECONDS = opts.slideSeconds;
  const slideStart = (i) => i * (SLIDE_SECONDS - TRANSITION_SECONDS);
  const videoLength = (n) => n * SLIDE_SECONDS - (n - 1) * TRANSITION_SECONDS;
  const ffmpegLocation = /[\\/]/.test(ffmpeg) ? ['--ffmpeg-location', ffmpeg] : []; // a bare "ffmpeg" is found on PATH by yt-dlp too

  /** `seconds` of a song from a random point, as a WAV. yt-dlp cuts the section itself (sites often refuse plain downloads). */
  async function fetchSongClip(song, seconds, file) {
    let duration = Number(song.durationSeconds) || 0;
    if (!duration) {
      const { stdout } = await run(ytdlp, ['--no-playlist', '--skip-download', '--print', '%(duration)s', song.url], { timeoutMs: 60000 });
      duration = Number(stdout.trim().split('\n')[0]) || 0;
    }
    const earliest = duration ? Math.min(15, duration * 0.1) : 20;
    const latest = duration ? Math.max(earliest, duration - seconds - 5) : 90;
    const start = earliest + Math.random() * (latest - earliest);
    const dir = path.dirname(file);
    const base = path.basename(file, '.wav');
    await run(ytdlp, ['-f', 'bestaudio/best', '--no-playlist', '--no-part', ...ffmpegLocation, '--download-sections', `*${Math.round(start)}-${Math.round(start + seconds)}`, '-o', path.join(dir, `${base}.raw.%(ext)s`), song.url], { timeoutMs: 120000 });
    const raw = fs.readdirSync(dir).find((name) => name.startsWith(`${base}.raw.`));
    if (!raw) throw new Error('nothing downloaded');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, raw), '-t', String(seconds), '-vn', '-ac', '2', '-ar', '44100', file], { timeoutMs: 60000 });
  }

  /** `seconds` of an audio file or direct link as a WAV (looped if it's shorter). */
  async function fetchAudioClip(source, seconds, file, start = 0) {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-ss', String(start), '-i', source, '-t', String(seconds), '-vn', '-ac', '2', '-ar', '44100', file], { timeoutMs: 90000 });
  }

  /** Builds the video: { buffer, seconds, soundtrack: [titles] }. */
  async function makeVideo(guild, periodCode) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapped-video-'));
    try {
      const slides = await serverSlides(guild, periodCode);
      const pngs = [];
      for (const [i, slide] of slides.entries()) {
        const file = path.join(dir, `slide${i}.png`);
        fs.writeFileSync(file, await renderSlide(slide));
        pngs.push(file);
      }
      const n = slides.length;
      const total = videoLength(n);
      const clipSeconds = Math.ceil(SLIDE_SECONDS * 6 + AUDIO_FADE_SECONDS + 1); // long enough for any stretch it could get

      // Up to 3 song clips, picked at random from the top songs (needs yt-dlp).
      const songs = [];
      const songFiles = [];
      if (ytdlp && opts.useMusic) {
        for (const song of shuffled(slides.musicPool || [])) {
          if (songs.length >= 3) break;
          const file = path.join(dir, `song${songs.length}.wav`);
          try {
            await fetchSongClip(song, clipSeconds, file);
            songs.push(song);
            songFiles.push(file);
          } catch (err) {
            console.error(`[wrapped] video: skipped "${song.title}":`, err.message.slice(-200));
          }
        }
      }
      // One of the period's AI songs, for its slide (tries up to 6 in case a link has gone).
      let aiFile = null;
      let aiSong = null;
      if (slides.some((s) => s.section === 'aiSongs')) {
        for (const song of shuffled(slides.songPool || []).slice(0, 6)) {
          const file = path.join(dir, 'ai.wav');
          try {
            await fetchAudioClip(song.audioUrl, clipSeconds, file, 20);
            aiFile = file;
            aiSong = song;
            break;
          } catch (err) {
            console.error(`[wrapped] video: skipped AI song "${song.title}":`, err.message.slice(-200));
          }
        }
      }

      const soundtrack = [];
      const audioInputs = [];
      const graph = [];
      const inputs = [];
      pngs.forEach((file, i) => {
        inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(SLIDE_SECONDS), '-i', file);
        graph.push(`[${i}:v]scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1,format=yuv420p,trim=end_frame=${Math.round(SLIDE_SECONDS * FPS)},setpts=PTS-STARTPTS,fps=${FPS}[v${i}]`); // held still; xfade needs a set frame rate
      });
      let video = '[v0]';
      for (let i = 1; i < n; i++) {
        graph.push(`${video}[v${i}]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${TRANSITION_SECONDS}:offset=${slideStart(i).toFixed(2)}[x${i}]`);
        video = `[x${i}]`;
      }

      if (songFiles.length || aiFile) {
        const plan = planSoundtrack(slides, { songCount: songFiles.length, hasAi: Boolean(aiFile) });
        const segments = segmentsOf(plan);
        segments.forEach((seg) => {
          const end = seg.from + seg.count >= n ? total : slideStart(seg.from + seg.count);
          seg.seconds = end - slideStart(seg.from);
        });
        for (const key of [...new Set(plan.filter(Boolean))]) {
          if (key === 'ai') soundtrack.push(`${aiSong.title || 'an AI song'} (${config.words.aiSong})`);
          else soundtrack.push(songs[Number(key.split(':')[1])].title);
        }
        segments.forEach((seg, k) => {
          const file = seg.clip === 'ai' ? aiFile : seg.clip ? songFiles[Number(seg.clip.split(':')[1])] : aiFile || songFiles[0];
          const len = seg.seconds + (k < segments.length - 1 ? AUDIO_FADE_SECONDS : 0);
          audioInputs.push({ file, trim: len });
        });
      } else if (opts.backgroundMusic) {
        const file = path.join(dir, 'background.wav');
        try {
          await fetchAudioClip(path.resolve(opts.backgroundMusic), Math.ceil(total) + 1, file);
          audioInputs.push({ file, trim: total });
          soundtrack.push(path.basename(opts.backgroundMusic).replace(/\.[^.]+$/, ''));
        } catch (err) {
          console.error("[wrapped] video: couldn't read backgroundMusic:", err.message.slice(-200));
        }
      }

      let audio = null;
      audioInputs.forEach(({ file, trim }, k) => {
        inputs.push('-i', file);
        graph.push(`[${n + k}:a]atrim=0:${trim.toFixed(2)},asetpts=N/SR/TB,aformat=sample_rates=44100:channel_layouts=stereo[a${k}]`);
        if (k === 0) audio = '[a0]';
        else {
          graph.push(`${audio}[a${k}]acrossfade=d=${AUDIO_FADE_SECONDS}:c1=tri:c2=tri[ax${k}]`);
          audio = `[ax${k}]`;
        }
      });
      if (audio) {
        graph.push(`${audio}apad,atrim=0:${total.toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${(total - 2).toFixed(2)}:d=2,loudnorm=I=-16:TP=-1.5,aresample=44100[aout]`);
        audio = '[aout]';
      }

      const out = path.join(dir, 'wrapped.mp4');
      const audioArgs = audio ? ['-map', audio, '-c:a', 'aac', '-b:a', '128k'] : ['-an'];
      await run(
        ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph.join(';'), '-map', video, ...audioArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-maxrate', '1500k', '-bufsize', '3000k', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-t', total.toFixed(2), '-movflags', '+faststart', out],
        { timeoutMs: 5 * 60 * 1000 }
      );
      return { buffer: fs.readFileSync(out), seconds: total, soundtrack };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return { makeVideo };
}

/** The largest file the bot can upload in this server (Discord's limit goes up with server boosts). */
function uploadLimitFor(guild) {
  const tier = guild?.premiumTier || 0;
  return (tier >= 3 ? 100 : tier === 2 ? 50 : 10) * 1024 * 1024;
}

module.exports = { createVideoMaker, checkTools, planSoundtrack, segmentsOf, uploadLimitFor };
