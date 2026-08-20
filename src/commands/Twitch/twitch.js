
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType
} from 'discord.js';
import axios from 'axios';

const configurations = new Map();

/*
 * Configuration par défaut
 */
function getConfig(guildId) {
    if (!configurations.has(guildId)) {
        configurations.set(guildId, {
            channelId: null,
            streamers: [],
            image: null,
            thumbnail: null,
            color: '#9146FF',
            message: '🔴 **{streamer} est en live !**',
            online: new Map()
        });
    }

    return configurations.get(guildId);
}

/*
 * Twitch OAuth
 */
async function getTwitchToken() {
    const response = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }
        }
    );

    return response.data.access_token;
}

/*
 * Recherche un streamer Twitch
 */
async function getStreamer(username) {
    const token = await getTwitchToken();

    const response = await axios.get(
        'https://api.twitch.tv/helix/streams',
        {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                Authorization: `Bearer ${token}`
            },
            params: {
                user_login: username
            }
        }
    );

    return response.data.data[0] || null;
}

/*
 * Vérification des streams
 */
async function checkStreams(client) {
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
        return;
    }

    for (const [guildId, config] of configurations) {
        if (!config.channelId || config.streamers.length === 0) {
            continue;
        }

        const channel = await client.channels
            .fetch(config.channelId)
            .catch(() => null);

        if (!channel) {
            continue;
        }

        for (const streamer of config.streamers) {
            try {
                const stream = await getStreamer(streamer);

                const wasOnline = config.online.get(streamer) || false;
                const isOnline = Boolean(stream);

                config.online.set(streamer, isOnline);

                // Pas encore en live
                if (!isOnline) {
                    continue;
                }

                // Déjà notifié
                if (wasOnline) {
                    continue;
                }

                const embed = new EmbedBuilder()
                    .setColor(config.color)
                    .setTitle(`🔴 ${stream.user_name} est en live !`)
                    .setURL(`https://twitch.tv/${stream.user_login}`)
                    .setDescription(
                        stream.title || 'Aucun titre'
                    )
                    .addFields(
                        {
                            name: '🎮 Jeu',
                            value: stream.game_name || 'Inconnu',
                            inline: true
                        },
                        {
                            name: '👥 Spectateurs',
                            value: `${stream.viewer_count}`,
                            inline: true
                        }
                    )
                    .setTimestamp();

                /*
                 * Image personnalisée
                 */
                if (config.image) {
                    embed.setImage(config.image);
                }

                /*
                 * Thumbnail personnalisée
                 */
                if (config.thumbnail) {
                    embed.setThumbnail(config.thumbnail);
                } else if (stream.thumbnail_url) {
                    embed.setThumbnail(
                        stream.thumbnail_url
                            .replace('{width}', '320')
                            .replace('{height}', '180')
                    );
                }

                /*
                 * Message personnalisé
                 */
                const message = config.message
                    .replaceAll('{streamer}', stream.user_name)
                    .replaceAll('{game}', stream.game_name || 'Inconnu')
                    .replaceAll('{title}', stream.title || '');

                await channel.send({
                    content: `${message}\nhttps://twitch.tv/${stream.user_login}`,
                    embeds: [embed]
                });

            } catch (error) {
                console.error(
                    `[TWITCH] Erreur avec ${streamer}:`,
                    error.message
                );
            }
        }
    }
}

/*
 * Surveillance Twitch toutes les 60 secondes
 */
let checkerStarted = false;

function startTwitchChecker(client) {
    if (checkerStarted) {
        return;
    }

    checkerStarted = true;

    setInterval(() => {
        checkStreams(client);
    }, 60_000);

    console.log('[TWITCH] Surveillance Twitch activée.');
}

