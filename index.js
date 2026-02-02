const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require("discord.js");
const fs = require("fs");

const token = process.env.BOT_TOKEN;
const channelId = process.env.CHANNEL_ID;
const clientId = process.env.CLIENT_ID; // add this in Render later
const guildId = process.env.GUILD_ID;   // add this too

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences]
});

let dashboardMessage = null;
let coverIndex = 0;

async function updateNowPlaying() {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const guild = channel.guild;
  await guild.members.fetch({ withPresences: true });

  const members = guild.members.cache.filter(m =>
    m.presence?.activities?.some(a => a.name === "Spotify")
  );

  if (!members.size) {
    const text = "🎵 **Now Playing**\nNo one is listening right now.";
    if (!dashboardMessage) dashboardMessage = await channel.send(text);
    else await dashboardMessage.edit(text);
    return;
  }

  const embeds = [];
  members.forEach(member => {
    const activity = member.presence.activities.find(a => a.name === "Spotify");
    const embed = new EmbedBuilder()
      .setColor("#1DB954")
      .setAuthor({ name: member.user.username })
      .setTitle(activity.details)
      .setDescription(`by **${activity.state}**`)
      .setThumbnail(activity.assets.largeImageURL());
    embeds.push(embed);
  });

  if (!dashboardMessage) dashboardMessage = await channel.send({ embeds });
  else await dashboardMessage.edit({ embeds });
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("np").setDescription("Refresh Now Playing"),
    new SlashCommandBuilder().setName("ping").setDescription("Check if bot is alive"),
    new SlashCommandBuilder().setName("setchannel").setDescription("Set Now Playing channel")
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("Channel to post in")
          .setRequired(true))
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

  updateNowPlaying();
  setInterval(updateNowPlaying, 15000);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("🏓 Pong! Bot is online.");
  }

  if (interaction.commandName === "np") {
    await updateNowPlaying();
    await interaction.reply("🔄 Refreshed Now Playing!");
  }

  if (interaction.commandName === "setchannel") {
    await interaction.reply("⚠️ Channel changing not saved yet (advanced feature).");
  }
});

client.login(token);
