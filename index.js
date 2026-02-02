/**
 * NOW PLAYING BOT (Discord.js v14 + Render)
 * - One message that updates (edits) instead of spamming new ones
 * - Lists multiple users currently listening to Spotify
 * - Rotates album art cover each refresh
 * - Opens a web port for Render health checks
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
const GUILD_ID = process.env.GUILD_ID;     // your server id
const CLIENT_ID = process.env.CLIENT_ID;   // your bot application id
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
    GatewayIntentBits.GuildMembers,   // needed to list members
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
// SPOTIFY HELPERS
// =====================
function getSpotifyActivity(member) {
  const presence = member.presence;
  if (!presence || !presence.activities) return null;

  // Spotify activity is usually named "Spotify"
  const spotify = presence.activities.find((a) => a && a.name === "Spotify");
  if (!spotify) return null;

  // spotify.details = track name
  // spotify.state = artist name(s)
  // spotify.assets.largeImage = "spotify:ab67616d0000b273...."
  const track = spotify.details || "Unknown Track";
  const artist = spotify.state || "Unknown Artist";

  // album image
  let albumUrl = null;
  if (spotify.assets && spotify.assets.largeImage) {
    const large = spotify.assets.largeImage; // "spotify:xxxxx"
    const id = large.replace("spotify:", "");
    albumUrl = `https://i.scdn.co/image/${id}`;
  }

  return { track, artist, albumUrl };
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
  // This fetch helps a LOT when the bot just restarted.
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
    .setColor(0x8a0606) // your wine red
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
    // Keep it elegant + readable
    // Limit to avoid embed length issues
    const max = 20;
    const shown = listeners.slice(0, max);

    const lines = shown.map(
      (x) => `**${x.user}** — *${x.track}* — ${x.artist}`
    );

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
// REFRESH LOOP
// =====================
let intervalHandle = null;

async function refreshDashboard() {
  try {
    const embed = await buildDashboardEmbed();
    await upsertNowPlayingMessage(embed);
    console.log("🔁 Dashboard refreshed.");
  } catch (err) {
    console.error("❌ Refresh failed:", err);
  }
}

function startLoop() {
  // refresh immediately, then every 15s
  refreshDashboard();
  if (intervalHandle) clearInterval(intervalHandle);

  intervalHandle = setInterval(() => {
    refreshDashboard();
  }, 15000);
}

// =====================
// EVENTS
// =====================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  startLoop();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "np") {
      await refreshDashboard();
      await interaction.reply({
        content: "✅ Now Playing dashboard refreshed.",
        ephemeral: true,
      });
    }

    if (interaction.commandName === "refresh") {
      await refreshDashboard();
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
