import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  MessageFlags,
  Routes,
  Interaction,
  PermissionFlagsBits,
} from "discord.js";
import dns from "node:dns";
import dotenv from "dotenv";
import { api, ApiError, BotKey, GuildPanel } from "./api";

dotenv.config();

// Prefer IPv4 — many hosts advertise IPv6 but can't route it, which surfaces as
// "fetch failed / ECONNREFUSED" on outbound API calls.
dns.setDefaultResultOrder("ipv4first");

const ACCENT = 0xf97316;
const RED = 0xef4444;
const GREEN = 0x22c55e;

const BASE = (process.env.BASTION_API_URL || "http://localhost:3000").replace(/\/$/, "");
// Optional fallbacks for key generation when a project isn't passed explicitly.
const DEFAULT_PROJECT_ID = process.env.PANEL_PROJECT_ID || "";
const FALLBACK_SCRIPT_PUBLIC_ID = process.env.SCRIPT_PUBLIC_ID || "";
const HWID_COOLDOWN_HOURS = Number(process.env.HWID_COOLDOWN_HOURS || 24);

// Global super-admins (optional). Per-guild access is Manage Server OR the
// guild's configured manager_role.
const OWNER_IDS = (process.env.OWNER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const hwidCooldown = new Map<string, number>();

// Per-guild panel config cache (60s TTL).
const configCache = new Map<string, { data: GuildPanel | null; exp: number }>();
async function getConfig(guildId: string): Promise<GuildPanel | null> {
  const cached = configCache.get(guildId);
  if (cached && Date.now() < cached.exp) return cached.data;
  try {
    const res = await api.getPanel(guildId);
    configCache.set(guildId, { data: res.panel, exp: Date.now() + 60_000 });
    return res.panel;
  } catch {
    return cached?.data ?? null;
  }
}
function invalidateConfig(guildId: string) {
  configCache.delete(guildId);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ----------------------------- Helpers ----------------------------- */

function statusOf(k: BotKey): "active" | "locked" | "expired" {
  if (k.isLocked) return "locked";
  if (!k.isLifetime && k.expiresAt && new Date(k.expiresAt) < new Date()) return "expired";
  return "active";
}

function daysLabel(k: BotKey): string {
  if (k.isLifetime) return "Lifetime";
  if (!k.expiresAt) return "—";
  const d = Math.floor((new Date(k.expiresAt).getTime() - Date.now()) / 86400000);
  return d < 0 ? "Expired" : `${d} day${d !== 1 ? "s" : ""}`;
}

function keyEmbed(k: BotKey): EmbedBuilder {
  const status = statusOf(k);
  return new EmbedBuilder()
    .setColor(status === "active" ? GREEN : status === "locked" ? RED : ACCENT)
    .setTitle(k.key ?? `${k.keyPrefix}…${k.last4}`)
    .addFields(
      { name: "Key ID", value: "`" + k.id + "`", inline: false },
      { name: "Project", value: k.project ?? "—", inline: true },
      { name: "Status", value: status, inline: true },
      { name: "Expiry", value: daysLabel(k), inline: true },
      { name: "Executions", value: String(k.executions), inline: true },
      { name: "HWID", value: k.hwid ? "`" + k.hwid.slice(0, 16) + "`" : "unbound", inline: true },
      { name: "Discord", value: k.discordId ? `<@${k.discordId}>` : "—", inline: true },
      { name: "Note", value: k.note || "—", inline: false }
    );
}

// Inject the buyer's key into the configured loader text (or fall back to a
// generated loadstring snippet).
function buildLoader(cfg: GuildPanel | null, rawKey?: string | null): string {
  const key = rawKey || "YOUR_KEY_HERE";
  if (cfg?.loaderText) {
    const replaced = cfg.loaderText.replace(/YOUR_KEY_HERE|YOUR_KEY|%KEY%|\{KEY\}|\{key\}/g, key);
    if (replaced !== cfg.loaderText || /script_key/i.test(replaced)) return replaced;
    return `script_key = "${key}"\n${replaced}`;
  }
  return `script_key = "${key}"\nloadstring(game:HttpGet("${BASE}/api/loader/${FALLBACK_SCRIPT_PUBLIC_ID}"))()`;
}

async function grantRole(guildId: string, userId: string, roleId?: string | null) {
  if (!roleId) return;
  await client.rest.put(Routes.guildMemberRole(guildId, userId, roleId));
}
async function removeRole(guildId: string, userId: string, roleId?: string | null) {
  if (!roleId) return;
  await client.rest.delete(Routes.guildMemberRole(guildId, userId, roleId)).catch(() => {});
}

function memberHasRole(i: ChatInputCommandInteraction, roleId: string): boolean {
  const roles = (i.member as { roles?: unknown } | null)?.roles;
  if (Array.isArray(roles)) return roles.includes(roleId);
  const cache = (roles as { cache?: { has(id: string): boolean } } | undefined)?.cache;
  return cache?.has(roleId) ?? false;
}

// Resolve which project a generation command targets: explicit option, then the
// guild's /login-linked default project, then the env fallback.
async function resolveProjectId(i: ChatInputCommandInteraction): Promise<string> {
  const explicit = i.options.getString("project_id");
  if (explicit) return explicit;
  if (i.guildId) {
    const cfg = await getConfig(i.guildId);
    if (cfg?.defaultProjectId) return cfg.defaultProjectId;
  }
  return DEFAULT_PROJECT_ID;
}

async function isManager(i: ChatInputCommandInteraction): Promise<boolean> {
  if (OWNER_IDS.includes(i.user.id)) return true;
  const perms = i.memberPermissions;
  if (perms && (perms.has(PermissionFlagsBits.Administrator) || perms.has(PermissionFlagsBits.ManageGuild)))
    return true;
  if (i.guildId) {
    const cfg = await getConfig(i.guildId);
    if (cfg?.managerRoleId && memberHasRole(i, cfg.managerRoleId)) return true;
  }
  return false;
}

async function replyText(
  i: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  content: string,
  color = ACCENT
) {
  const embed = new EmbedBuilder().setColor(color).setDescription(content);
  if (i.deferred || i.replied) await i.editReply({ embeds: [embed] });
  else await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/* ----------------------------- Panel ----------------------------- */

function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("Bastion — Script Panel")
    .setDescription(
      [
        "🔑 **Redeem Key** — Enter your key to verify your purchase",
        "📜 **Get Script** — Grab the latest script loader",
        "👤 **Get Role** — Get your buyer role in the server",
        "⚙️ **Reset HWID** — Reset your hardware ID",
        "📊 **Get Stats** — View your account stats",
      ].join("\n")
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("panel_redeem").setLabel("Redeem Key").setEmoji("🔑").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("panel_script").setLabel("Get Script").setEmoji("📜").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_role").setLabel("Get Role").setEmoji("👤").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_resethwid").setLabel("Reset HWID").setEmoji("⚙️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_stats").setLabel("Get Stats").setEmoji("📊").setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

// Buyer keys are matched across all projects (universal bot — no project binding).
async function findBuyerKey(discordId: string): Promise<BotKey | null> {
  const res = await api.lookup({ discordId });
  return res.keys[0] ?? null;
}

/* --------------------- Buyer button handlers --------------------- */

async function handleButton(i: ButtonInteraction) {
  if (i.customId === "panel_redeem") {
    const modal = new ModalBuilder().setCustomId("redeem_modal").setTitle("Redeem Key");
    const input = new TextInputBuilder()
      .setCustomId("key")
      .setLabel("Your key")
      .setPlaceholder("Paste your key here")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await i.showModal(modal);
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = i.guildId ? await getConfig(i.guildId) : null;

  try {
    if (i.customId === "panel_script") {
      const k = await findBuyerKey(i.user.id);
      if (!k || statusOf(k) !== "active") {
        await replyText(i, "No active key linked to your account. Use **Redeem Key** first.", RED);
        return;
      }
      await replyText(i, `Here is your loader:\n\`\`\`lua\n${buildLoader(cfg, k.key)}\n\`\`\``, GREEN);
      return;
    }

    if (i.customId === "panel_role") {
      const k = await findBuyerKey(i.user.id);
      if (!k || statusOf(k) !== "active") {
        await replyText(i, "No active key linked. Use **Redeem Key** first.", RED);
        return;
      }
      if (!i.guildId || !cfg?.buyerRoleId) {
        await replyText(i, "This server's panel isn't configured yet.", RED);
        return;
      }
      await grantRole(i.guildId, i.user.id, cfg.buyerRoleId);
      await replyText(i, "✅ Buyer role granted.", GREEN);
      return;
    }

    if (i.customId === "panel_resethwid") {
      const until = hwidCooldown.get(i.user.id) ?? 0;
      if (Date.now() < until) {
        const hrs = Math.ceil((until - Date.now()) / 3600000);
        await replyText(i, `⏳ You can reset your HWID again in ~${hrs}h.`, RED);
        return;
      }
      const k = await findBuyerKey(i.user.id);
      if (!k) {
        await replyText(i, "No key linked to your account.", RED);
        return;
      }
      await api.manage({ action: "reset_hwid", keyId: k.id, adminId: i.user.id });
      hwidCooldown.set(i.user.id, Date.now() + HWID_COOLDOWN_HOURS * 3600000);
      await replyText(i, "✅ HWID reset. You can now run the script on a new device.", GREEN);
      return;
    }

    if (i.customId === "panel_stats") {
      const k = await findBuyerKey(i.user.id);
      if (!k) {
        await replyText(i, "No key linked to your account. Use **Redeem Key** first.", RED);
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("Your account stats")
        .addFields(
          { name: "Status", value: statusOf(k), inline: true },
          { name: "Expiry", value: daysLabel(k), inline: true },
          { name: "Executions", value: String(k.executions), inline: true },
          { name: "HWID", value: k.hwid ? "bound" : "unbound", inline: true }
        );
      await i.editReply({ embeds: [embed] });
      return;
    }
  } catch (err) {
    const msg = errMessage(err);
    await replyText(i, `Error: ${msg}`, RED);
  }
}

async function handleModal(i: ModalSubmitInteraction) {
  if (i.customId !== "redeem_modal") return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const rawKey = i.fields.getTextInputValue("key").trim();
  try {
    const res = await api.lookup({ key: rawKey });
    const k = res.keys[0];
    if (!k) {
      await replyText(i, "❌ Invalid key. Double-check and try again.", RED);
      return;
    }
    if (k.isLocked) {
      await replyText(i, "❌ This key is blacklisted.", RED);
      return;
    }
    await api.manage({ action: "set_discord", keyId: k.id, discordId: i.user.id, adminId: i.user.id });
    const cfg = i.guildId ? await getConfig(i.guildId) : null;
    if (i.guildId && cfg?.buyerRoleId) await grantRole(i.guildId, i.user.id, cfg.buyerRoleId).catch(() => {});
    await replyText(i, "✅ Key redeemed and linked to your account! Use **Get Script** to start.", GREEN);
  } catch (err) {
    const msg = errMessage(err);
    await replyText(i, `Error: ${msg}`, RED);
  }
}

/* ----------------------- Slash commands ------------------------- */

async function handleCommand(i: ChatInputCommandInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  if (!(await isManager(i))) {
    await replyText(i, "You need **Manage Server** or the configured manager role to use this.", RED);
    return;
  }

  try {
    switch (i.commandName) {
      case "setpanel": {
        if (!i.guildId) return void (await replyText(i, "Use this in a server.", RED));
        const buyerRole = i.options.getRole("buyer_role", true);
        const managerRole = i.options.getRole("manager_role");
        const file = i.options.getAttachment("loader_script", true);
        let loaderText = "";
        try {
          const r = await fetch(file.url);
          loaderText = await r.text();
        } catch {
          return void (await replyText(i, "Couldn't read the attached file.", RED));
        }
        if (!loaderText.trim()) return void (await replyText(i, "The attached file is empty.", RED));
        await api.setPanel({
          guildId: i.guildId,
          buyerRoleId: buyerRole.id,
          managerRoleId: managerRole?.id ?? null,
          loaderText,
          createdBy: i.user.id,
        });
        invalidateConfig(i.guildId);
        if (i.channel && "send" in i.channel) {
          await i.channel.send(buildPanel()).catch(() => {});
        }
        await replyText(i, "✅ Panel configured and posted in this channel.", GREEN);
        break;
      }

      case "test":
        await replyText(i, "✅ Bastion bot is online and authenticated.", GREEN);
        break;

      case "login": {
        if (!i.guildId) return void (await replyText(i, "Use this in a server.", RED));
        const apiKey = i.options.getString("api_key", true).trim();
        const res = await api.login({ guildId: i.guildId, apiKey });
        invalidateConfig(i.guildId);
        await replyText(
          i,
          `✅ Linked to **${res.username}**${
            res.projectName
              ? ` · default project: **${res.projectName}**`
              : " — no projects yet, create one on the dashboard"
          }.`,
          GREEN
        );
        break;
      }

      case "generate":
      case "mass-generate": {
        const projectId = await resolveProjectId(i);
        if (!projectId) return void (await replyText(i, "No project linked. Run `/login` first or pass `project_id`.", RED));
        const count = i.options.getInteger("count") ?? 1;
        const days = i.options.getInteger("days") ?? undefined;
        const lifetime = i.options.getBoolean("lifetime") ?? false;
        const note = i.options.getString("note") ?? undefined;
        const res = await api.generate({
          projectId,
          count,
          durationDays: days,
          isLifetime: lifetime,
          note,
          reason: count > 25 ? "discord bulk" : undefined,
          adminId: i.user.id,
        });
        const list = res.keys.map((k) => k.raw).join("\n");
        await replyText(
          i,
          `Generated **${res.keys.length}** key${res.keys.length !== 1 ? "s" : ""}:\n\`\`\`\n${list}\n\`\`\``,
          GREEN
        );
        break;
      }

      case "lookup": {
        const key = i.options.getString("key") ?? undefined;
        const user = i.options.getUser("user");
        const projectId = i.options.getString("project_id") ?? undefined;
        if (!key && !user) return void (await replyText(i, "Provide a key or a user.", RED));
        const res = await api.lookup({ key, discordId: user?.id, projectId });
        if (res.keys.length === 0) return void (await replyText(i, "No matching keys found.", RED));
        await i.editReply({ embeds: res.keys.slice(0, 5).map(keyEmbed) });
        break;
      }

      case "whitelist": {
        const user = i.options.getUser("user", true);
        const projectId = await resolveProjectId(i);
        if (!projectId) return void (await replyText(i, "No project linked. Run `/login` first or pass `project_id`.", RED));
        const days = i.options.getInteger("days") ?? undefined;
        const lifetime = i.options.getBoolean("lifetime") ?? false;
        const res = await api.generate({
          projectId,
          count: 1,
          durationDays: days,
          isLifetime: lifetime,
          note: `whitelist:${user.tag}`,
          adminId: i.user.id,
        });
        const created = res.keys[0];
        await api.manage({ action: "set_discord", keyId: created.id, discordId: user.id, adminId: i.user.id });
        const cfg = i.guildId ? await getConfig(i.guildId) : null;
        if (i.guildId && cfg?.buyerRoleId) await grantRole(i.guildId, user.id, cfg.buyerRoleId).catch(() => {});
        await user.send(`You have been whitelisted! Your key:\n\`\`\`\n${created.raw}\n\`\`\``).catch(() => {});
        await replyText(i, `✅ Whitelisted <@${user.id}> and DM'd their key.`, GREEN);
        break;
      }

      case "unwhitelist": {
        const user = i.options.getUser("user", true);
        const res = await api.lookup({ discordId: user.id });
        if (res.keys.length === 0) return void (await replyText(i, "No keys linked to that user.", RED));
        for (const k of res.keys) {
          await api.manage({ action: "lock", keyId: k.id, lockReason: "unwhitelisted", adminId: i.user.id });
        }
        const cfg = i.guildId ? await getConfig(i.guildId) : null;
        if (i.guildId && cfg?.buyerRoleId) await removeRole(i.guildId, user.id, cfg.buyerRoleId);
        await replyText(i, `✅ Revoked ${res.keys.length} key(s) from <@${user.id}> and removed role.`, GREEN);
        break;
      }

      case "blacklist": {
        const user = i.options.getUser("user", true);
        const reason = i.options.getString("reason") ?? "blacklisted";
        const res = await api.lookup({ discordId: user.id });
        if (res.keys.length === 0) return void (await replyText(i, "No keys linked to that user.", RED));
        for (const k of res.keys) {
          await api.manage({ action: "lock", keyId: k.id, lockReason: reason, adminId: i.user.id });
        }
        const cfg = i.guildId ? await getConfig(i.guildId) : null;
        if (i.guildId && cfg?.buyerRoleId) await removeRole(i.guildId, user.id, cfg.buyerRoleId);
        await replyText(i, `🚫 Blacklisted <@${user.id}> (${res.keys.length} key(s)).`, RED);
        break;
      }

      case "force-resethwid": {
        const user = i.options.getUser("user", true);
        const res = await api.lookup({ discordId: user.id });
        if (res.keys.length === 0) return void (await replyText(i, "No keys linked to that user.", RED));
        for (const k of res.keys) {
          await api.manage({ action: "reset_hwid", keyId: k.id, adminId: i.user.id });
        }
        hwidCooldown.delete(user.id);
        await replyText(i, `✅ Force-reset HWID for <@${user.id}> (cooldown ignored).`, GREEN);
        break;
      }

      case "lock": {
        const keyId = i.options.getString("key_id", true);
        const reason = i.options.getString("reason") ?? "discord";
        await api.manage({ action: "lock", keyId, lockReason: reason, adminId: i.user.id });
        await replyText(i, `Key \`${keyId}\` locked.`, RED);
        break;
      }

      case "unlock": {
        const keyId = i.options.getString("key_id", true);
        await api.manage({ action: "unlock", keyId, adminId: i.user.id });
        await replyText(i, `Key \`${keyId}\` unlocked.`, GREEN);
        break;
      }

      case "stats": {
        const projectId = i.options.getString("project_id") ?? undefined;
        const s = await api.stats(projectId);
        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle(`Stats — ${s.project ?? "All projects"}`)
          .addFields(
            { name: "Total keys", value: String(s.total), inline: true },
            { name: "Active", value: String(s.active), inline: true },
            { name: "Locked", value: String(s.locked), inline: true },
            { name: "Expired", value: String(s.expired), inline: true },
            { name: "Executions", value: s.executions.toLocaleString(), inline: true }
          );
        await i.editReply({ embeds: [embed] });
        break;
      }

      default:
        await replyText(i, "Unknown command.", RED);
    }
  } catch (err) {
    const msg = errMessage(err);
    await replyText(i, `Error: ${msg}`, RED);
  }
}

/* --------------------------- Dispatch --------------------------- */

function causeOf(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (!cause) return "";
  return ` (${cause.code || cause.message || String(cause)})`;
}

function errMessage(err: unknown): string {
  console.error("[bastion-bot] handler error:", err);
  if (err instanceof Error) return err.message + causeOf(err);
  return "Unexpected error.";
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Bastion bot online as ${c.user.tag}`);
  console.log(
    `[bastion-bot] API=${BASE} | HMAC=${process.env.BOT_HMAC_KEY ? "set" : "MISSING"} | OWNERS=${OWNER_IDS.length}`
  );
  // Connectivity self-test so the real network failure shows up in the console.
  try {
    const r = await fetch(BASE + "/");
    console.log(`[bastion-bot] connectivity OK: ${BASE} -> HTTP ${r.status}`);
  } catch (e) {
    console.error(
      `[bastion-bot] connectivity FAILED to ${BASE}: ${(e as Error).message}${causeOf(e)}`
    );
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (err) {
    console.error("interaction error", err);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
