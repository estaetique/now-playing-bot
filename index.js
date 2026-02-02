/**
 * NOW PLAYING BOT (Discord.js v14 + Render)
 * - One message that updates (edits) instead of spamming new ones
 * - Lists multiple users currently listening to Spotify
 * - Rotates album art cover each refresh
 * - Opens a web port for Render health checks
 * - Adds clickable Spotify links + progress bars
 *
 * IMPORTANT UPDATES ADDED:
 * ✅ Rate-limit safe refresh (prevents overlap)
 * ✅ Slower hard refresh interval (30s instead of 15s)
 * ✅ presenceUpdate debounce refresh (feels live without hammering gateway)
 * ✅ Slash commands deferReply so they never time out ("application did not respond")
 */

const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

// =====================
// ENV VARS (Render -> Environment)
// =====================
const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // channel where the embed goes
const GUILD_ID = process.env.GUILD_ID; // your server id
const CLIENT_ID = process.env.CLIENT_ID; // your bot application id
let MESSAGE_ID = process.env.MESSAGE_ID || ""; // message to edit (set after first run)

if (!TOKEN || !CHANNEL_ID || !GUILD_ID || !CLIENT_ID) {
  console.error("❌ Missing env vars. You need TOKEN, CHANNEL_ID, GUILD_ID, CLIENT_ID.");
  process.exit(1);
}

// =====================
// RENDER WEB PORT (IMPORTANT)
// =====================
const app = express();
app.get("/", (req, res) => res.status(200).send("Now Playing Bot is alive."));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Web server listening on port ${PORT}`));

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // needed to list members
    GatewayIntentBits.GuildPresences, // needed to read Spotify presence
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Channel],
});

// =====================
// SLASH COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("np")
    .setDescription("Shows the now-playing dashboard message (and refreshes it)."),

  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Forces an immediate refresh of the now-playing list."),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("🛠 Registering slash commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }
}

// =====================
// PROGRESS BAR + LINK HELPERS
// =====================
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatTime(ms) {
  if (!ms || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function makeProgressBar(positionMs, durationMs, size = 10) {
  if (!durationMs || durationMs <= 0) return "";
  const pct = clamp(positionMs / durationMs, 0, 1);
  const filled = Math.round(pct * size);
  const empty = size - filled;

  const bar = "▰".repeat(filled) + "▱".repeat(empty);
  return `${bar}  ${formatTime(positionMs)} / ${formatTime(durationMs)}`;
}

function getSpotifyUrlFromActivity(activity, trackFallback, artistFallback) {
  // Discord Spotify activity usually includes syncId = track id
  if (activity?.syncId) return `https://open.spotify.com/track/${activity.syncId}`;

  // Fallback: Spotify search link (still clickable)
  const q = `${trackFallback || ""} ${artistFallback || ""}`.trim();
  if (q) return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
  return null;
}

function getSpotifyTiming(activity) {
  const start = activity?.timestamps?.start ? new Date(activity.timestamps.start).getTime() : null;
  const end = activity?.timestamps?.end ? new Date(activity.timestamps.end).getTime() : null;

  if (!start || !end) return { positionMs: null, durationMs: null };

  const now = Date.now();
  const durationMs = end - start;
  const positionMs = clamp(now - start, 0, durationMs);
  return { positionMs, durationMs };
}

// =====================
// SPOTIFY HELPERS
// =====================
function getSpotifyActivity(member) {
  const presence = member.presence;
  if (!presence || !presence.activities) return null;

  // Spotify activity is usually named "Spotify"
  const spotify = presence.activities.find((a) => a && a.name === "Spotify");
  if (!spotify) return null;

  const track = spotify.details || "Unknown Track";
  const artist = spotify.state || "Unknown Artist";

  // album image
  let albumUrl = null;
  if (spotify.assets && spotify.assets.largeImage) {
    const large = spotify.assets.largeImage; // "spotify:xxxxx"
    const id = large.replace("spotify:", "");
    albumUrl = `https://i.scdn.co/image/${id}`;
  }

  // clickable url + timing for progress
  const url = getSpotifyUrlFromActivity(spotify, track, artist);
  const { positionMs, durationMs } = getSpotifyTiming(spotify);

  return { track, artist, albumUrl, url, positionMs, durationMs };
}

function prettyUser(member) {
  // Prefer server nickname/display name
  return member.displayName || member.user?.username || "Unknown";
}

// =====================
// MESSAGE UPSERT (send once, then edit forever)
// =====================
async function upsertNowPlayingMessage(embed) {
  const channel = await client.channels.fetch(CHANNEL_ID);

  let msg = null;

  if (MESSAGE_ID) {
    try {
      msg = await channel.messages.fetch(MESSAGE_ID);
    } catch {
      msg = null;
    }
  }

  if (!msg) {
    const sent = await channel.send({ embeds: [embed] });
    MESSAGE_ID = sent.id;

    console.log("✅ Sent new dashboard message.");
    console.log("📌 SET THIS IN RENDER ENV as MESSAGE_ID:", MESSAGE_ID);
    console.log("   Render -> Environment -> MESSAGE_ID -> paste it -> redeploy");
    return sent;
  }

  await msg.edit({ embeds: [embed] });
  return msg;
}

