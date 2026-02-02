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
let coverIndex = 0;

function saveState() {
  fs.writeFileSync("./state.json", JSON.stringify({ messageId }, null, 2));
}

// Keep Render web service alive
http.createServer((req, res) => res.end("Bot running")).listen(3000);

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

  // No one listening
  if (spotifyUsers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor("#0f0f0f")
      .setTitle("Now Playing")
      .setDescription("────────────────────\nNo one is listening right now\n────────────────────")
      .setFooter({ text: "Enable Spotify activity status to appear here" });

    return editOrSend(channel, embed);
  }

  // Rotate album art
  coverIndex = (coverIndex + 1) % spotifyUsers.length;
  const albumArt = spotifyUsers[coverIndex].activity.assets?.largeImageURL();

  let description = spotifyUsers.map(({ member, activity }) => {
    return `**${activity.details}**\n${activity.state}\n*${member.user.username}*`;
  }).join("\n\n");

  const embed = new EmbedBuilder()
    .setColor("#0f0f0f")
    .setTitle("Now Playing")
    .setDescription(`────────────────────\n${description}\n────────────────────`)
    .setThumbnail(albumArt)
    .setFooter({ text: "Live Spotify activity • Updates automatically" })
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
