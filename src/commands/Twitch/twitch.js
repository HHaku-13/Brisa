import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType
} from 'discord.js';
import axios from 'axios';

const TWITCH_API = 'https://api.twitch.tv/helix';
const TWITCH_OAUTH = 'https://id.twitch.tv/oauth2/token';

const CONFIG_PREFIX = 'guild:';
const CONFIG_SUFFIX = ':twitch';

let twitchToken = null;
let twitchTokenExpiresAt = 0;
let checkerStarted = false;

/**
 * ============================================================
 * CONFIGURATION
 * ============================================================
 */

function getDefaultConfig() {
    return {
        enabled: true,
        channelId: null,

        streamers: [],

        image: null,
        thumbnail: null,

        color: '#9146FF',

        message: '🔴 **{streamer} est en live !**',

        // Permet d'éviter les notifications répétées
        liveState: {}
    };
}

function getConfigKey(guildId) {
    return `${CONFIG_PREFIX}${guildId}${CONFIG_SUFFIX}`;
}

function normalizeConfig(config) {
    const defaults = getDefaultConfig();

    if (!config || typeof config !== 'object') {
        return defaults;
    }

    return {
        ...defaults,
        ...config,

        streamers: Array.isArray(config.streamers)
            ? config.streamers
            : [],

        liveState:
            config.liveState &&
            typeof config.liveState === 'object'
                ? config.liveState
                : {}
    };
}

async function getConfig(client, guildId) {
    if (!client?.db || typeof client.db.get !== 'function') {
        return getDefaultConfig();
    }

    try {
        const config = await client.db.get(
            getConfigKey(guildId),
            getDefaultConfig()
        );

        return normalizeConfig(config);
    } catch (error) {
        console.error(
            `[TWITCH] Impossible de récupérer la configuration de ${guildId}:`,
            error
        );

        return getDefaultConfig();
    }
}

async function saveConfig(client, guildId, config) {
    if (!client?.db || typeof client.db.set !== 'function') {
        return false;
    }

    try {
        await client.db.set(
            getConfigKey(guildId),
            normalizeConfig(config)
        );

        return true;
    } catch (error) {
        console.error(
            `[TWITCH] Impossible de sauvegarder la configuration de ${guildId}:`,
            error
        );

        return false;
    }
}

/**
 * ============================================================
 * TWITCH API
 * ============================================================
 */

async function getTwitchToken() {
    const now = Date.now();

    if (
        twitchToken &&
        now < twitchTokenExpiresAt
    ) {
        return twitchToken;
    }

    if (
        !process.env.TWITCH_CLIENT_ID ||
        !process.env.TWITCH_CLIENT_SECRET
    ) {
        throw new Error(
            'TWITCH_CLIENT_ID ou TWITCH_CLIENT_SECRET manquant dans .env'
        );
    }

    const response = await axios.post(
        TWITCH_OAUTH,
        null,
        {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }
        }
    );

    twitchToken = response.data.access_token;

    // On garde une marge de sécurité de 60 secondes.
    twitchTokenExpiresAt =
        now + ((response.data.expires_in - 60) * 1000);

    return twitchToken;
}

async function twitchRequest(endpoint, params = {}) {
    const token = await getTwitchToken();

    try {
        return await axios.get(
            `${TWITCH_API}/${endpoint}`,
            {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    Authorization: `Bearer ${token}`
                },
                params
            }
        );
    } catch (error) {
        // Token expiré : on le renouvelle une fois.
        if (error.response?.status === 401) {
            twitchToken = null;
            twitchTokenExpiresAt = 0;

            const newToken = await getTwitchToken();

            return axios.get(
                `${TWITCH_API}/${endpoint}`,
                {
                    headers: {
                        'Client-ID': process.env.TWITCH_CLIENT_ID,
                        Authorization: `Bearer ${newToken}`
                    },
                    params
                }
            );
        }

        throw error;
    }
}

async function getStream(username) {
    const response = await twitchRequest(
        'streams',
        {
            user_login: username
        }
    );

    return response.data?.data?.[0] || null;
}

/**
 * ============================================================
 * EMBED
 * ============================================================
 */

function buildNotificationEmbed(stream, config) {
    const embed = new EmbedBuilder()
        .setColor(config.color || '#9146FF')
        .setTitle(
            `🔴 ${stream.user_name} est en live !`
        )
        .setURL(
            `https://twitch.tv/${stream.user_login}`
        )
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
                value: String(stream.viewer_count || 0),
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
     * Thumbnail personnalisée.
     *
     * Si aucune thumbnail personnalisée n'est définie,
     * on utilise automatiquement celle de Twitch.
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

    return embed;
}

