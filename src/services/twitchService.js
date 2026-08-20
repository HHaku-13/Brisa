
import axios from 'axios';

const TWITCH_API_URL = 'https://api.twitch.tv/helix';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

// Vérification toutes les 60 secondes
const CHECK_INTERVAL = 60 * 1000;

let twitchAccessToken = null;
let tokenExpiresAt = 0;
let checkerInterval = null;

// Les chaînes configurées avec /twitch
// Map<guildId, Map<twitchLogin, { channelId, notified }>>
const watchedChannels = new Map();

/**
 * Récupère un App Access Token Twitch.
 */
async function getAccessToken() {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error(
            'TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET doivent être définis dans le fichier .env'
        );
    }

    // On garde le token tant qu'il est encore valide.
    if (twitchAccessToken && Date.now() < tokenExpiresAt - 60_000) {
        return twitchAccessToken;
    }

    try {
        const response = await axios.post(
            TWITCH_TOKEN_URL,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'client_credentials',
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 10_000,
            }
        );

        twitchAccessToken = response.data.access_token;
        tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);

        return twitchAccessToken;
    } catch (error) {
        console.error(
            '[TWITCH] Impossible de récupérer le token :',
            error.response?.data || error.message
        );

        throw new Error('Impossible de se connecter à Twitch.');
    }
}

/**
 * Effectue une requête vers l'API Twitch.
 */
async function twitchRequest(endpoint, params = {}) {
    const token = await getAccessToken();

    try {
        const response = await axios.get(`${TWITCH_API_URL}${endpoint}`, {
            params,
            headers: {
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                Authorization: `Bearer ${token}`,
            },
            timeout: 10_000,
        });

        return response.data;
    } catch (error) {
        // Si le token est invalide, on le supprime et on réessaiera
        // automatiquement à la prochaine requête.
        if (error.response?.status === 401) {
            twitchAccessToken = null;
            tokenExpiresAt = 0;
        }

        console.error(
            '[TWITCH] Erreur API :',
            error.response?.data || error.message
        );

        throw error;
    }
}

/**
 * Cherche une chaîne Twitch.
 */
export async function getTwitchUser(login) {
    const normalizedLogin = login
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
        .split('/')[0];

    if (!normalizedLogin) {
        return null;
    }

    const result = await twitchRequest('/users', {
        login: normalizedLogin,
    });

    return result.data?.[0] || null;
}

/**
 * Vérifie si une chaîne est actuellement en live.
 */
export async function getTwitchStream(login) {
    const result = await twitchRequest('/streams', {
        user_login: login,
    });

    return result.data?.[0] || null;
}

/**
 * Ajoute une chaîne à surveiller.
 */
export function addWatchedChannel(guildId, twitchLogin, discordChannelId) {
    if (!watchedChannels.has(guildId)) {
        watchedChannels.set(guildId, new Map());
    }

    const guildChannels = watchedChannels.get(guildId);

    guildChannels.set(twitchLogin.toLowerCase(), {
        channelId: discordChannelId,
        notified: false,
    });
}

/**
 * Supprime une chaîne de la surveillance.
 */
export function removeWatchedChannel(guildId, twitchLogin) {
    const guildChannels = watchedChannels.get(guildId);

    if (!guildChannels) {
        return false;
    }

    const deleted = guildChannels.delete(twitchLogin.toLowerCase());

    if (guildChannels.size === 0) {
        watchedChannels.delete(guildId);
    }

    return deleted;
}

/**
 * Récupère les chaînes surveillées d'un serveur.
 */
export function getWatchedChannels(guildId) {
    const guildChannels = watchedChannels.get(guildId);

    if (!guildChannels) {
        return [];
    }

    return Array.from(guildChannels.entries()).map(([login, config]) => ({
        login,
        channelId: config.channelId,
        notified: config.notified,
    }));
}

/**
 * Vérifie toutes les chaînes surveillées.
 */
async function checkWatchedChannels(client) {
    for (const [guildId, guildChannels] of watchedChannels.entries()) {
        const guild = client.guilds.cache.get(guildId);

        if (!guild) {
            continue;
        }

        for (const [login, config] of guildChannels.entries()) {
            try {
                const stream = await getTwitchStream(login);

                const discordChannel = guild.channels.cache.get(config.channelId);

                if (!discordChannel) {
                    console.warn(
                        `[TWITCH] Salon Discord introuvable pour ${login} (${config.channelId})`
                    );
                    continue;
                }

                // La chaîne est EN LIVE
                if (stream) {
                    // On n'envoie la notification qu'une seule fois.
                    if (!config.notified) {
                        config.notified = true;

                        const twitchUrl = `https://twitch.tv/${login}`;

                        await discordChannel.send(
                            `🔴 **${stream.user_name} est en live sur Twitch !**\n` +
                            `🎮 **${stream.game_name || 'Jeu non renseigné'}**\n` +
                            `📺 ${stream.title || 'Sans titre'}\n` +
                            `👉 ${twitchUrl}`
                        );

                        console.log(
                            `[TWITCH] Notification envoyée pour ${login}`
                        );
                    }
                } else {
                    // La chaîne est hors ligne.
                    // On remet notified à false afin qu'une prochaine
                    // session live déclenche une nouvelle notification.
                    if (config.notified) {
                        config.notified = false;

                        console.log(
                            `[TWITCH] ${login} est maintenant hors ligne`
                        );
                    }
                }
            } catch (error) {
                console.error(
                    `[TWITCH] Erreur pendant la vérification de ${login}:`,
                    error.response?.data || error.message
                );
            }
        }
    }
}

/**
 * Lance le système de surveillance Twitch.
 */
export function startTwitchChecker(client) {
    if (checkerInterval) {
        console.log('[TWITCH] Le checker est déjà lancé.');
        return;
    }

    console.log('[TWITCH] Démarrage du checker Twitch...');

    // Première vérification après le démarrage.
    setTimeout(() => {
        checkWatchedChannels(client).catch((error) => {
            console.error(
                '[TWITCH] Erreur lors de la vérification initiale:',
                error
            );
        });
    }, 5_000);

    checkerInterval = setInterval(() => {
        checkWatchedChannels(client).catch((error) => {
            console.error(
                '[TWITCH] Erreur du checker:',
                error
            );
        });
    }, CHECK_INTERVAL);
}

/**
 * Arrête le checker Twitch.
 */
export function stopTwitchChecker() {
    if (checkerInterval) {
        clearInterval(checkerInterval);
        checkerInterval = null;
    }

    console.log('[TWITCH] Checker Twitch arrêté.');
}
