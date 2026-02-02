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

  // No listeners
  if (spotifyUsers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor("#0c0c0c")
      .setTitle("Now Playing")
      .setDescription("━━━━━━━━━━━━━━━━━━\n*Silence fills the room…*\n━━━━━━━━━━━━━━━━━━")
      .setFooter({ text: "Enable Spotify activity status to appear here" });

    return editOrSend(channel, embed);
  }

  // Rotate album covers
  coverIndex = (coverIndex + 1) % spotifyUsers.length;
  const albumArt = spotifyUsers[coverIndex].activity.assets?.largeImageURL();

  // Elegant equalizer vibe
  const bars = ["▁▂▃▅▇", "▂▅▇▅▂", "▇▆▅▄▃", "▃▄▅▆▇"];
  const equalizer = bars[Math.floor(Date.now() / 1500) % bars.length];

  let description = spotifyUsers.map(({ member, activity }) => {
    return `**${member.user.username}**\n> ${activity.details}\n> *${activity.state}*`;
  }).join("\n\n");

  const embed = new EmbedBuilder()
    .setColor("#111111")
    .setAuthor({ name: "Now Playing", iconURL: "https://i.imgur.com/8kYfH3D.png" })
    .setDescription(`━━━━━━━━━━━━━━━━━━\n${description}\n━━━━━━━━━━━━━━━━━━`)
    .addFields({ name: "Live Audio", value: `\`${equalizer}\`` })
    .setThumbnail(albumArt)
    .setFooter({ text: "Live Spotify status • Updates automatically" })
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