function buildNotificationMessage(stream, config) {
    return (config.message || '')
        .replaceAll(
            '{streamer}',
            stream.user_name || ''
        )
        .replaceAll(
            '{game}',
            stream.game_name || 'Inconnu'
        )
        .replaceAll(
            '{title}',
            stream.title || ''
        );
}

/**
 * ============================================================
 * SURVEILLANCE TWITCH
 * ============================================================
 */

async function checkGuild(client, guild) {
    const config = await getConfig(
        client,
        guild.id
    );

    if (!config.enabled) {
        return;
    }

    if (!config.channelId) {
        return;
    }

    if (!config.streamers.length) {
        return;
    }

    const channel = await client.channels
        .fetch(config.channelId)
        .catch(() => null);

    if (!channel) {
        return;
    }

    let configChanged = false;

    for (const streamer of config.streamers) {
        try {
            const username = streamer
                .toLowerCase()
                .trim();

            const stream = await getStream(username);

            const isLive = Boolean(stream);

            /*
             * État précédent.
             *
             * null = jamais vérifié
             */
            const previousState =
                config.liveState[username];

            /*
             * Première vérification après configuration/
             * redémarrage : on enregistre simplement l'état.
             *
             * Cela évite d'envoyer une notification immédiatement
             * lorsque le bot redémarre alors que le streamer est
             * déjà en live.
             */
            if (previousState === undefined) {
                config.liveState[username] = isLive;
                configChanged = true;
                continue;
            }

            /*
             * Passage OFFLINE -> LIVE
             */
            if (isLive && previousState === false) {
                const embed =
                    buildNotificationEmbed(
                        stream,
                        config
                    );

                const message =
                    buildNotificationMessage(
                        stream,
                        config
                    );

                await channel.send({
                    content:
                        `${message}\n` +
                        `https://twitch.tv/${stream.user_login}`,

                    embeds: [embed]
                });

                console.log(
                    `[TWITCH] Notification envoyée pour ${username} dans ${guild.name}`
                );
            }

            /*
             * Mise à jour de l'état
             */
            if (previousState !== isLive) {
                config.liveState[username] = isLive;
                configChanged = true;
            }

        } catch (error) {
            console.error(
                `[TWITCH] Erreur avec ${streamer} dans ${guild.name}:`,
                error.response?.data || error.message
            );
        }
    }

    if (configChanged) {
        await saveConfig(
            client,
            guild.id,
            config
        );
    }
}

async function checkAllGuilds(client) {
    if (
        !process.env.TWITCH_CLIENT_ID ||
        !process.env.TWITCH_CLIENT_SECRET
    ) {
        return;
    }

    for (const guild of client.guilds.cache.values()) {
        try {
            await checkGuild(
                client,
                guild
            );
        } catch (error) {
            console.error(
                `[TWITCH] Erreur serveur ${guild.id}:`,
                error
            );
        }
    }
}

/**
 * Lance la surveillance toutes les 60 secondes.
 */
export function startTwitchChecker(client) {
    if (checkerStarted) {
        return;
    }

    checkerStarted = true;

    console.log(
        '[TWITCH] Surveillance Twitch démarrée.'
    );

    /*
     * Première vérification après 10 secondes.
     */
    setTimeout(() => {
        checkAllGuilds(client);
    }, 10_000);

    /*
     * Puis toutes les 60 secondes.
     */
    setInterval(() => {
        checkAllGuilds(client);
    }, 60_000);
}

/**
 * ============================================================
 * COMMANDES DISCORD
 * ============================================================
 */

