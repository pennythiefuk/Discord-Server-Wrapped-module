const path = require('path');
const {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { createStore } = require('./lib/store.js');
const { createSlides } = require('./lib/slides.js');
const { renderSlide, setupFonts } = require('./lib/render.js');
const { checkTimezone, partsFor } = require('./lib/time.js');
const { createVideoMaker, checkTools, uploadLimitFor } = require('./lib/video.js');

// Server Wrapped — a Spotify Wrapped-style recap for any Discord server. See README.txt for setup.
//
//   const wrapped = require('./server-wrapped')(client, require('./server-wrapped/wrapped.config.js'));
//
// It listens for messages, reactions and voice on its own. The optional sections (music, AI songs, AI chat, economy)
// need your bot to tell it when things happen — see the track* functions at the bottom.

const DEFAULTS = {
  name: 'SERVER WRAPPED',
  footer: '',
  prefix: '!',
  command: 'wrapped',
  slashCommands: 'global',
  timezone: 'UTC',
  timezoneLabel: '',
  showTimezone: true,
  dataFile: path.join(process.cwd(), 'wrapped-data.json'),
  sections: { chat: true, reactions: true, voice: true, emoji: true, duo: true, peakHour: true, personality: true, music: false, aiSongs: false, aiChat: false, economy: false },
  words: { aiSong: 'AI song', aiSongs: 'AI songs', aiSongsKicker: 'Songs', aiChatName: 'the AI', aiChatKicker: 'AI' },
  currency: { symbol: '$', decimals: 2, after: false },
  fonts: {},
  voiceNeedsTwoPeople: true,
  video: { enabled: false, ffmpegPath: 'ffmpeg', ytdlpPath: 'yt-dlp', useMusic: true, backgroundMusic: '', slideSeconds: 6 },
};

const PREFIX = 'swrapped';

function setupWrapped(client, userConfig = {}) {
  const config = {
    ...DEFAULTS,
    ...userConfig,
    sections: { ...DEFAULTS.sections, ...(userConfig.sections || {}) },
    words: { ...DEFAULTS.words, ...(userConfig.words || {}) },
    currency: { ...DEFAULTS.currency, ...(userConfig.currency || {}) },
    video: { ...DEFAULTS.video, ...(userConfig.video || {}) },
  };
  checkTimezone(config.timezone);
  setupFonts(config.fonts);
  const store = createStore({ file: path.resolve(config.dataFile), timeZone: config.timezone });
  const { serverSlides, userSlides, periodFor } = createSlides({ config, store });
  const on = config.sections;
  const log = (...args) => console.error('[wrapped]', ...args);

  warnAboutIntents(client, config);

  // The optional video add-on: only offered once ffmpeg is found (checked in the background at startup).
  let videoReady = false;
  const videoMaker = config.video.enabled ? createVideoMaker({ config, serverSlides }) : null;
  if (config.video.enabled) {
    checkTools(config.video).then((tools) => {
      if (!tools.ffmpeg) return void console.warn(`[wrapped] Video add-on is on, but ffmpeg wasn't found at "${config.video.ffmpegPath}" — the Play as video button is hidden. See "VIDEO ADD-ON" in README.txt.`);
      videoReady = true;
      if (config.video.useMusic && config.sections.music && !tools.ytdlp) console.warn(`[wrapped] Video add-on: yt-dlp wasn't found at "${config.video.ytdlpPath}", so videos won't include song clips. See "VIDEO ADD-ON" in README.txt.`);
    });
  }

  // -------------------------------------------------------------------------
  // Tracking
  // -------------------------------------------------------------------------
  const trigger = `${config.prefix}${config.command}`.toLowerCase();
  /** The words after "!wrapped", or null if the message isn't our command ("!wrappedfoo" isn't). */
  function commandArgs(content) {
    const text = String(content || '');
    if (!text.toLowerCase().startsWith(trigger)) return null;
    const rest = text.slice(trigger.length);
    return rest && !/^\s/.test(rest) ? null : rest.trim().toLowerCase();
  }

  client.on(Events.MessageCreate, (message) => {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    const args = commandArgs(message.content);
    if (args !== null) return void handleTextCommand(message, args).catch((err) => log('command failed:', err)); // not counted as chat
    try {
      store.recordMessage(message.guild.id, message.author.id, message.createdTimestamp || Date.now(), {
        content: message.content,
        replyTo: message.mentions?.repliedUser?.id || null,
      });
    } catch (err) {
      log('counting a message failed:', err.message);
    }
  });

  // A reaction from someone else counts once per person per message, at most 5 per message (stops reaction spam).
  const reactionsSeen = new Map();
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
      const msg = reaction.message;
      const author = msg.author;
      if (!msg.guild || !author || author.bot || author.id === user.id) return;
      let seen = reactionsSeen.get(msg.id);
      if (!seen) {
        seen = new Set();
        reactionsSeen.set(msg.id, seen);
        if (reactionsSeen.size > 5000) reactionsSeen.delete(reactionsSeen.keys().next().value);
      }
      if (seen.has(user.id) || seen.size >= 5) return;
      seen.add(user.id);
      const emoji = reaction.emoji.id ? `c:${reaction.emoji.name}:${reaction.emoji.id}` : `u:${reaction.emoji.name}`;
      store.recordReaction(msg.guild.id, author.id, user.id, emoji, Date.now());
    } catch {
      // a deleted message or missing permission — nothing to count
    }
  });

  // Voice: once a minute, everyone in a voice channel (with someone else, not deafened) gets a minute.
  const voiceTimer = setInterval(() => {
    if (!on.voice) return;
    try {
      for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
          if (!channel.isVoiceBased?.()) continue;
          const people = [...channel.members.values()].filter((m) => !m.user.bot);
          if (config.voiceNeedsTwoPeople && people.length < 2) continue;
          for (const m of people) if (!m.voice.selfDeaf && !m.voice.serverDeaf) store.recordVoiceMinutes(guild.id, m.id, 1, Date.now());
        }
      }
    } catch (err) {
      log('voice sample failed:', err.message);
    }
  }, 60 * 1000);
  voiceTimer.unref?.();

  // -------------------------------------------------------------------------
  // The Wrapped message (a picture + a menu of slides)
  // -------------------------------------------------------------------------
  /** Owner "0" = anyone can switch slides (the monthly auto-post). Target "0" = the whole server. */
  async function wrappedPage(guild, { ownerId, targetId, periodCode, page }) {
    const slides = targetId !== '0' ? await userSlides(guild, targetId, periodCode) : await serverSlides(guild, periodCode);
    const index = Math.max(0, Math.min(page, slides.length - 1));
    const png = await renderSlide(slides[index]);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:${ownerId}:${targetId}:${periodCode}`)
      .setPlaceholder('Jump to a slide')
      .addOptions(slides.slice(0, 25).map((s, i) => ({ label: `${i + 1}. ${String(s.name || `Slide ${i + 1}`)}`.slice(0, 100), value: String(i), default: i === index })));
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎁 ${slides.heading}\n-# ${slides.periodLabel}`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://wrapped.png')))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    if (videoReady && targetId === '0') {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}vid:${ownerId}:${periodCode}`).setLabel('▶ Play as video').setStyle(ButtonStyle.Success)));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Slide ${index + 1} of ${slides.length} · ${ownerId === '0' ? 'anyone can switch slides' : `only <@${ownerId}> can switch slides`}`));
    return { components: [container], files: [new AttachmentBuilder(png, { name: 'wrapped.png' })], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  }

  const canManage = (memberPerms) => Boolean(memberPerms?.has?.(PermissionFlagsBits.ManageGuild));

  function setAutopost(guildId, channelId) {
    const g = store.guildData(guildId);
    g.autopost = channelId ? { channelId, lastPosted: g.autopost?.lastPosted || null } : null;
    store.touch();
    store.flush();
  }
  const autopostOnText = '✓ Last month’s server Wrapped will be posted in this channel on the 1st of every month (from midday).';
  const autopostOffText = '✓ The monthly Wrapped post is off for this server.';

  async function handleTextCommand(message, words) {

    if (/^autopost\b/.test(words)) {
      if (!canManage(message.member?.permissions)) return void (await message.reply({ content: 'You need the **Manage Server** permission for that.', allowedMentions: { repliedUser: false } }));
      const enable = !/\boff\b/.test(words);
      setAutopost(message.guild.id, enable ? message.channel.id : null);
      return void (await message.reply({ content: enable ? autopostOnText : autopostOffText, allowedMentions: { repliedUser: false } }));
    }

    const target = /<@!?(\d{15,25})>|\b(\d{15,25})\b/.exec(words);
    const periodCode = periodFor(/\byear\b/.test(words) ? 'year' : /\blast\b/.test(words) ? 'last' : 'month');
    message.channel.sendTyping?.().catch(() => {});
    try {
      const payload = await wrappedPage(message.guild, { ownerId: message.author.id, targetId: target ? target[1] || target[2] : '0', periodCode, page: 0 });
      await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      log('making a Wrapped failed:', err);
      await message.reply({ content: `✗ Couldn't make that Wrapped: ${err.message}`, allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith(`${PREFIX}:`)) return void (await handleMenu(interaction));
      if (interaction.isButton?.() && interaction.customId.startsWith(`${PREFIX}vid:`)) return void (await handleVideoButton(interaction));
      if (!interaction.isChatInputCommand?.() || !interaction.guild) return;
      if (interaction.commandName === config.command) return void (await handleSlash(interaction));
      if (interaction.commandName === `${config.command}-autopost`) {
        if (!canManage(interaction.memberPermissions)) return void (await interaction.reply({ content: 'You need the **Manage Server** permission for that.', flags: MessageFlags.Ephemeral }));
        const enable = interaction.options.getBoolean('enabled', true);
        setAutopost(interaction.guild.id, enable ? interaction.channelId : null);
        await interaction.reply({ content: enable ? autopostOnText : autopostOffText });
      }
    } catch (err) {
      log('interaction failed:', err);
    }
  });

  async function handleSlash(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user');
    const periodCode = periodFor(interaction.options.getString('period') || 'month');
    try {
      await interaction.editReply(await wrappedPage(interaction.guild, { ownerId: interaction.user.id, targetId: user?.id || '0', periodCode, page: 0 }));
    } catch (err) {
      log('making a Wrapped failed:', err);
      await interaction.editReply({ content: `✗ Couldn't make that Wrapped: ${err.message}` }).catch(() => {});
    }
  }

  async function handleMenu(interaction) {
    const [, ownerId, targetId, periodCode] = interaction.customId.split(':');
    if (ownerId !== '0' && interaction.user.id !== ownerId) {
      return void (await interaction.reply({ content: `Only <@${ownerId}> can switch slides on this one — make your own with \`${config.prefix}${config.command}\` or \`/${config.command}\`.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));
    }
    await interaction.deferUpdate();
    try {
      const payload = await wrappedPage(interaction.guild, { ownerId, targetId, periodCode, page: Number(interaction.values[0]) || 0 });
      await interaction.editReply({ ...payload, attachments: [] });
    } catch (err) {
      log('drawing a slide failed:', err);
      await interaction.followUp({ content: `✗ Couldn't draw that slide: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  // One video at a time for the whole bot (they're heavy); a finished one is reused for 30 minutes.
  const videoCache = new Map();
  let rendering = null;
  async function handleVideoButton(interaction) {
    const [, ownerId, periodCode] = interaction.customId.split(':');
    if (ownerId !== '0' && interaction.user.id !== ownerId) {
      return void (await interaction.reply({ content: `Only <@${ownerId}> can start this one — make your own with \`${config.prefix}${config.command}\` or \`/${config.command}\`.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));
    }
    if (!videoMaker || !videoReady) return void (await interaction.reply({ content: 'Videos aren’t available right now.', flags: MessageFlags.Ephemeral }));
    const key = `${interaction.guildId}:${periodCode}`;
    if (rendering) {
      return void (await interaction.reply({ content: rendering === key ? '🎬 That video is already being made — it’ll appear in a moment.' : '🎬 Another Wrapped video is being made right now — try again in a minute.', flags: MessageFlags.Ephemeral }));
    }
    await interaction.reply({ content: '🎬 Making the Wrapped video — this takes about a minute…', allowedMentions: { parse: [] } });
    try {
      let video = videoCache.get(key);
      if (!video || Date.now() - video.at > 30 * 60 * 1000) {
        rendering = key;
        video = { ...(await videoMaker.makeVideo(interaction.guild, periodCode)), at: Date.now() };
        videoCache.set(key, video);
        for (const [k, v] of videoCache) if (Date.now() - v.at > 30 * 60 * 1000) videoCache.delete(k);
      }
      if (video.buffer.length > uploadLimitFor(interaction.guild)) throw new Error('the video came out bigger than this server’s upload limit — try a smaller slideSeconds in the config');
      await interaction.editReply({
        content: `🎬 **${interaction.guild.name} Wrapped** · the video${video.soundtrack.length ? `\n-# ♪ ${video.soundtrack.join(' → ')}` : ''}`,
        files: [new AttachmentBuilder(video.buffer, { name: 'wrapped.mp4' })],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      log('making the video failed:', err);
      await interaction.editReply({ content: `✗ Couldn't make the video: ${err.message}` }).catch(() => {});
    } finally {
      if (rendering === key) rendering = null;
    }
  }

  // -------------------------------------------------------------------------
  // Slash commands + the monthly auto-post
  // -------------------------------------------------------------------------
  const slashCommands = [
    {
      name: config.command,
      description: 'A Spotify Wrapped-style recap of this server, or of one person',
      contexts: [0],
      options: [
        { type: ApplicationCommandOptionType.String, name: 'period', description: 'Which period (default: this month)', required: false, choices: [{ name: 'This month', value: 'month' }, { name: 'Last month', value: 'last' }, { name: 'This year', value: 'year' }] },
        { type: ApplicationCommandOptionType.User, name: 'user', description: 'Show one person’s Wrapped instead of the server’s', required: false },
      ],
    },
    {
      name: `${config.command}-autopost`,
      description: 'Post last month’s server Wrapped in this channel on the 1st of every month',
      contexts: [0],
      default_member_permissions: String(PermissionFlagsBits.ManageGuild),
      options: [{ type: ApplicationCommandOptionType.Boolean, name: 'enabled', description: 'On or off', required: true }],
    },
  ];

  async function onReady() {
    try {
      if (config.slashCommands === 'global') {
        for (const cmd of slashCommands) await client.application.commands.create(cmd);
      } else if (config.slashCommands === 'guild') {
        for (const guild of client.guilds.cache.values()) for (const cmd of slashCommands) await guild.commands.create(cmd).catch((err) => log(`couldn't add slash commands in ${guild.name}:`, err.message));
      }
    } catch (err) {
      log('registering slash commands failed:', err.message);
    }
    const check = async () => {
      const now = partsFor(Date.now(), config.timezone);
      if (now.day !== 1 || now.hour < 12) return;
      const last = periodFor('last');
      for (const guild of client.guilds.cache.values()) {
        const g = store.guildData(guild.id);
        if (!g.autopost?.channelId || g.autopost.lastPosted === last) continue;
        g.autopost.lastPosted = last;
        store.touch();
        store.flush();
        try {
          const channel = await client.channels.fetch(g.autopost.channelId).catch(() => null);
          if (channel?.isTextBased()) await channel.send(await wrappedPage(guild, { ownerId: '0', targetId: '0', periodCode: last, page: 0 }));
        } catch (err) {
          log('monthly post failed:', err);
        }
      }
    };
    setInterval(() => check().catch(() => {}), 30 * 60 * 1000).unref?.();
    check().catch(() => {});
  }
  if (client.isReady()) onReady();
  else client.once(Events.ClientReady, onReady);
  client.on(Events.GuildCreate, (guild) => {
    if (config.slashCommands !== 'guild') return;
    for (const cmd of slashCommands) guild.commands.create(cmd).catch((err) => log(`couldn't add slash commands in ${guild.name}:`, err.message));
  });

  // -------------------------------------------------------------------------
  // Hooks for the optional sections — call these from your own bot's code.
  // -------------------------------------------------------------------------
  const now = () => Date.now();
  return {
    /** A song your music player started. track: { title, artist?, url?, imageUrl?, durationSeconds?, requestedById?, live? } */
    trackPlay: (guildId, track) => guildId && track && store.recordPlay(guildId, track, now()),
    /** Someone generated an AI song. song: { id?, title?, audioUrl? } — an id lets you call setSongScore later; a lasting
     *  audioUrl (an .mp3 link) lets the video add-on play it. */
    trackSong: (guildId, userId, song = {}) => guildId && userId && store.recordSong(guildId, userId, song, now()),
    /** The song's rating (e.g. upvotes minus downvotes) — the best-rated one gets a mention. */
    setSongScore: (guildId, songId, score) => store.setSongScore(guildId, songId, score),
    /** Your AI chatbot answered someone. */
    trackAiChat: (guildId, userId) => guildId && userId && store.recordAiChat(guildId, userId, now()),
    /** A bet/game result. net = what they won minus the stake (negative for a loss), in normal money (12.5 = $12.50). */
    trackGamble: (guildId, userId, game, net) => guildId && userId && Number.isFinite(net) && store.recordGamble(guildId, userId, String(game || 'a bet'), net, now()),
    /** Someone's total money right now (wallet + bank). Call it whenever it changes, or once a day for everyone. */
    trackWorth: (guildId, userId, worth) => guildId && userId && Number.isFinite(worth) && store.recordWorth(guildId, userId, worth, now()),
    /** The slash command definitions, if your bot registers its own commands (set slashCommands: 'off' in the config). */
    slashCommands,
    /** Saves the stats file now (it also saves itself every minute and when the bot stops). */
    save: () => store.flush(),
  };
}

function warnAboutIntents(client, config) {
  const has = (bit) => client.options.intents?.has?.(bit);
  const missing = [];
  if (!has(GatewayIntentBits.Guilds)) missing.push('Guilds');
  if (!has(GatewayIntentBits.GuildMessages)) missing.push('GuildMessages');
  if (!has(GatewayIntentBits.MessageContent)) missing.push(`MessageContent (needed for ${config.prefix}${config.command} and emoji counts)`);
  if (config.sections.reactions && !has(GatewayIntentBits.GuildMessageReactions)) missing.push('GuildMessageReactions');
  if (config.sections.voice && !has(GatewayIntentBits.GuildVoiceStates)) missing.push('GuildVoiceStates');
  if (missing.length) console.warn(`[wrapped] Your client is missing these intents, so some stats won't be counted: ${missing.join(', ')}. See README.txt.`);
}

module.exports = setupWrapped;
module.exports.setupWrapped = setupWrapped;
