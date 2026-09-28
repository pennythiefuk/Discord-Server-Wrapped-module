// Server Wrapped — settings. Change what you like, then restart your bot.

module.exports = {
  // The small title at the top of every slide.
  name: 'SERVER WRAPPED',

  // Optional small text at the bottom of every slide (e.g. your bot's name or website). Leave '' for none.
  footer: '',

  // Text command: people type  !wrapped  (or !wrapped last, !wrapped year, !wrapped @someone).
  prefix: '!',
  command: 'wrapped',

  // Slash commands /wrapped and /wrapped-autopost:
  //   'global' — added automatically for every server (can take up to an hour to appear the first time)
  //   'guild'  — added to each server straight away (good for small/private bots)
  //   'off'    — don't add them (use this if your bot registers its own commands — see README.txt)
  slashCommands: 'global',

  // Your server's timezone. Months, days and "most active hour" follow it.
  // Full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones  (the "TZ identifier" column)
  timezone: 'UTC',
  timezoneLabel: '', // how the timezone is shown on the peak-hour slide, e.g. 'UK time'. '' shows the name above.
  showTimezone: true,

  // Where the stats are saved. Keep this file — it's everyone's history.
  dataFile: './wrapped-data.json',

  // Which sections appear. A section only shows up when it's on here AND there's something to show.
  sections: {
    // Counted automatically — nothing else to set up.
    chat: true, //        top chatters, messages sent
    reactions: true, //   most loved messages (reactions from others)
    voice: true, //       minutes in voice channels
    emoji: true, //       each person's go-to emoji
    duo: true, //         the person you replied to / reacted to most
    peakHour: true, //    most active hour and biggest day
    personality: true, // a fun "chat personality" at the end of a personal Wrapped

    // Need your bot to report them (see "Optional sections" in README.txt). Leave off if your bot doesn't have them.
    music: false, //      top songs, minutes listened, resident DJ   → call wrapped.trackPlay(...)
    aiSongs: false, //    songs made with an AI song generator       → call wrapped.trackSong(...)
    aiChat: false, //     messages answered by your AI chatbot       → call wrapped.trackAiChat(...)
    economy: false, //    richest members, bets, money won and lost  → call wrapped.trackWorth(...) / trackGamble(...)
  },

  // Words used on the optional slides.
  words: {
    aiSong: 'AI song', //       one song — e.g. 'Suno song'
    aiSongs: 'AI songs', //     several songs
    aiSongsKicker: 'Songs', //  small label at the top of the slide
    aiChatName: 'the AI', //    your chatbot's name, e.g. 'Nova'
    aiChatKicker: 'AI',
  },

  // Money on the economy slides.
  currency: {
    symbol: '$',
    decimals: 2, //   0 if your economy uses whole coins
    after: false, //  true puts the symbol after the number (e.g. 100 coins → symbol: ' coins', decimals: 0, after: true)
  },

  // Voice minutes only count when there are at least 2 people in the channel (stops AFK farming).
  voiceNeedsTwoPeople: true,

  // OPTIONAL ADD-ON: a "▶ Play as video" button on the server Wrapped — the slides as a video with music.
  // Needs ffmpeg installed (and yt-dlp for song clips). See "VIDEO ADD-ON" in README.txt before turning it on.
  video: {
    enabled: false,
    ffmpegPath: 'ffmpeg', //  'ffmpeg' if it's installed normally, or the full path, e.g. 'C:/ffmpeg/bin/ffmpeg.exe',
    //                         or require('ffmpeg-static') if you installed it with npm
    ytdlpPath: 'yt-dlp', //   same idea — only needed for song clips from the music section
    useMusic: true, //        play clips of the top songs (needs the music section on, and yt-dlp)
    backgroundMusic: '', //   a music file to play when there are no song clips, e.g. './wrapped-music.mp3'
    slideSeconds: 6, //       how long each slide stays on screen
  },

  // Optional: your own fonts (.ttf/.otf paths). The bundled Montserrat is used for any you leave out.
  fonts: {
    // black: './fonts/MyFont-Black.ttf',
    // bold: './fonts/MyFont-Bold.ttf',
    // regular: './fonts/MyFont-Regular.ttf',
  },
};
