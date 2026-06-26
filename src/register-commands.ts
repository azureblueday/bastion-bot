import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const commands = [
  // ---- Panel / misc ----
  new SlashCommandBuilder()
    .setName("setpanel")
    .setDescription("Configure and post the buyer script panel in this channel")
    .addAttachmentOption((o) =>
      o.setName("loader_script").setDescription("The loader/script file buyers receive from Get Script").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("buyer_role").setDescription("Role to give the user after redeeming a key").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("manager_role").setDescription("Role allowed to manage the bot (besides Manage Server)")
    ),

  new SlashCommandBuilder().setName("test").setDescription("Check the bot is online and authenticated"),

  new SlashCommandBuilder()
    .setName("login")
    .setDescription("Link this server to your Bastion account with your API key")
    .addStringOption((o) =>
      o.setName("api_key").setDescription("Your Bastion API key (from Account → API Key)").setRequired(true)
    ),

  // ---- Key generation ----
  new SlashCommandBuilder()
    .setName("generate")
    .setDescription("Generate keys for a project")
    .addStringOption((o) => o.setName("project_id").setDescription("Project ID (omit to use the default project)"))
    .addIntegerOption((o) => o.setName("count").setDescription("How many keys (1-100)").setMinValue(1).setMaxValue(100))
    .addIntegerOption((o) => o.setName("days").setDescription("Days until expiry (omit for lifetime)").setMinValue(1))
    .addBooleanOption((o) => o.setName("lifetime").setDescription("Generate lifetime keys"))
    .addStringOption((o) => o.setName("note").setDescription("Optional note")),

  new SlashCommandBuilder()
    .setName("mass-generate")
    .setDescription("Generate multiple keys at once")
    .addIntegerOption((o) =>
      o.setName("count").setDescription("How many keys (1-100)").setMinValue(1).setMaxValue(100).setRequired(true)
    )
    .addIntegerOption((o) => o.setName("days").setDescription("Days until expiry (omit for lifetime)").setMinValue(1))
    .addBooleanOption((o) => o.setName("lifetime").setDescription("Generate lifetime keys"))
    .addStringOption((o) => o.setName("project_id").setDescription("Project ID (omit to use the default project)"))
    .addStringOption((o) => o.setName("note").setDescription("Optional note")),

  // ---- Whitelist management (by user) ----
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist a user: create a key, link them, grant the role, DM the key")
    .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true))
    .addIntegerOption((o) => o.setName("days").setDescription("Days until expiry (omit for lifetime)").setMinValue(1))
    .addBooleanOption((o) => o.setName("lifetime").setDescription("Lifetime key"))
    .addStringOption((o) => o.setName("project_id").setDescription("Project ID (omit to use the default project)")),

  new SlashCommandBuilder()
    .setName("unwhitelist")
    .setDescription("Revoke a user's access and remove their role")
    .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true)),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist a user (locks all their keys, removes role)")
    .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),

  new SlashCommandBuilder()
    .setName("force-resethwid")
    .setDescription("Reset a user's HWID, ignoring cooldown")
    .addUserOption((o) => o.setName("user").setDescription("Discord user").setRequired(true)),

  // ---- Key lookup / management ----
  new SlashCommandBuilder()
    .setName("lookup")
    .setDescription("Look up keys by raw key or Discord user")
    .addStringOption((o) => o.setName("key").setDescription("Raw key value"))
    .addUserOption((o) => o.setName("user").setDescription("Discord user (matches linked keys)"))
    .addStringOption((o) => o.setName("project_id").setDescription("Limit to a project")),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock (blacklist) a key by ID")
    .addStringOption((o) => o.setName("key_id").setDescription("Key ID").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock a key by ID")
    .addStringOption((o) => o.setName("key_id").setDescription("Key ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show key statistics")
    .addStringOption((o) => o.setName("project_id").setDescription("Project ID (omit for all)")),
].map((c) => c.toJSON());

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN!;
  const clientId = process.env.DISCORD_CLIENT_ID!;
  const guildId = process.env.GUILD_ID;
  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Registered ${commands.length} guild commands to ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Registered ${commands.length} global commands.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
