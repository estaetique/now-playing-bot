const { Client, GatewayIntentBits, Partials, ActivityType, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

const CHANNEL_ID = process.env.CHANNEL_ID;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log('🎵 Spotify Now Playing Bot is live');
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.activities) return;

  const spotifyActivity = newPresence.activities.find(
    a => a.type === ActivityType.Listening && a.name === 'Spotify'
  );

  if (!spotifyActivity) return;

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor('#8a0606') // wine red
    .setAuthor({ name: 'Now Playing', iconURL: 'https://cdn-icons-png.flaticon.com/512/727/727245.png' })
    .setTitle(spotifyActivity.details)
    .setDescription(`by **${spotifyActivity.state}**`)
    .setThumbnail(spotifyActivity.assets?.largeImageURL() || null)
    .setFooter({ text: 'Updates automatically from Spotify activity' })
    .setTimestamp();

  const messages = await channel.messages.fetch({ limit: 5 });
  const botMessage = messages.find(m => m.author.id === client.user.id);

  if (botMessage) {
    botMessage.edit({ embeds: [embed] });
  } else {
    channel.send({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);
