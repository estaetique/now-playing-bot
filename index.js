require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');

const app = express();

/* ================== KEEP RENDER HAPPY ================== */
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Now Playing Bot is running 🎵');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});
/* ======================================================= */


/* ================== DISCORD BOT ================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.activities) return;

  const spotifyActivity = newPresence.activities.find(
    activity => activity.type === 2 && activity.name === 'Spotify'
  );

  if (!spotifyActivity) return;

  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor('#8a0606')
    .setAuthor({ name: 'Now Playing 🎧' })
    .setDescription(
      `**${spotifyActivity.details}**\nby *${spotifyActivity.state}*\n\n👤 ${newPresence.user.username}`
    )
    .setThumbnail(spotifyActivity.assets.largeImageURL())
    .setFooter({ text: 'Live Spotify activity' })
    .setTimestamp();

  channel.send({ embeds: [embed] });
});

client.login(process.env.TOKEN);
