import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { createError, ErrorTypes } from '../../utils/errorHandler.js';
import { getStreamNotify, removeStreamNotify } from '../../services/streamNotifyService.js';

// interactionCreate.js route sur customId.split(':') -> name = partie avant ':', args = après
// Ici on enregistre 2 handlers distincts : streamnotify_edit et streamnotify_delete

const editButton = {
    name: 'streamnotify_edit',
    async execute(interaction, client, args) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            throw createError(
                'Missing ManageGuild permission for streamnotify edit',
                ErrorTypes.PERMISSION,
                '❌ You need the "Manage Server" permission to do this.',
                { guildId: interaction.guildId },
            );
        }

        const [username] = args;
        const entry = await getStreamNotify(client, interaction.guildId, username);

        if (!entry) {
            throw createError(
                `Streamnotify entry not found: ${username}`,
                ErrorTypes.VALIDATION,
                '❌ This tracked streamer no longer exists.',
                { guildId: interaction.guildId, username },
            );
        }

        const modal = new ModalBuilder()
            .setCustomId(`streamnotify_modal:${username}`)
            .setTitle(`Edit ${username}`.slice(0, 45));

        const messageInput = new TextInputBuilder()
            .setCustomId('message_content')
            .setLabel('Message')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.messageContent || '')
            .setRequired(false);

        const titleInput = new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setValue(entry.embedTitle || '')
            .setRequired(false);

        const descInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.embedDescription || '')
            .setRequired(false);

        const thumbInput = new TextInputBuilder()
            .setCustomId('embed_thumbnail')
            .setLabel('Embed Thumbnail (URL)')
            .setStyle(TextInputStyle.Short)
            .setValue(entry.embedThumbnail || '')
            .setRequired(false);

        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer_text')
            .setLabel('Embed Footer')
            .setStyle(TextInputStyle.Short)
            .setValue(entry.embedFooterText || '')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(messageInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(thumbInput),
            new ActionRowBuilder().addComponents(footerInput),
        );

        return interaction.showModal(modal);
    },
};

const deleteButton = {
    name: 'streamnotify_delete',
    async execute(interaction, client, args) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            throw createError(
                'Missing ManageGuild permission for streamnotify delete',
                ErrorTypes.PERMISSION,
                '❌ You need the "Manage Server" permission to do this.',
                { guildId: interaction.guildId },
            );
        }

        const [username] = args;
        const removed = await removeStreamNotify(client, interaction.guildId, username);

        if (!removed) {
            throw createError(
                `Streamnotify entry not found: ${username}`,
                ErrorTypes.VALIDATION,
                '❌ This tracked streamer no longer exists.',
                { guildId: interaction.guildId, username },
            );
        }

        return interaction.reply({
            embeds: [successEmbed('Streamer removed', `Stopped tracking \`${username}\`.`)],
            flags: MessageFlags.Ephemeral,
        });
    },
};

export default [editButton, deleteButton];
