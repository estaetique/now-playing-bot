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

  // Nobody listening
  if (spotifyUsers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor("#0e0e0e")
      .setTitle("Now Playing")
      .setDescription("*The room is quiet…*")
      .setFooter({ text: "Enable Spotify activity status to appear here" });

    return editOrSend(channel, embed);
  }

  // First listener provides album art
  const { activity } = spotifyUsers[0];
  const albumArt = activity.assets?.largeImageURL();

  let description = spotifyUsers.map(({ member, activity }) => {
    return `**${member.user.username}**  \n> ${activity.details} — *${activity.state}*`;
  }).join("\n\n");

  const embed = new EmbedBuilder()
    .setColor("#121212") // deep elegant black
    .setAuthor({ name: "Now Playing", iconURL: "https://i.imgur.com/8kYfH3D.png" }) // subtle icon
    .setDescription(description)
    .setThumbnail(albumArt)
    .setFooter({ text: "Live Spotify status • Auto updates" })
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
