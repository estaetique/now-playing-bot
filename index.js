const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const token = process.env.BOT_TOKEN;
const channelId = process.env.CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
});

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
let dashboardMessageId = state.dashboardMessageId || null;

// ✅ keeps track of which cover to show next
let coverIndex = 0;

// small debounce so presence spam doesn't cause too many refreshes
let refreshTimer = null;

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await refreshNowPlaying();

  // ✅ force refresh every 10 seconds (reliable)
  setInterval(() => {
    refreshNowPlaying().catch((e) => console.log("refresh error:", e.message));
  }, 10000);
});

client.on("presenceUpdate", () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshNowPlaying().catch(() => {});
  }, 1500);
});

function pickSpotifyActivity(member) {
  const activities = member.presence?.activities || [];
  return activities.find((a) => a.name === "Spotify" && a.details && a.state);
}

async function getOrCreateDashboardMessage(channel) {
  // if we have a saved message id, fetch it
  if (dashboardMessageId) {
    try {
      return await channel.messages.fetch(dashboardMessageId);
    } catch {
      dashboardMessageId = null;
    }
  }

  // otherwise create it
  const msg = await channel.send("🎵 **Now Playing**\nLoading...");
  dashboardMessageId = msg.id;

  state.dashboardMessageId = dashboardMessageId;
  saveState(state);

  return msg;
}

async function refreshNowPlaying() {
  console.log("Refreshing now playing...", new Date().toLocaleTimeString());

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const guild = channel.guild;
  if (!guild) return;

  const lines = [];
  const covers = [];

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const spotify = pickSpotifyActivity(member);
    if (spotify) {
      lines.push(
        `• **${member.user.username}** — **${spotify.details}** (*${spotify.state}*)`
      );

      if (spotify.assets?.largeImage) {
        const img = spotify.assets.largeImage.replace("spotify:", "");
        covers.push(`https://i.scdn.co/image/${img}`);
      }
    }
  }

  const body =
    lines.length > 0 ? lines.join("\n") : "_No one is showing Spotify activity right now._";

  // ✅ rotate cover each refresh (every 10 seconds)
  let albumArt = null;
  if (covers.length > 0) {
    coverIndex = (coverIndex + 1) % covers.length;
    albumArt = covers[coverIndex];
  }

  const embed = new EmbedBuilder()
    .setTitle("🎵 Now Playing")
    .setDescription(body)
    .setFooter({ text: "Enable Activity Status + Spotify status to appear here." })
    .setTimestamp();

  if (albumArt) embed.setThumbnail(albumArt);

  const dashboard = await getOrCreateDashboardMessage(channel);

  await dashboard.edit({ content: "", embeds: [embed] }).catch((e) => {
    console.log("edit error:", e.message);
  });
}

client.login(token);
