/**
 * NOW PLAYING BOT (Discord.js v14 + Render)
 * - One message that updates (edits) instead of spamming new ones
 * - Lists multiple users currently listening to Spotify
 * - Rotates album art cover on a separate timer (cached)
 * - Opens a web port for Render health checks
 * - Adds clickable Spotify links + progress bars
 * - Slash commands: /np, /refresh
 *
 * SAFETY UPDATES:
 * - Separate timers:
 *    - Cover rotation every 8s (NO presence refetch)
 *    - Snapshot refresh (songs/progress) every 25s (presence refetch)
 * - 8s presence debounce (prevents spam from rapid status changes)
 * - refresh lock + queue (prevents overlapping refresh calls)
 * - rate-limit backoff (auto slows if Discord rate-limits)
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
  if (activity?.syncId) return `https://open.spotify.com/track/${activity.syncId}`;

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

  const spotify = presence.activities.find((a) => a && a.name === "Spotify");
  if (!spotify) return null;

  const track = spotify.details || "Unknown Track";
  const artist = spotify.state || "Unknown Artist";

  let albumUrl = null;
  if (spotify.assets && spotify.assets.largeImage) {
    const id = spotify.assets.largeImage.replace("spotify:", "");
    albumUrl = `https://i.scdn.co/image/${id}`;
  }

  const url = getSpotifyUrlFromActivity(spotify, track, artist);
  const { positionMs, durationMs } = getSpotifyTiming(spotify);

  return { track, artist, albumUrl, url, positionMs, durationMs };
}

function prettyUser(member) {
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
// SNAPSHOT CACHE (IMPORTANT)
// We only refetch presences on SNAPSHOT refresh,
// NOT on cover rotation.
// =====================
let snapshot = {
  guildName: "Now Playing",
  listeners: [],
  lastUpdated: 0,
};

let rotationIndex = 0;

// Build embed from cached snapshot + optional forced cover
function buildEmbedFromSnapshot({ forceCover = false } = {}) {
  const listeners = snapshot.listeners || [];
  const guildName = snapshot.guildName || "Now Playing";

  // Rotate cover using cached listeners (no presence fetch)
  let cover = null;
  if (listeners.length > 0) {
    if (forceCover) {
      rotationIndex = (rotationIndex + 1) % listeners.length;
    }
    cover = listeners[rotationIndex]?.albumUrl || null;
  }

  const embed = new EmbedBuilder()
    .setColor(0x8a0606)
    .setTitle(`Now Playing`)
    .setDescription(
      listeners.length
        ? `🎧 **${listeners.length}** people listening right now`
        : `No one is showing Spotify activity right now.`
    )
    .setFooter({ text: "Updates automatically from Spotify activity" })
    .setTimestamp(new Date());

  if (cover) embed.setThumbnail(cover);

  if (listeners.length) {
    const max = 20;
    const shown = listeners.slice(0, max);

    const lines = [];
    for (const x of shown) {
      const trackText = x.url ? `[${x.track}](${x.url})` : x.track;
      lines.push(`**${x.user}** — *${trackText}* — ${x.artist}`);

      if (x.positionMs != null && x.durationMs != null) {
        lines.push(`\`${makeProgressBar(x.positionMs, x.durationMs, 10)}\``);
      }

      lines.push("");
    }

    if (lines.length && lines[lines.length - 1] === "") lines.pop();

    if (listeners.length > max) {
      lines.push(`…and **${listeners.length - max}** more`);
    }

    embed.addFields([{ name: "Live", value: lines.join("\n") }]);
  }

  return embed;
}

// =====================
// REFRESH LOOP (SAFE)
// =====================

// ✅ Cover rotation every 8 seconds (cached)
const COVER_INTERVAL_MS = 8000;

// ✅ Snapshot refresh (songs + progress) every 25 seconds (LESS rate-limit)
const SNAPSHOT_INTERVAL_MS = 25000;

// ✅ Presence debounce to avoid spam
const PRESENCE_DEBOUNCE_MS = 8000;

// ✅ Backoff if Discord rate-limits
let backoffMs = 0;
const BACKOFF_STEP_MS = 10000; // +10s each time we get rate limited
const BACKOFF_MAX_MS = 120000; // cap at 2 minutes

let snapshotInterval = null;
let coverInterval = null;
let presenceDebounce = null;

// ✅ refresh lock to prevent overlapping calls
let snapshotInProgress = false;
let snapshotQueued = false;

function isRateLimitish(err) {
  const msg = (err?.message || "").toLowerCase();
  const name = (err?.name || "").toLowerCase();
  return (
    msg.includes("ratelimit") ||
    msg.includes("rate limit") ||
    msg.includes("gatewayratelimit") ||
    msg.includes("opcode 8") || // presence rate limit pattern
    name.includes("ratelimit")
  );
}

function isMissingAccess(err) {
  return err?.code === 50001 || (err?.message || "").toLowerCase().includes("missing access");
}

// Pull a fresh snapshot from Discord (this is the "expensive" call)
async function refreshSnapshot() {
  if (snapshotInProgress) {
    snapshotQueued = true;
    return;
  }

  snapshotInProgress = true;

  try {
    if (backoffMs > 0) {
      console.log(`⏳ Snapshot backoff: waiting ${backoffMs / 1000}s`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const guild = await client.guilds.fetch(GUILD_ID);

    // ⚠️ This is the rate-limit heavy call:
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

    listeners.sort((a, b) => a.user.localeCompare(b.user));

    snapshot = {
      guildName: guild.name,
      listeners,
      lastUpdated: Date.now(),
    };

    // Keep rotationIndex in bounds if list size changed
    if (snapshot.listeners.length === 0) {
      rotationIndex = 0;
    } else {
      rotationIndex = rotationIndex % snapshot.listeners.length;
    }

    // Build & push embed (songs/progress updated)
    const embed = buildEmbedFromSnapshot({ forceCover: false });
    await upsertNowPlayingMessage(embed);

    console.log("📄 Snapshot refreshed (songs/progress).");

    // success -> relax backoff slowly
    if (backoffMs > 0) backoffMs = Math.max(0, backoffMs - BACKOFF_STEP_MS);
  } catch (err) {
    console.error("❌ Snapshot refresh failed:", err?.message || err);

    if (isMissingAccess(err)) {
      console.error("🚫 Missing Access: Bot lost permissions in the CHANNEL_ID channel.");
      console.error("✅ Fix: Give bot View Channel + Send Messages + Embed Links, OR update CHANNEL_ID.");
      backoffMs = BACKOFF_MAX_MS;
    }

    if (isRateLimitish(err)) {
      backoffMs = Math.min(BACKOFF_MAX_MS, (backoffMs || 0) + BACKOFF_STEP_MS);
      console.log(`⚠️ Rate limit detected. Snapshot backoff now ${backoffMs / 1000}s`);
    }
  } finally {
    snapshotInProgress = false;

    if (snapshotQueued) {
      snapshotQueued = false;
      refreshSnapshot();
    }
  }
}

// Rotate cover ONLY (no presence fetch)
async function rotateCoverOnly() {
  try {
    // If no snapshot yet, do nothing
    if (!snapshot || !snapshot.listeners) return;

    // rotate cover index
    if (snapshot.listeners.length > 0) {
      rotationIndex = (rotationIndex + 1) % snapshot.listeners.length;
    }

    const embed = buildEmbedFromSnapshot({ forceCover: false });
    await upsertNowPlayingMessage(embed);

    console.log("🖼️ Cover rotated (cached).");
  } catch (err) {
    // Don't backoff for cover-only edits unless truly needed
    console.error("❌ Cover rotate failed:", err?.message || err);
  }
}

function startLoops() {
  // Immediately get a snapshot (songs/progress)
  refreshSnapshot();

  if (snapshotInterval) clearInterval(snapshotInterval);
  if (coverInterval) clearInterval(coverInterval);

  snapshotInterval = setInterval(() => {
    refreshSnapshot();
  }, SNAPSHOT_INTERVAL_MS);

  coverInterval = setInterval(() => {
    rotateCoverOnly();
  }, COVER_INTERVAL_MS);
}

// =====================
// EVENTS
// =====================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  startLoops();
});

// When someone starts/stops Spotify, refresh snapshot (debounced)
client.on("presenceUpdate", () => {
  if (presenceDebounce) clearTimeout(presenceDebounce);
  presenceDebounce = setTimeout(() => {
    refreshSnapshot();
  }, PRESENCE_DEBOUNCE_MS);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "np") {
      await refreshSnapshot();
      await interaction.reply({
        content: "✅ Now Playing dashboard refreshed.",
        ephemeral: true,
      });
    }

    if (interaction.commandName === "refresh") {
      await refreshSnapshot();
      await interaction.reply({
        content: "🔁 Forced refresh done.",
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);
    try {
      if (!interaction.replied) {
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