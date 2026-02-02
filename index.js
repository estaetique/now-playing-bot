const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const express = require("express");

// 🌐 Required for Render Web Service (keeps bot alive)
const app = express();
app.get("/", (req, res) => res.send("Now Playing Bot is running"));
app.listen(process.env.PORT || 3000);

// 🔐 Environment variables from Render
const token = process.env.BOT_TOKEN;
const channelId = process.env.CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// 💾 Remember message ID so bot edits instead of spamming
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

  // 🔁 Auto refresh every 15 seconds
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

    const listeners = [];
    const covers = [];

    for (const [, member] of guild.members.cache) {
      const spotify = pickSpotifyActivity(member);
      if (!spotify) continue;

      listeners.push(
        `🎵 **${spotify.details}** — *${spotify.state}*\n👤 ${member.user.username}`
      );

      covers.push(spotify.assets?.largeImageURL?.());
    }

    const embed = new EmbedBuilder()
      .setColor("#1DB954") // Spotify green
      .setTitle("🎧 Now Playing in Chaos Club")
      .setDescription(
        listeners.length
          ? `🎶 **${listeners.length} people listening right now**\n\n` + listeners.join("\n\n")
          : "Nobody is vibing to Spotify right now 😔"
      )
      .setFooter({
        text: "Updates automatically • Turn on Spotify activity",
        iconURL: "https://cdn-icons-png.flaticon.com/512/174/174872.png"
      })
      .setTimestamp();

    // 🔁 Rotating album art
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

    console.log("Refreshed now playing (pretty mode)");
  } catch (err) {
    console.error("Refresh error:", err.message);
  }
}

client.login(token);
