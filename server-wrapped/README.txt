SERVER WRAPPED — a Spotify Wrapped-style recap for your Discord server
=======================================================================

People type  !wrapped  (or use /wrapped) and get picture slides of the server's month:
top chatters, most loved messages, time in voice, and more. Each person can also see
their own: messages sent, most active hour, their "duo", go-to emoji and a chat personality.

Works with any discord.js v14 bot. Stats start counting the moment you add it.


WHAT YOU NEED
-------------
- Node.js 18 or newer
- discord.js 14.19 or newer   (check with:  npm ls discord.js   — update with:  npm install discord.js@14)
- Only for the optional video add-on: ffmpeg (and yt-dlp) — see "VIDEO ADD-ON" below.


SETUP (5 steps)
---------------

1) Copy the "server-wrapped" folder into your bot's folder (next to your main bot file).

2) In your bot's folder, run:

       npm install @napi-rs/canvas

   (This draws the slides. It works on Windows, Mac and Linux — nothing else to install.)

3) Turn on the Message Content intent:
   https://discord.com/developers/applications → your bot → "Bot" → Privileged Gateway Intents
   → switch on MESSAGE CONTENT INTENT → Save.

4) In your main bot file, make sure your client has these intents and partials, then add the
   Wrapped line straight after it:

       const { Client, GatewayIntentBits, Partials } = require('discord.js');

       const client = new Client({
         intents: [
           GatewayIntentBits.Guilds,
           GatewayIntentBits.GuildMessages,
           GatewayIntentBits.MessageContent,
           GatewayIntentBits.GuildMessageReactions,
           GatewayIntentBits.GuildVoiceStates,
         ],
         partials: [Partials.Message, Partials.Channel, Partials.Reaction],
       });

       const wrapped = require('./server-wrapped')(client, require('./server-wrapped/wrapped.config.js'));

   (Already have intents? Just add any that are missing from the list.)

5) Open server-wrapped/wrapped.config.js, set your timezone and anything else you like,
   then restart your bot.

That's it. If something's missing, the bot prints a "[wrapped]" warning when it starts.


COMMANDS
--------
  !wrapped                  this server, this month so far
  !wrapped last             last month
  !wrapped year             this year
  !wrapped @someone         one person's Wrapped (add "last" or "year" too)
  /wrapped                  the same, as a slash command (period + user options)

  Server admins (Manage Server permission):
  !wrapped autopost on      post last month's Wrapped in this channel on the 1st of each month
  !wrapped autopost off     stop it
  /wrapped-autopost         the same, as a slash command

Only the person who asked can flip through the slides (with the menu under the picture).
The monthly auto-post can be flipped through by anyone.

Note: stats count from when you add this. The first Wrapped will be small — it fills up
over the month.


CHOOSING SECTIONS
-----------------
In wrapped.config.js, "sections" switches each part on or off. A slide only appears when
its section is on AND there's something to show.

These count by themselves (on by default):
  chat, reactions, voice, emoji, duo, peakHour, personality

These need your bot to tell Wrapped when something happens (off by default). Only turn one
on if your bot has that feature — then add the line shown below where it happens:

  music     — your bot plays music
      wrapped.trackPlay(guild.id, {
        title: 'Song name',
        artist: 'Artist',              // optional
        url: 'https://…',              // optional (used to tell songs apart)
        imageUrl: 'https://…',         // optional (cover art)
        durationSeconds: 215,          // optional (for "minutes listened")
        requestedById: user.id,        // optional (for "resident DJ")
      });
    → put it where a song starts playing.

  aiSongs   — your bot makes songs with an AI (Suno etc.)
      wrapped.trackSong(guild.id, user.id, { id: 'any-id', title: 'Song name' });
    → put it where a song finishes generating.
    Optional: wrapped.setSongScore(guild.id, 'any-id', upvotes - downvotes);  → "best rated" song
    Optional: add  audioUrl: 'https://…/song.mp3'  so the video add-on can play it.
    Change the wording in "words" (e.g. aiSong: 'Suno song', aiSongs: 'Suno songs').

  aiChat    — your bot has an AI chatbot
      wrapped.trackAiChat(guild.id, user.id);
    → put it where the chatbot replies to someone.
    Set words.aiChatName to your chatbot's name.

  economy   — your bot has money/coins
      wrapped.trackWorth(guild.id, user.id, walletPlusBank);
    → call it whenever someone's money changes (or once a day for everyone).
      This gives "richest members" and each person's money change for the month.
      wrapped.trackGamble(guild.id, user.id, 'slots', winnings - bet);
    → call it after a bet/game (negative for a loss). This gives bets, best win, worst loss.
    Use normal money amounts (12.5 means 12.50). Set "currency" in the config.


VIDEO ADD-ON (optional) — "▶ Play as video"
--------------------------------------------
Adds a button under the server Wrapped that turns the slides into a video (about a
minute long) with swipe transitions and music underneath, like Spotify's Wrapped story.
Only the person who asked can press it. One video is made at a time, and each one is
reused for 30 minutes.

The music comes from, in order:
  - clips of the period's top songs, 3 picked at random  (music section + yt-dlp)
  - one of the period's AI songs, on the AI songs slide   (aiSongs section + an audioUrl, below)
  - your own background track                              (video.backgroundMusic in the config)
  - nothing — the video is silent.

