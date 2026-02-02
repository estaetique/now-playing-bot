const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const http = require("http");

const token = process.env.BOT_TOKEN;
const channelId = process.env.CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
});

let state = {};
try { state = JSON.parse(fs.readFileSync("./state.json")); } catch {}
let messageId = state.messageId || null;

function saveState() {
  fs.writeFileSync("./state.json", JSON.stringify({ messageId }, null, 2));
}

// Keep Render alive
http.createServer((req, res) => res.send("Bot running")).listen(3000);

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  updateNowPlaying();
  setInterval(updateNowPlaying, 15000);
});

client.on("presenceUpdate", () => {
  setTimeout(updateNowPlaying, 3000);
});

async function updateNowPlaying() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const members = await guild.members.fetch();
  const spotifyUsers = [];

  members.forEach(member => {
    const activity = member.presence?.activities?.find(a => a.type === 2 && a.name === "Spotify");
    if (activity) spotifyUsers.push({ member, activity });
  });

  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  if (spotifyUsers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor("#2f3136")
      .setTitle("🎵 Now Playing")
      .setDescription("No one is listening right now");

    editOrSend(channel, embed);
    return;
  }

  // Pick first listener for album art
  const { activity } = spotifyUsers[0];
  const albumArt = activity.assets?.largeImageURL();

  let description = spotifyUsers.map(({ member, activity }) => {
    return `**${member.user.username}** — ${activity.details} • ${activity.state}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setColor("#1DB954")
    .setTitle("🎵 Now Playing")
    .setDescription(description)
    .setThumbnail(albumArt)
    .setFooter({ text: "Updates automatically • Enable Spotify status" })
    .setTimestamp();

  editOrSend(channel, embed);
}

async function editOrSend(channel, embed) {
  try {
    if (messageId) {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      messageId = msg.id;
      saveState();
    }
  } catch {
    const msg = await channel.send({ embeds: [embed] });
    messageId = msg.id;
    saveState();
  }
}

client.login(token);
