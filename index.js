const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// ====== ENV ======
const token = process.env.BOT_TOKEN;
const channelId = process.env.CHANNEL_ID;

if (!token || !channelId) {
  console.error("Missing BOT_TOKEN or CHANNEL_ID in environment variables.");
  process.exit(1);
}

// ====== CLIENT ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences, // needed to read Spotify activity
  ],
});

// ====== STATE (persist message ID + cover index) ======
const STATE_FILE = "./state.json";

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();
let dashboardMessageId = state.dashboardMessageId || null;
let coverIndex = Number.isInteger(state.coverIndex) ? state.coverIndex : 0;

let dashboardMessage = null;
let refreshTimer = null;
let debounceTimer = null;

// ====== HELPERS ======
function spotifyCoverUrl(activity) {
  // activity.assets.largeImage looks like: "spotify:ab67616d0000b273...."
  const large = activity?.assets?.largeImage;
  if (!large || !large.startsWith("spotify:")) return null;
  const id = large.replace("spotify:", "");
  return `https://i.scdn.co/image/${id}`;
}

function getSpotifyActivityFromPresence(presence) {
  const activities = presence?.activities || [];
  // Spotify activity usually has name "Spotify"
  return activities.find((a) => a?.name === "Spotify" && (a?.details || a?.state));
}

function pickElegantLines(guild, maxLines = 6) {
  // Use presences cache (fast, no giant fetch)
  const presences = guild?.presences?.cache;
  if (!presences) return { lines: [], covers: [], count: 0 };

  const results = [];

  for (const [userId, presence] of presences) {
    const sp = getSpotifyActivityFromPresence(presence);
    if (!sp) continue;

    const member = guild.members.cache.get(userId);
    const display = member?.displayName || presence?.user?.username || "unknown";

    const track = sp.details || "Unknown track";
    const artist = sp.state || "Unknown artist";

    results.push({
      display,
      track,
      artist,
      cover: spotifyCoverUrl(sp),
    });
  }

  // Sort so the list is stable (prettier, less jumping)
  results.sort((a, b) => a.display.localeCompare(b.display));

  const lines = results.slice(0, maxLines).map((r) => `• **${r.display}** — ${r.track} *(${r.artist})*`);
  const covers = results.map((r) => r.cover).filter(Boolean);

  return { lines, covers, count: results.length };
}

async function getOrCreateDashboardMessage(channel) {
  // Try existing saved message
  if (dashboardMessageId) {
    try {
      const msg = await channel.messages.fetch(dashboardMessageId);
      return msg;
    } catch {
      // message deleted or not accessible
      dashboardMessageId = null;
    }
  }

  // Create new
  const placeholder = new EmbedBuilder()
    .setColor(0x8a0606)
    .setTitle("Now Playing")
    .setDescription("Listening…")
    .setFooter({ text: "Updates automatically • Turn on Spotify activity status" })
    .setTimestamp(new Date());

  const msg = await channel.send({ embeds: [placeholder] });
  dashboardMessageId = msg.id;
  state.dashboardMessageId = dashboardMessageId;
  saveState(state);
  return msg;
}

// ====== MAIN REFRESH ======
async function refreshNowPlaying() {
  if (!dashboardMessage) return;

  const channel = dashboardMessage.channel;
  const guild = channel.guild;

  const { lines, covers, count } = pickElegantLines(guild, 6);

  // Rotate cover
  let cover = null;
  if (covers.length) {
    cover = covers[coverIndex % covers.length];
    coverIndex = (coverIndex + 1) % 1000000;
    state.coverIndex = coverIndex;
    saveState(state);
  }

  const title = "Now Playing";
  const subtitle = count ? `**${count}** listening right now` : "No one is showing Spotify activity right now.";

  const embed = new EmbedBuilder()
    .setColor(0x8a0606) // wine red bar
    .setTitle(title)
    .setDescription(`${subtitle}\n\n${lines.length ? lines.join("\n") : "• *(Nothing to show yet)*"}`)
    .setFooter({ text: "Updates automatically • Turn on Spotify activity status" })
    .setTimestamp(new Date());

  if (cover) embed.setThumbnail(cover);

  try {
    await dashboardMessage.edit({ embeds: [embed] });
  } catch (e) {
    console.log("edit failed:", e?.message || e);
  }
}

// Debounce refresh so presence spam doesn’t hammer edits
function requestRefreshSoon() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    refreshNowPlaying().catch(() => {});
  }, 1500);
}

// ====== READY ======
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.error("Could not fetch channel. Check CHANNEL_ID and bot permissions.");
    process.exit(1);
  }

  dashboardMessage = await getOrCreateDashboardMessage(channel);

  // First refresh
  await refreshNowPlaying().catch(() => {});

  // Fallback interval refresh (keeps it moving even if events are missed)
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshNowPlaying().catch(() => {});
  }, 7000); // 7s feels “near-live” without being spammy
});

// ====== LIVE PRESENCE UPDATES ======
client.on("presenceUpdate", () => {
  // Don’t try to fetch all members — just refresh from cache
  requestRefreshSoon();
});

client.login(token);
