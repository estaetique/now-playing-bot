require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(process.env.PORT || 3000);

const CHANNEL_ID = process.env.CHANNEL_ID;
let nowPlayingMessage = null;
let lastSongs = new Map();

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);

  // Send ONE master message when bot starts
  nowPlayingMessage = await channel.send({ content: "🎵 Loading Now Playing..." });
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!newPresence?.activities) return;

  const spotifyActivity = newPresence.activities.find(a => a.name === 'Spotify');
  if (!spotifyActivity) return;

  const userId = newPresence.userId;
  const songKey = `${spotifyActivity.details}-${spotifyActivity.state}`;

  if (lastSongs.get(userId) === songKey) return;
  lastSongs.set(userId, songKey);

  updateNowPlaying();
});

async function updateNowPlaying() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const members = await channel.guild.members.fetch();

  const spotifyUsers = members.filter(member =>
    member.presence?.activities?.some(a => a.name === 'Spotify')
  );

  if (spotifyUsers.size === 0) {
    await nowPlayingMessage.edit("No one is listening right now.");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎧 Now Playing in Editing World")
    .setColor("#8a0606");

  spotifyUsers.forEach(member => {
    const activity = member.presence.activities.find(a => a.name === 'Spotify');

    embed.addFields({
      name: `${activity.details}`,
      value: `by **${activity.state}**\n👤 ${member.user.username}`,
      inline: false
    });

    if (activity.assets?.largeImage) {
      const imageUrl = `https://i.scdn.co/image/${activity.assets.largeImage.replace('spotify:', '')}`;
      embed.setThumbnail(imageUrl);
    }
  });

  await nowPlayingMessage.edit({ embeds: [embed] });
}

client.login(process.env.TOKEN);