You need:
  ffmpeg  — makes the video. Required.
  yt-dlp  — downloads the song clips. Only if you use the music section.

STEP 1 — INSTALL THEM

  Windows (in PowerShell or Command Prompt):
      winget install --id Gyan.FFmpeg -e
      winget install --id yt-dlp.yt-dlp -e
    Then CLOSE the window and open a new one (so it can find them).
    No winget? Download ffmpeg from https://www.gyan.dev/ffmpeg/builds/ ("release essentials" zip),
    unzip it to C:\ffmpeg, and set  ffmpegPath: 'C:/ffmpeg/bin/ffmpeg.exe'  in the config.
    yt-dlp.exe comes from https://github.com/yt-dlp/yt-dlp/releases/latest — put it in C:\ffmpeg\bin
    and set  ytdlpPath: 'C:/ffmpeg/bin/yt-dlp.exe'.

  Mac (with Homebrew, https://brew.sh):
      brew install ffmpeg yt-dlp

  Linux (Ubuntu / Debian):
      sudo apt update && sudo apt install -y ffmpeg python3
      sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
      sudo chmod a+rx /usr/local/bin/yt-dlp
    (apt's own yt-dlp is usually too old to work with YouTube — use the lines above.)

  A hosting panel where you can't install programs (Pterodactyl, etc.):
      npm install ffmpeg-static
    and in the config:  ffmpegPath: require('ffmpeg-static'),
    yt-dlp usually can't be installed there — use backgroundMusic for the music instead.

STEP 2 — CHECK THEY WORK
  In a NEW terminal window:
      ffmpeg -version
      yt-dlp --version
  Each should print a version number. "not recognized" / "command not found" means it isn't
  installed, or the terminal was opened before installing — open a new one and try again.

STEP 3 — TURN IT ON
  In wrapped.config.js set  video: { enabled: true, ... }  and restart your bot.
  If ffmpeg can't be found, the bot prints a "[wrapped] Video add-on…" warning when it starts
  and hides the button — nothing else breaks.

  Using pm2? pm2 remembers the old settings from before you installed ffmpeg. Run
      pm2 kill
  and start your bot again (or put the full paths in ffmpegPath / ytdlpPath).

AI SONGS IN THE VIDEO
  Add the song's audio link when you report it:
      wrapped.trackSong(guild.id, user.id, { id: 'any-id', title: 'Song name', audioUrl: 'https://…/song.mp3' });
  Use a link that keeps working (e.g. the AI service's own .mp3 link). Discord attachment links
  stop working after about a day, so they're no good for last month's video.

GOOD TO KNOW
  - Keep yt-dlp up to date — sites change and old versions stop working:
      Windows: winget upgrade yt-dlp.yt-dlp     Mac: brew upgrade yt-dlp     Linux: sudo yt-dlp -U
  - YouTube sometimes blocks downloads from hosting companies' servers. A song that can't be
    downloaded is skipped; the video is still made.
  - Only use a backgroundMusic track you're allowed to use.
  - Videos are small (usually 1–5 MB), well under Discord's upload limit.
  - Something going wrong? Start your bot with the environment variable WRAPPED_DEBUG=1
    and it prints ffmpeg's / yt-dlp's full error messages.


IF YOUR BOT REGISTERS ITS OWN SLASH COMMANDS
--------------------------------------------
If your bot uses  client.application.commands.set([...])  (or a deploy-commands script),
that can remove /wrapped. In that case set  slashCommands: 'off'  in the config and add
Wrapped's commands to your own list:

    const commands = [ ...yourCommands, ...wrapped.slashCommands ];

Wrapped still answers them — you don't need to handle them yourself. If your own
interaction handler replies "unknown command" to anything it doesn't recognise, make it
ignore  wrapped  and  wrapped-autopost.


GOOD TO KNOW
------------
- Stats are saved in wrapped-data.json (in the folder you start your bot from). It saves
  every minute and when the bot stops. Back it up — it's everyone's history.
- It only stores counts (how many messages, which hour, which emoji). It never stores what
  anyone wrote.
- Bots, and the !wrapped command itself, don't count as chat.
- Voice minutes only count with at least 2 people in the channel (change voiceNeedsTwoPeople).
- Pictures use Discord avatars and the server icon. Emoji and letters the font can't draw
  (Chinese, Japanese, emoji in names…) are left out of the text.
- Fonts: Montserrat (SIL Open Font License, see fonts/OFL.txt). You can use your own in the config.


TROUBLESHOOTING
---------------
"Cannot find module '@napi-rs/canvas'"  → run  npm install @napi-rs/canvas  in your bot's folder.
!wrapped does nothing                    → Message Content intent is off (step 3), or your
                                           prefix/command in the config is different.
Error about "components" or "flags"      → update discord.js:  npm install discord.js@14
/wrapped doesn't show up                  → global slash commands can take up to an hour the first
                                           time. Use slashCommands: 'guild' to see them straight away.
Voice minutes stay at 0                   → add GatewayIntentBits.GuildVoiceStates (step 4).
Reactions don't count                     → add GuildMessageReactions and the partials (step 4).
No "Play as video" button                 → see the "[wrapped] Video add-on" warning when the bot starts,
                                           and "VIDEO ADD-ON" above.
