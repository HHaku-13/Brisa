import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { createError, ErrorTypes } from '../../utils/errorHandler.js';
import {
    getAllStreamNotifies,
    upsertStreamNotify,
    removeStreamNotify,
} from '../../services/streamNotifyService.js';
import { getTwitchUserInfo } from '../../services/twitchService.js';

/**
 * Accepte soit un pseudo Twitch brut ("wbhima"), soit une URL de chaîne
 * ("https://twitch.tv/wbhima", "twitch.tv/wbhima", "www.twitch.tv/wbhima/").
 * Retourne le pseudo extrait en minuscules, ou null si le format est invalide.
 */
function extractTwitchUsername(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return null;

    // Essaye de parser comme une URL (avec ou sans protocole)
    const urlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]{2,25})(?:[/?#].*)?$/i);
    if (urlMatch) {
        return urlMatch[1].toLowerCase();
    }

    // Sinon, pseudo brut (règles Twitch : 2-25 caractères, alphanumériques + underscore)
    if (/^[a-zA-Z0-9_]{2,25}$/.test(trimmed)) {
        return trimmed.toLowerCase();
    }

    return null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('streamnotify')
        .setDescription('Manage Twitch live notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('Track a Twitch streamer')
                .addStringOption((opt) =>
                    opt
                        .setName('channel_or_link')
                        .setDescription('Twitch username or channel URL (e.g. wbhima or https://twitch.tv/wbhima)')
                        .setRequired(true),
                )
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Discord channel to post the notification in')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub.setName('list').setDescription('List tracked streamers on this server'),
        )
        .addSubcommand((sub) =>
            sub
                .setName('remove')
                .setDescription('Stop tracking a streamer')
                .addStringOption((opt) =>
                    opt.setName('username').setDescription('Twitch username').setRequired(true),
                ),
        ),

    async execute(interaction, guildConfig, client) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'add') {
            await interaction.deferReply({ ephemeral: true });
            const rawInput = interaction.options.getString('channel_or_link');
            const channel = interaction.options.getChannel('channel');

            const username = extractTwitchUsername(rawInput);
            if (!username) {
                throw createError(
                    `Invalid Twitch username or URL: ${rawInput}`,
                    ErrorTypes.VALIDATION,
                    `❌ \`${rawInput}\` doesn't look like a valid Twitch username or channel link (e.g. \`wbhima\` or \`https://twitch.tv/wbhima\`).`,
                    { guildId, rawInput },
                );
            }

            const twitchUser = await getTwitchUserInfo(username).catch((error) => {
                // On distingue une vraie 404 (compte inexistant) d'un problème d'auth/config Twitch,
                // pour ne pas afficher "compte introuvable" quand le vrai souci est ailleurs.
                if (error.twitchStatus === 401 || error.twitchStatus === 403) {
                    throw createError(
                        `Twitch auth failed: ${error.message}`,
                        ErrorTypes.CONFIGURATION,
                        '❌ Twitch API authentication failed. Check that `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are correctly set in the bot\'s environment variables.',
                        { guildId, username },
                    );
                }
                throw createError(
                    `Twitch API error while looking up ${username}: ${error.message}`,
                    ErrorTypes.DATABASE,
                    '❌ Twitch API is temporarily unreachable. Please try again in a moment.',
                    { guildId, username },
                );
            });

            if (!twitchUser) {
                throw createError(
                    `Twitch user not found: ${username}`,
                    ErrorTypes.VALIDATION,
                    `❌ Could not find a Twitch account named \`${username}\`.`,
                    { guildId, username },
                );
            }

            await upsertStreamNotify(client, guildId, username, {
                channelId: channel.id,
                embedThumbnail: twitchUser.profile_image_url,
                displayName: twitchUser.display_name,
            });

            return interaction.editReply({
                embeds: [
                    successEmbed(
                        'Streamer added',
                        `**${twitchUser.display_name}** will be announced in ${channel} when they go live.`,
                    ),
                ],
            });
        }

        if (sub === 'remove') {
            const username = interaction.options.getString('username').trim().toLowerCase();
            const removed = await removeStreamNotify(client, guildId, username);

            if (!removed) {
                throw createError(
                    `Streamnotify entry not found: ${username}`,
                    ErrorTypes.VALIDATION,
                    `❌ No tracked streamer found for \`${username}\`.`,
                    { guildId, username },
                );
            }

            return interaction.reply({
                embeds: [successEmbed('Streamer removed', `Stopped tracking \`${username}\`.`)],
                ephemeral: true,
            });
        }

        if (sub === 'list') {
            await interaction.deferReply({ ephemeral: true });
            const entries = await getAllStreamNotifies(client, guildId);

            if (entries.length === 0) {
                return interaction.editReply({
                    embeds: [createEmbed({ title: '📡 Tracked streamers', description: 'No streamers tracked yet. Use `/streamnotify add`.' })],
                });
            }

            // Discord limite à 5 action rows par message -> page de 5 max pour l'instant
            const page = entries.slice(0, 5);

            const embed = createEmbed({
                title: '📡 Tracked streamers',
                description: page
                    .map((e) => `**${e.twitchUsername}** — <#${e.channelId}> ${e.isLive ? '🔴 live' : ''}`)
                    .join('\n'),
                footer: entries.length > 5 ? { text: `Showing 5 of ${entries.length}` } : undefined,
            });

            const rows = page.map((e) =>
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`streamnotify_edit:${e.twitchUsername}`)
                        .setLabel(`Edit ${e.twitchUsername}`)
                        .setEmoji('✏️')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`streamnotify_delete:${e.twitchUsername}`)
                        .setLabel('Remove')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Danger),
                ),
            );

            return interaction.editReply({ embeds: [embed], components: rows });
        }
    },
};
