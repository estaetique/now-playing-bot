require("dotenv").config();

const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const express = require("express");
const fs = require("fs");
const { registerCommands } = require("./commands");

let token = process.env.BOT_TOKEN;
let channelId = process.env.CHANNEL_ID;
const clientId = process.env.CLIENT_ID;     // for slash commands
const guildId = process.env.GUILD_ID || ""; // optional: makes command updates instant

// Local fallback (ONLY for your PC, never upload config.json)
if ((!token || !channelId) && fs.existsSync("./config.json")) {
  const local = require("./config.json");
  token = token || local.token;
  channelId = channelId || local.channelId;
}

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
let styleMode = state.styleMode || "detailed";
let coverIndex = 0;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------------------------
// ✅ Tiny web server (for uptime pings)
// ---------------------------
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => res.status(200).send("now-playing-bot: ok"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

app.listen(PORT, () => console.log(`Web server listening on ${PORT}`));

// ---------------------------
// Spotify helper
// ---------------------------
function pickSpotifyActivity(member) {
  const activities = member.presence?.activities || [];
  return activities.find((a) => a.name === "Spotify" && a.details && a.state);
}

function spotifyCoverUrl(spotify) {
  if (!spotify?.assets?.largeImage) return null;
  const img = spotify.assets.largeImage.replace("spotify:", "");
  return `https://i.scdn.co/image/${img}`;
}

async function getOrCreateDashboardMessage(channel) {
  if (dashboardMessageId) {
    try {
      return await channel.messages.fetch(dashboardMessageId);
    } catch {
      dashboardMessageId = null;
    }
  }

  const msg = await channel.send("🎵 **Now Playing**\nLoading...");
  dashboardMessageId = msg.id;
  state.dashboardMessageId = dashboardMessageId;
  saveState(state);
  return msg;
}

function buildEmbed({ lines, covers }) {
  const body =
    lines.length > 0 ? lines.join("\n") : "_No one is showing Spotify activity right now._";

  let albumArt = null;
  if (covers.length > 0) {
    coverIndex = (coverIndex + 1) % covers.length;
    albumArt = covers[coverIndex];
  }

  const embed = new EmbedBuilder()
    .setTitle("🎵 Now Playing")
    .setDescription(body)
    .setFooter({
      text:
        "Tip: User Settings → Connections → Spotify → enable 'Display on profile' + 'Display Spotify as your status'."
    })
    .setTimestamp();

  if (albumArt) embed.setThumbnail(albumArt);

  return embed;
}

function formatLines({ membersWithSpotify }) {
  // prettier display
  // compact: fewer details, one line each
  // detailed: song — artist (and uses italic)
  if (styleMode === "compact") {
    return membersWithSpotify.map(({ member, spotify }) => {
      return `• **${member.user.username}** — ${spotify.details}`;
    });
  }

  return membersWithSpotify.map(({ member, spotify }) => {
    return `• **${member.user.username}** — **${spotify.details}** (*${spotify.state}*)`;
  });
}

async function refreshNowPlaying() {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const guild = channel.guild;
  if (!guild) return;

  // force cache fill (helps keep presence data updated)
  await guild.members.fetch({ withPresences: true }).catch(() => {});

  const membersWithSpotify = [];
  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    const spotify = pickSpotifyActivity(member);
    if (spotify) membersWithSpotify.push({ member, spotify });
  }

  // keep list stable-ish
  membersWithSpotify.sort((a, b) => a.member.user.username.localeCompare(b.member.user.username));

  const covers = membersWithSpotify
    .map(({ spotify }) => spotifyCoverUrl(spotify))
    .filter(Boolean);

  const lines = formatLines({ membersWithSpotify });

  const embed = buildEmbed({ lines, covers });
  const dashboard = await getOrCreateDashboardMessage(channel);

  await dashboard.edit({ content: "", embeds: [embed] }).catch(() => {});
}

// ---------------------------
// Slash commands
// ---------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /np
  if (interaction.commandName === "np") {
    const target = interaction.options.getUser("user") || interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    const spotify = member ? pickSpotifyActivity(member) : null;
    if (!spotify) {
      return interaction.reply({
        content: `No Spotify activity found for **${target.username}** (they may have it hidden).`,
        ephemeral: true
      });
    }

    const cover = spotifyCoverUrl(spotify);
    const embed = new EmbedBuilder()
      .setTitle("🎧 Now Playing")
      .setDescription(`**${target.username}** is listening to **${spotify.details}** (*${spotify.state}*)`)
      .setTimestamp();

    if (cover) embed.setThumbnail(cover);

    return interaction.reply({ embeds: [embed], ephemeral: false });
  }

  // /np-channel (admin only)
  if (interaction.commandName === "np-channel") {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You need **Administrator** to use this.", ephemeral: true });
    }

    const ch = interaction.options.getChannel("channel");
    if (!ch?.isTextBased()) {
      return interaction.reply({ content: "Pick a **text channel**.", ephemeral: true });
    }

    channelId = ch.id;
    state.dashboardMessageId = null; // new channel, new message
    dashboardMessageId = null;
    saveState(state);

    await interaction.reply({ content: `✅ Dashboard channel set to ${ch}. Updating now…`, ephemeral: true });
    await refreshNowPlaying();
    return;
  }

  // /np-style
  if (interaction.commandName === "np-style") {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You need **Administrator** to use this.", ephemeral: true });
    }

    const mode = interaction.options.getString("mode");
    styleMode = mode;
    state.styleMode = mode;
    saveState(state);

    await interaction.reply({ content: `✅ Style set to **${mode}**. Updating now…`, ephemeral: true });
    await refreshNowPlaying();
    return;
  }
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!token || !channelId || !clientId) {
    console.log("Missing env vars. Need BOT_TOKEN, CHANNEL_ID, CLIENT_ID.");
    return;
  }

  // register slash commands
  try {
    await registerCommands({ token, clientId, guildId });
    console.log("Slash commands registered.");
  } catch (e) {
    console.log("Command register error:", e.message);
  }

  await refreshNowPlaying();

  // reliable refresh every 10s
  setInterval(() => refreshNowPlaying().catch(() => {}), 10000);
});

client.login(token);
