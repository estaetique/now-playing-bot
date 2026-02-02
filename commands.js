const { REST, Routes } = require("discord.js");

async function registerCommands({ token, clientId, guildId }) {
  const commands = [
    {
      name: "np",
      description: "Show what you (or someone) is listening to on Spotify.",
      options: [
        {
          name: "user",
          description: "Pick a user (optional).",
          type: 6, // USER
          required: false
        }
      ]
    },
    {
      name: "np-channel",
      description: "Set which channel the Now Playing dashboard should live in.",
      options: [
        {
          name: "channel",
          description: "The text channel to post the dashboard in.",
          type: 7, // CHANNEL
          required: true
        }
      ],
      default_member_permissions: "0"
    },
    {
      name: "np-style",
      description: "Change display style (compact or detailed).",
      options: [
        {
          name: "mode",
          description: "Choose style mode.",
          type: 3, // STRING
          required: true,
          choices: [
            { name: "compact", value: "compact" },
            { name: "detailed", value: "detailed" }
          ]
        }
      ],
      default_member_permissions: "0"
    }
  ];

  const rest = new REST({ version: "10" }).setToken(token);

  // If guildId provided: instant updates. If not: global (can take up to 1 hour)
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
}

module.exports = { registerCommands };
