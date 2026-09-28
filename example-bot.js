// A complete tiny bot that only does Server Wrapped — handy for trying it out.
// It sits next to the server-wrapped folder. To run it:
//   npm install discord.js@14 @napi-rs/canvas
//   set DISCORD_TOKEN=your-token-here      (Mac/Linux: export DISCORD_TOKEN=your-token-here)
//   node example-bot.js

const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

require('./server-wrapped')(client, require('./server-wrapped/wrapped.config.js'));

client.once(Events.ClientReady, () => console.log(`Logged in as ${client.user.tag} — type !wrapped in your server.`));
client.login(process.env.DISCORD_TOKEN);
