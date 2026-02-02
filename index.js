const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.GuildMember]
});

const CHANNEL_ID = process.env.CHANNEL_ID;
const WINE_RED = '#8a0606';

let currentMessage = null;
let albumRotationIndex = 0;

function createEmbed(listeners) {
  const covers = listeners.map(l => l.albumArt).filter(Boolean);
  const cover = covers[albumRotationIndex % covers.length];

  return new EmbedBuilder()
    .setColor(WINE_RED)
    .setTitle('🎧 Now Playing')
    .setDescription(
      listeners.map(l =>
        `**${l.username}**\n> 🎵 ${l.song}\n> 🎤 ${l.artist}`
      ).join('\n\n')
    )
    .setThumbnail(cover || null)
    .setFooter({ text: 'Updates automatically from Spotify activity' });
}

async function updateNowPlaying() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const members = await channel.guild.members.fetch({ withPresences: true });

  const listeners = [];

  members.forEach(member => {
    const activity = member.presence?.activities.find(a => a.type === 2 && a.name === 'Spotify');
    if (!activity) return;

    listeners.push({
      username: member.displayName,
      song: activity.details,
      artist: activity.state,
      albumArt: activity.assets?.largeImageURL?.()
    });
  });

  if (listeners.length === 0) return;

  const embed = createEmbed(listeners);

  if (!currentMessage) {
    currentMessage = await channel.send({ embeds: [embed] });
  } else {
    await currentMessage.edit({ embeds: [embed] });
  }

  albumRotationIndex++;
}

client.on('presenceUpdate', () => {
  updateNowPlaying();
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(updateNowPlaying, 15000); // rotates album art every 15s
});

client.login(process.env.DISCORD_TOKEN);
