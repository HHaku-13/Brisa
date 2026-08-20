import { MessageFlags } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { upsertStreamNotify } from '../../services/streamNotifyService.js';

export default {
    name: 'streamnotify_modal',
    async execute(interaction, client, args) {
        const [username] = args;

        const messageContent = interaction.fields.getTextInputValue('message_content');
        const embedTitle = interaction.fields.getTextInputValue('embed_title');
        const embedDescription = interaction.fields.getTextInputValue('embed_description');
        const embedThumbnail = interaction.fields.getTextInputValue('embed_thumbnail');
        const embedFooterText = interaction.fields.getTextInputValue('embed_footer_text');

        const updated = await upsertStreamNotify(client, interaction.guildId, username, {
            messageContent,
            embedTitle: embedTitle || null,
            embedDescription: embedDescription || null,
            embedThumbnail: embedThumbnail || null,
            embedFooterText: embedFooterText || null,
        });

        const preview = createEmbed({
            title: updated.embedTitle || undefined,
            description: updated.embedDescription || undefined,
            image: updated.embedThumbnail || undefined,
            footer: updated.embedFooterText ? { text: updated.embedFooterText } : undefined,
            color: updated.embedColor || '#9146FF',
        });

        const hasEmbedContent = updated.embedTitle || updated.embedDescription || updated.embedThumbnail;

        return interaction.reply({
            embeds: [
                successEmbed('Configuration updated', `**Message preview:**\n${messageContent || '*(empty)*'}`),
                ...(hasEmbedContent ? [preview] : []),
            ],
            flags: MessageFlags.Ephemeral,
        });
    },
};
