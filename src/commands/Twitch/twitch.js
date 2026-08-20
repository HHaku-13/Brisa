
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

import {
    getTwitchUser,
    addWatchedChannel,
    removeWatchedChannel,
    getWatchedChannels,
    startTwitchChecker,
} from '../../services/twitchService.js';

const data = new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Gère les notifications Twitch du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())

    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Ajoute une chaîne Twitch à surveiller')
            .addStringOption(option =>
                option
                    .setName('chaine')
                    .setDescription('Nom de la chaîne Twitch')
                    .setRequired(true)
            )
            .addChannelOption(option =>
                option
                    .setName('salon')
                    .setDescription('Salon Discord où envoyer la notification')
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Supprime une chaîne Twitch de la surveillance')
            .addStringOption(option =>
                option
                    .setName('chaine')
                    .setDescription('Nom de la chaîne Twitch')
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('Affiche les chaînes Twitch surveillées')
    );

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
        await interaction.deferReply({ ephemeral: true });

        const twitchLogin = interaction.options.getString('chaine');
        const discordChannel = interaction.options.getChannel('salon');

        // On vérifie que le salon permet d'envoyer des messages.
        if (!discordChannel.isTextBased()) {
            await interaction.editReply(
                '❌ Le salon sélectionné ne permet pas d\'envoyer des messages.'
            );
            return;
        }

        try {
            const twitchUser = await getTwitchUser(twitchLogin);

            if (!twitchUser) {
                await interaction.editReply(
                    `❌ Je ne trouve pas la chaîne Twitch **${twitchLogin}**.`
                );
                return;
            }

            addWatchedChannel(
                interaction.guildId,
                twitchUser.login,
                discordChannel.id
            );

            await interaction.editReply(
                `✅ La chaîne Twitch **${twitchUser.display_name}** est maintenant surveillée.\n` +
                `📢 Les notifications seront envoyées dans ${discordChannel}.`
            );

            console.log(
                `[TWITCH] ${twitchUser.login} ajouté pour le serveur ${interaction.guildId}`
            );
        } catch (error) {
            console.error('[TWITCH] Erreur /twitch add:', error);

            await interaction.editReply(
                '❌ Impossible de contacter Twitch. Vérifie que `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` sont correctement configurés dans ton `.env`.'
            );
        }

        return;
    }

    if (subcommand === 'remove') {
        await interaction.deferReply({ ephemeral: true });

        const twitchLogin = interaction.options.getString('chaine');

        const removed = removeWatchedChannel(
            interaction.guildId,
            twitchLogin
        );

        if (!removed) {
            await interaction.editReply(
                `❌ La chaîne **${twitchLogin}** n'est pas surveillée sur ce serveur.`
            );
            return;
        }

        await interaction.editReply(
            `✅ La chaîne Twitch **${twitchLogin}** ne sera plus surveillée.`
        );

        return;
    }

    if (subcommand === 'list') {
        const channels = getWatchedChannels(interaction.guildId);

        if (channels.length === 0) {
            await interaction.reply({
                content: '📺 Aucune chaîne Twitch n\'est actuellement surveillée.',
                ephemeral: true,
            });
            return;
        }

        const lines = channels.map(channel =>
            `• **${channel.login}** → <#${channel.channelId}>`
        );

        await interaction.reply({
            content:
                `📺 **Chaînes Twitch surveillées :**\n\n${lines.join('\n')}`,
            ephemeral: true,
        });
    }
}

export default {
    data,
    execute,
    startTwitchChecker,
};