// =====================
// DASHBOARD BUILD
// =====================
let rotationIndex = 0;

async function buildDashboardEmbed() {
  const guild = await client.guilds.fetch(GUILD_ID);

  // Ensure we have members + presences cached
  // NOTE: This is the heavy call, so we protect it with rate-limit-safe scheduling
  await guild.members.fetch({ withPresences: true });

  const members = guild.members.cache;
  const listeners = [];

  for (const [, member] of members) {
    const spotify = getSpotifyActivity(member);
    if (!spotify) continue;

    listeners.push({
      user: prettyUser(member),
      track: spotify.track,
      artist: spotify.artist,
      albumUrl: spotify.albumUrl,
      url: spotify.url,
      positionMs: spotify.positionMs,
      durationMs: spotify.durationMs,
    });
  }

  // Sort for stable output (optional)
  listeners.sort((a, b) => a.user.localeCompare(b.user));

  // Rotate album cover: pick 1 listener’s album art each update
  let cover = null;
  if (listeners.length > 0) {
    rotationIndex = (rotationIndex + 1) % listeners.length;
    cover = listeners[rotationIndex].albumUrl || null;
  }

  const embed = new EmbedBuilder()
    .setColor(0x8a0606) // wine red
    .setTitle(`Now Playing in ${guild.name}`)
    .setDescription(
      listeners.length
        ? `🎧 **${listeners.length}** people listening right now`
        : `No one is showing Spotify activity right now.`
    )
    .setFooter({ text: "Updates automatically from Spotify activity" })
    .setTimestamp(new Date());

  if (cover) embed.setThumbnail(cover);

  if (listeners.length) {
    // Limit to avoid embed length issues
    const max = 20;
    const shown = listeners.slice(0, max);

    // Build elegant lines + add progress bar under each person
    const lines = [];
    for (const x of shown) {
      const trackText = x.url ? `[${x.track}](${x.url})` : x.track;
      lines.push(`**${x.user}** — *${trackText}* — ${x.artist}`);

      // Add progress bar if we have timestamps
      if (x.positionMs != null && x.durationMs != null) {
        lines.push(`\`${makeProgressBar(x.positionMs, x.durationMs, 10)}\``);
      }

      lines.push(""); // blank line between people
    }

    // remove last blank line for cleaner ending
    if (lines.length && lines[lines.length - 1] === "") lines.pop();

    if (listeners.length > max) {
      lines.push(`…and **${listeners.length - max}** more`);
    }

    embed.addFields([
      {
        name: "Live",
        value: lines.join("\n"),
      },
    ]);
  }

  return embed;
}

// =====================
// REFRESH LOOP (UPDATED: RATE LIMIT SAFE)
// =====================
let intervalHandle = null;

// Rate-limit safety
let refreshInFlight = false;
let pendingRefresh = false;
let presenceDebounce = null;

// Safer hard refresh interval (Discord gateway friendly)
const HARD_REFRESH_INTERVAL_MS = 30000; // was 15000

async function refreshDashboard() {
  // Prevent overlapping refreshes
  if (refreshInFlight) {
    pendingRefresh = true;
    return;
  }

  refreshInFlight = true;

  try {
    const embed = await buildDashboardEmbed();
    await upsertNowPlayingMessage(embed);
    console.log("🔁 Dashboard refreshed.");
  } catch (err) {
    console.error("❌ Refresh failed:", err?.message || err);
  } finally {
    refreshInFlight = false;

    // If something requested another refresh while we were busy, do one more pass
    if (pendingRefresh) {
      pendingRefresh = false;
      setTimeout(() => refreshDashboard(), 2000);
    }
  }
}

function startLoop() {
  refreshDashboard();

  if (intervalHandle) clearInterval(intervalHandle);

  intervalHandle = setInterval(() => {
    refreshDashboard();
  }, HARD_REFRESH_INTERVAL_MS);
}

// =====================
// EVENTS
// =====================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  startLoop();
});

// Debounced refresh on presence changes (feels live without hammering gateway)
client.on("presenceUpdate", () => {
  clearTimeout(presenceDebounce);
  presenceDebounce = setTimeout(() => {
    refreshDashboard();
  }, 5000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "np" || interaction.commandName === "refresh") {
      // Prevent "application did not respond"
      await interaction.deferReply({ ephemeral: true });

      await refreshDashboard();

      await interaction.editReply(
        interaction.commandName === "np"
          ? "✅ Now Playing dashboard refreshed."
          : "🔁 Forced refresh done."
      );
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);
    try {
      // If deferReply happened, editReply; otherwise reply
      if (interaction.deferred) {
        await interaction.editReply("❌ Something broke while running that command.");
      } else if (!interaction.replied) {
        await interaction.reply({
          content: "❌ Something broke while running that command.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

// =====================
// LOGIN
// =====================
client.login(TOKEN);