const streamerGroup =
    new SlashCommandBuilder()
        .setName('twitch')
        .setDescription(
            'Gérer les notifications Twitch'
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild.toString()
        )
        .addSubcommandGroup(group =>
            group
                .setName('streamer')
                .setDescription(
                    'Gérer les streamers Twitch'
                )

                .addSubcommand(subcommand =>
                    subcommand
                        .setName('ajouter')
                        .setDescription(
                            'Ajouter un streamer Twitch'
                        )
                        .addStringOption(option =>
                            option
                                .setName('nom')
                                .setDescription(
                                    'Nom Twitch du streamer'
                                )
                                .setRequired(true)
                        )
                )

                .addSubcommand(subcommand =>
                    subcommand
                        .setName('supprimer')
                        .setDescription(
                            'Supprimer un streamer Twitch'
                        )
                        .addStringOption(option =>
                            option
                                .setName('nom')
                                .setDescription(
                                    'Nom Twitch du streamer'
                                )
                                .setRequired(true)
                        )
                )

                .addSubcommand(subcommand =>
                    subcommand
                        .setName('liste')
                        .setDescription(
                            'Afficher les streamers'
                        )
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('salon')
                .setDescription(
                    'Définir le salon des notifications'
                )
                .addChannelOption(option =>
                    option
                        .setName('salon')
                        .setDescription(
                            'Salon Discord'
                        )
                        .addChannelTypes(
                            ChannelType.GuildText
                        )
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('image')
                .setDescription(
                    'Définir l image principale'
                )
                .addStringOption(option =>
                    option
                        .setName('url')
                        .setDescription(
                            'URL de l image'
                        )
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('thumbnail')
                .setDescription(
                    'Définir la miniature'
                )
                .addStringOption(option =>
                    option
                        .setName('url')
                        .setDescription(
                            'URL de la miniature'
                        )
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('couleur')
                .setDescription(
                    'Définir la couleur'
                )
                .addStringOption(option =>
                    option
                        .setName('hex')
                        .setDescription(
                            'Exemple : #9146FF'
                        )
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription(
                    'Personnaliser le message'
                )
                .addStringOption(option =>
                    option
                        .setName('texte')
                        .setDescription(
                            '{streamer}, {game}, {title}'
                        )
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('config')
                .setDescription(
                    'Afficher la configuration'
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('test')
                .setDescription(
                    'Tester la notification'
                )
        );

/**
 * ============================================================
 * EXECUTE
 * ============================================================
 */

export default {
    data: streamerGroup,

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content:
                    '❌ Cette commande doit être utilisée sur un serveur.',
                ephemeral: true
            });
        }

        const guildId = interaction.guild.id;

        const config =
            await getConfig(
                interaction.client,
                guildId
            );

        const subcommand =
            interaction.options.getSubcommand();

        const group =
            interaction.options.getSubcommandGroup();

        /**
         * ----------------------------------------------------
         * /twitch streamer ajouter
         * ----------------------------------------------------
         */
        if (
            group === 'streamer' &&
            subcommand === 'ajouter'
        ) {
            const username =
                interaction.options
                    .getString('nom')
                    .trim()
                    .toLowerCase();

            if (
                config.streamers
                    .includes(username)
            ) {
                return interaction.reply({
                    content:
                        `❌ **${username}** est déjà surveillé.`,
                    ephemeral: true
                });
            }

            /*
             * Vérifie que le compte Twitch existe.
             */
            try {
                const response =
                    await twitchRequest(
                        'users',
                        {
                            login: username
                        }
                    );

                if (
                    !response.data?.data?.length
                ) {
                    return interaction.reply({
                        content:
                            `❌ Le streamer Twitch **${username}** n'existe pas.`,
                        ephemeral: true
                    });
                }
            } catch (error) {
                console.error(
                    '[TWITCH] Vérification streamer:',
                    error
                );

                return interaction.reply({
                    content:
                        '❌ Impossible de contacter Twitch actuellement.',
                    ephemeral: true
                });
            }

            config.streamers.push(
                username
            );

            /*
             * État initial inconnu.
             */
            delete config.liveState[
                username
            ];

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    `✅ **${username}** a été ajouté aux notifications Twitch.`,
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch streamer supprimer
         * ----------------------------------------------------
         */
        if (
            group === 'streamer' &&
            subcommand === 'supprimer'
        ) {
            const username =
                interaction.options
                    .getString('nom')
                    .trim()
                    .toLowerCase();

            const index =
                config.streamers
                    .indexOf(username);

            if (index === -1) {
                return interaction.reply({
                    content:
                        `❌ **${username}** n'est pas surveillé.`,
                    ephemeral: true
                });
            }

            config.streamers.splice(
                index,
                1
            );

            delete config.liveState[
                username
            ];

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    `✅ **${username}** a été supprimé.`,
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch streamer liste
         * ----------------------------------------------------
         */
        if (
            group === 'streamer' &&
            subcommand === 'liste'
        ) {
            if (
                config.streamers.length === 0
            ) {
                return interaction.reply({
                    content:
                        '📺 Aucun streamer Twitch configuré.',
                    ephemeral: true
                });
            }

            const list =
                config.streamers
                    .map(
                        streamer =>
                            `• **${streamer}**`
                    )
                    .join('\n');

            return interaction.reply({
                content:
                    `📺 **Streamers surveillés :**\n\n${list}`,
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch salon
         * ----------------------------------------------------
         */
        if (subcommand === 'salon') {
            const channel =
                interaction.options
                    .getChannel('salon');

            config.channelId =
                channel.id;

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    `✅ Les notifications seront envoyées dans ${channel}.`,
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch image
         * ----------------------------------------------------
         */
        if (subcommand === 'image') {
            const url =
                interaction.options
                    .getString('url')
                    .trim();

            if (!isValidUrl(url)) {
                return interaction.reply({
                    content:
                        '❌ URL invalide.',
                    ephemeral: true
                });
            }

            config.image = url;

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    '✅ Image principale configurée.',
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch thumbnail
         * ----------------------------------------------------
         */
        if (subcommand === 'thumbnail') {
            const url =
                interaction.options
                    .getString('url')
                    .trim();

            if (!isValidUrl(url)) {
                return interaction.reply({
                    content:
                        '❌ URL invalide.',
                    ephemeral: true
                });
            }

            config.thumbnail = url;

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    '✅ Thumbnail configurée.',
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch couleur
         * ----------------------------------------------------
         */
        if (subcommand === 'couleur') {
            const color =
                interaction.options
                    .getString('hex')
                    .trim();

            if (
                !/^#[0-9A-Fa-f]{6}$/.test(color)
            ) {
                return interaction.reply({
                    content:
                        '❌ Couleur invalide. Exemple : `#9146FF`',
                    ephemeral: true
                });
            }

            config.color = color;

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    `✅ Couleur définie sur **${color}**.`,
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch message
         * ----------------------------------------------------
         */
        if (subcommand === 'message') {
            const message =
                interaction.options
                    .getString('texte');

            config.message = message;

            await saveConfig(
                interaction.client,
                guildId,
                config
            );

            return interaction.reply({
                content:
                    '✅ Message personnalisé enregistré.\n\n' +
                    '**Variables disponibles :**\n' +
                    '`{streamer}` → nom du streamer\n' +
                    '`{game}` → jeu\n' +
                    '`{title}` → titre du live',
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch config
         * ----------------------------------------------------
         */
        if (subcommand === 'config') {
            const embed =
                new EmbedBuilder()
                    .setColor(
                        config.color
                    )
                    .setTitle(
                        '⚙️ Configuration Twitch'
                    )
                    .addFields(
                        {
                            name: '📺 Salon',
                            value:
                                config.channelId
                                    ? `<#${config.channelId}>`
                                    : '❌ Non configuré',
                            inline: true
                        },
                        {
                            name: '👥 Streamers',
                            value:
                                config.streamers.length
                                    ? config.streamers
                                        .map(
                                            s =>
                                                `\`${s}\``
                                        )
                                        .join(', ')
                                    : 'Aucun',
                            inline: true
                        },
                        {
                            name: '🎨 Couleur',
                            value:
                                config.color,
                            inline: true
                        },
                        {
                            name: '🖼️ Image',
                            value:
                                config.image
                                    ? '✅ Personnalisée'
                                    : '❌ Aucune',
                            inline: true
                        },
                        {
                            name: '🔹 Thumbnail',
                            value:
                                config.thumbnail
                                    ? '✅ Personnalisée'
                                    : '🟣 Twitch automatique',
                            inline: true
                        },
                        {
                            name: '💬 Message',
                            value:
                                config.message,
                            inline: false
                        }
                    );

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }

        /**
         * ----------------------------------------------------
         * /twitch test
         * ----------------------------------------------------
         */
        if (subcommand === 'test') {
            if (!config.channelId) {
                return interaction.reply({
                    content:
                        '❌ Configure d’abord un salon avec `/twitch salon`.',
                    ephemeral: true
                });
            }

            const channel =
                await interaction.client.channels
                    .fetch(
                        config.channelId
                    )
                    .catch(() => null);

            if (!channel) {
                return interaction.reply({
                    content:
                        '❌ Le salon configuré est introuvable.',
                    ephemeral: true
                });
            }

            const testStream = {
                user_name: 'TestStreamer',
                user_login: 'teststreamer',
                title: 'Mon live de test',
                game_name: 'Just Chatting',
                viewer_count: 1234
            };

            const embed =
                buildNotificationEmbed(
                    testStream,
                    config
                );

            const message =
                buildNotificationMessage(
                    testStream,
                    config
                );

            await channel.send({
                content:
                    `${message}\n` +
                    'https://twitch.tv/teststreamer',
                embeds: [embed]
            });

            return interaction.reply({
                content:
                    `✅ Notification de test envoyée dans ${channel}.`,
                ephemeral: true
            });
        }
    },

    startTwitchChecker
};

/**
 * ============================================================
 * UTILITAIRES
 * ============================================================
 */

function isValidUrl(value) {
    try {
        const url =
            new URL(value);

        return (
            url.protocol === 'http:' ||
            url.protocol === 'https:'
        );
    } catch {
        return false;
    }
}
