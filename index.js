const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const express = require("express");

// 🌐 REQUIRED for Render (keeps service alive)
const app = express();
app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// 🔐 Tokens from Render Environment Variables
const token = process.env.BOT_TOKEN;
const channelId = process.env.CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// 💾 Save message ID so bot edits instead of spamming
function loadState() {
  try {
    return JSON.parse(fs.readFileSync("./state.json", "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync("./state.json", JSON.stringify(state, null, 2));
}

let state = loadState();
let dashboardMessage = state.dashboardMessageId || null;
let coverIndex = 0;
let refreshTimer = null;

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await refreshNowPlaying();

  // 🔁 Auto refresh every 15 sec
  setInterval(refreshNowPlaying, 15000);
});

client.on("presenceUpdate", () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshNowPlaying, 1500);
});

function pickSpotifyActivity(member) {
  return member.presence?.activities?.find(a => a.name === "Spotify");
}

async function refreshNowPlaying() {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const guild = channel.guild;
    await guild.members.fetch({ withPresences: true }).catch(() => {});

    const lines = [];
    const covers = [];

    for (const [, member] of guild.members.cache) {
      const spotify = pickSpotifyActivity(member);
      if (!spotify) continue;

      lines.push(`**${member.user.username}** — ${spotify.details} • ${spotify.state}`);
      covers.push(spotify.assets?.largeImageURL?.());
    }

    const embed = new EmbedBuilder()
      .setTitle("🎵 Now Playing")
      .setDescription(lines.length ? lines.join("\n") : "No one is listening to Spotify right now.")
      .setColor("#1DB954")
      .setFooter({ text: "Updates automatically • Enable Spotify activity status" });

    if (covers.length) {
      embed.setThumbnail(covers[coverIndex % covers.length]);
      coverIndex++;
    }

    if (!dashboardMessage) {
      const msg = await channel.send({ embeds: [embed] });
      dashboardMessage = msg.id;
      state.dashboardMessageId = msg.id;
      saveState(state);
    } else {
      const msg = await channel.messages.fetch(dashboardMessage).catch(() => null);
      if (msg) await msg.edit({ embeds: [embed] });
    }

    console.log("Refreshed now playing...");
  } catch (err) {
    console.error("Refresh error:", err.message);
  }
}

client.login(token);