export default {
    data: new SlashCommandBuilder()
        .setName('twitch')
        .setDescription('Gérer les notifications Twitch')
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild.toString()
        )

        /*
         * STREAMER
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('ajouter')
                .setDescription('Ajouter un streamer Twitch')
                .addStringOption(option =>
                    option
                        .setName('streamer')
                        .setDescription('Nom Twitch du streamer')
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('supprimer')
                .setDescription('Supprimer un streamer Twitch')
                .addStringOption(option =>
                    option
                        .setName('streamer')
                        .setDescription('Nom Twitch du streamer')
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('liste')
                .setDescription('Afficher les streamers configurés')
        )

        /*
         * SALON
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('salon')
                .setDescription('Définir le salon des notifications')
                .addChannelOption(option =>
                    option
                        .setName('salon')
                        .setDescription('Salon où envoyer les notifications')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )

        /*
         * IMAGE
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('image')
                .setDescription('Modifier l'image principale')
                .addStringOption(option =>
                    option
                        .setName('url')
                        .setDescription('URL de l’image')
                        .setRequired(true)
                )
        )

        /*
         * THUMBNAIL
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('thumbnail')
                .setDescription('Modifier la miniature')
                .addStringOption(option =>
                    option
                        .setName('url')
                        .setDescription('URL de la miniature')
                        .setRequired(true)
                )
        )

        /*
         * COULEUR
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('couleur')
                .setDescription('Modifier la couleur de l’embed')
                .addStringOption(option =>
                    option
                        .setName('hex')
                        .setDescription('Exemple : #9146FF')
                        .setRequired(true)
                )
        )

        /*
         * MESSAGE
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('Modifier le message de notification')
                .addStringOption(option =>
                    option
                        .setName('texte')
                        .setDescription(
                            'Utilisez {streamer}, {game} et {title}'
                        )
                        .setRequired(true)
                )
        )

        /*
         * CONFIG
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('config')
                .setDescription('Afficher la configuration Twitch')
        )

        /*
         * TEST
         */
        .addSubcommand(subcommand =>
            subcommand
                .setName('test')
                .setDescription('Tester la notification Twitch')
        ),

    async execute(interaction) {
        const config = getConfig(interaction.guild.id);
        const subcommand = interaction.options.getSubcommand();

        /*
         * Ajouter streamer
         */
        if (subcommand === 'ajouter') {
            const streamer = interaction.options
                .getString('streamer')
                .toLowerCase()
                .trim();

            if (config.streamers.includes(streamer)) {
                return interaction.reply({
                    content: `❌ **${streamer}** est déjà configuré.`,
                    ephemeral: true
                });
            }

            config.streamers.push(streamer);

            return interaction.reply({
                content: `✅ **${streamer}** a été ajouté aux notifications Twitch.`,
                ephemeral: true
            });
        }

        /*
         * Supprimer streamer
         */
        if (subcommand === 'supprimer') {
            const streamer = interaction.options
                .getString('streamer')
                .toLowerCase()
                .trim();

            const index = config.streamers.indexOf(streamer);

            if (index === -1) {
                return interaction.reply({
                    content: `❌ **${streamer}** n'est pas configuré.`,
                    ephemeral: true
                });
            }

            config.streamers.splice(index, 1);
            config.online.delete(streamer);

            return interaction.reply({
                content: `✅ **${streamer}** a été supprimé.`,
                ephemeral: true
            });
        }

        /*
         * Liste
         */
        if (subcommand === 'liste') {
            if (config.streamers.length === 0) {
                return interaction.reply({
                    content: '📺 Aucun streamer Twitch configuré.',
                    ephemeral: true
                });
            }

            return interaction.reply({
                content:
                    `📺 **Streamers surveillés :**\n\n` +
                    config.streamers
                        .map(streamer => `• **${streamer}**`)
                        .join('\n'),
                ephemeral: true
            });
        }

        /*
         * Salon
         */
        if (subcommand === 'salon') {
            const channel = interaction.options.getChannel('salon');

            config.channelId = channel.id;

            return interaction.reply({
                content:
                    `✅ Les notifications Twitch seront envoyées dans ${channel}.`,
                ephemeral: true
            });
        }

        /*
         * Image
         */
        if (subcommand === 'image') {
            const url = interaction.options.getString('url');

            try {
                new URL(url);
            } catch {
                return interaction.reply({
                    content: '❌ URL invalide.',
                    ephemeral: true
                });
            }

            config.image = url;

            return interaction.reply({
                content: '✅ Image personnalisée enregistrée.',
                ephemeral: true
            });
        }

        /*
         * Thumbnail
         */
        if (subcommand === 'thumbnail') {
            const url = interaction.options.getString('url');

            try {
                new URL(url);
            } catch {
                return interaction.reply({
                    content: '❌ URL invalide.',
                    ephemeral: true
                });
            }

            config.thumbnail = url;

            return interaction.reply({
                content: '✅ Thumbnail personnalisée enregistrée.',
                ephemeral: true
            });
        }

        /*
         * Couleur
         */
        if (subcommand === 'couleur') {
            const color = interaction.options
                .getString('hex')
                .trim();

            if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
                return interaction.reply({
                    content:
                        '❌ Couleur invalide. Exemple : `#9146FF`',
                    ephemeral: true
                });
            }

            config.color = color;

            return interaction.reply({
                content: `✅ Couleur définie sur **${color}**.`,
                ephemeral: true
            });
        }

        /*
         * Message
         */
        if (subcommand === 'message') {
            const message = interaction.options.getString('texte');

            config.message = message;

            return interaction.reply({
                content:
                    '✅ Message personnalisé enregistré.\n\n' +
                    'Variables disponibles : `{streamer}`, `{game}`, `{title}`',
                ephemeral: true
            });
        }

        /*
         * Configuration
         */
        if (subcommand === 'config') {
            const embed = new EmbedBuilder()
                .setColor(config.color)
                .setTitle('⚙️ Configuration Twitch')
                .addFields(
                    {
                        name: '📺 Salon',
                        value: config.channelId
                            ? `<#${config.channelId}>`
                            : '❌ Non configuré',
                        inline: true
                    },
                    {
                        name: '👥 Streamers',
                        value: config.streamers.length
                            ? config.streamers.join(', ')
                            : 'Aucun',
                        inline: true
                    },
                    {
                        name: '🎨 Couleur',
                        value: config.color,
                        inline: true
                    },
                    {
                        name: '🖼️ Image',
                        value: config.image
                            ? '✅ Personnalisée'
                            : '❌ Aucune',
                        inline: true
                    },
                    {
                        name: '🔹 Thumbnail',
                        value: config.thumbnail
                            ? '✅ Personnalisée'
                            : '❌ Automatique Twitch',
                        inline: true
                    },
                    {
                        name: '💬 Message',
                        value: config.message,
                        inline: false
                    }
                );

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }

        /*
         * Test
         */
        if (subcommand === 'test') {
            if (!config.channelId) {
                return interaction.reply({
                    content:
                        '❌ Configure d’abord un salon avec `/twitch salon`.',
                    ephemeral: true
                });
            }

            const channel = await interaction.client.channels
                .fetch(config.channelId)
                .catch(() => null);

            if (!channel) {
                return interaction.reply({
                    content: '❌ Salon introuvable.',
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setColor(config.color)
                .setTitle('🔴 Test Twitch')
                .setDescription(
                    'Ceci est une notification Twitch de test.'
                )
                .addFields(
                    {
                        name: '🎮 Jeu',
                        value: 'Fortnite',
                        inline: true
                    },
                    {
                        name: '👥 Spectateurs',
                        value: '1234',
                        inline: true
                    }
                )
                .setURL('https://twitch.tv/');

            if (config.image) {
                embed.setImage(config.image);
            }

            if (config.thumbnail) {
                embed.setThumbnail(config.thumbnail);
            }

            await channel.send({
                content: config.message
                    .replaceAll('{streamer}', 'TestStreamer')
                    .replaceAll('{game}', 'Fortnite')
                    .replaceAll('{title}', 'Mon live de test'),
                embeds: [embed]
            });

            return interaction.reply({
                content: `✅ Notification de test envoyée dans ${channel}.`,
                ephemeral: true
            });
        }
    },

    /*
     * Permet au bot de démarrer la surveillance.
     */
    startTwitchChecker
};
