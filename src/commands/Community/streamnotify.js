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
                    opt.setName('username').setDescription('Twitch username (e.g. wbhima)').setRequired(true),
                )
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Channel to post the notification in')
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
            const username = interaction.options.getString('username').trim().toLowerCase();
            const channel = interaction.options.getChannel('channel');

            const twitchUser = await getTwitchUserInfo(username);
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
