require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

const CHANNEL_ID = process.env.CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN; // ← matches your Render variable

let currentIndex = 0;
let songs = [];

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("presenceUpdate", async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.activities) return;

  const spotifyActivity = newPresence.activities.find(
    act => act.name === "Spotify" && act.type === 2
  );

  if (!spotifyActivity) return;

  const existing = songs.find(s => s.userId === newPresence.userId);

  const songData = {
    userId: newPresence.userId,
    username: newPresence.member?.displayName || newPresence.user.username,
    song: spotifyActivity.details,
    artist: spotifyActivity.state,
    albumArt: spotifyActivity.assets.largeImageURL()
  };

  if (existing) {
    Object.assign(existing, songData);
  } else {
    songs.push(songData);
  }

  updateNowPlaying();
});

async function updateNowPlaying() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  if (songs.length === 0) return;

  currentIndex = currentIndex % songs.length;
  const currentSong = songs[currentIndex];

  const embed = new EmbedBuilder()
    .setColor("#8a0606")
    .setTitle("🎵 Now Playing")
    .setDescription(`**${currentSong.song}**\nby ${currentSong.artist}`)
    .setFooter({ text: `Listening now: ${currentSong.username}` })
    .setThumbnail(currentSong.albumArt);

  const messages = await channel.messages.fetch({ limit: 5 });
  const botMessage = messages.find(m => m.author.id === client.user.id);

  if (botMessage) {
    await botMessage.edit({ embeds: [embed] });
  } else {
    await channel.send({ embeds: [embed] });
  }
}

setInterval(() => {
  if (songs.length > 1) {
    currentIndex++;
    updateNowPlaying();
  }
}, 15000);

client.login(TOKEN);
