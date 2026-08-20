// twitchService.js
// Nécessite TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans .env
// -> à créer sur https://dev.twitch.tv/console/apps

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAppAccessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials',
        }),
    });

    if (!res.ok) {
        throw new Error(`Twitch auth failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
}

/**
 * Retourne une Map<username_lowercase, streamData|null> pour une liste de logins Twitch.
 */
export async function getStreamsStatus(usernames) {
    if (!usernames || usernames.length === 0) return new Map();

    const token = await getAppAccessToken();
    const params = new URLSearchParams();
    usernames.forEach((u) => params.append('user_login', u.toLowerCase()));

    const res = await fetch(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
        headers: {
            'Client-Id': process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        throw new Error(`Twitch API error: ${res.status} ${await res.text()}`);
    }

    const { data } = await res.json();
    const map = new Map();
    usernames.forEach((u) => map.set(u.toLowerCase(), null));
    data.forEach((stream) => map.set(stream.user_login.toLowerCase(), stream));

    return map;
}

/** Récupère les infos publiques (avatar, display_name) d'un compte Twitch.
 *  Retourne null uniquement si le compte n'existe vraiment pas.
 *  Relance l'erreur si c'est un problème d'auth/config, pour ne pas le confondre avec "compte introuvable".
 */
export async function getTwitchUserInfo(username) {
    const token = await getAppAccessToken(); // ne pas catch ici : une erreur d'auth doit remonter
    const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username.toLowerCase())}`, {
        headers: {
            'Client-Id': process.env.TWITCH_CLIENT_ID,
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        const error = new Error(`Twitch API error: ${res.status} ${body}`);
        error.twitchStatus = res.status;
        throw error;
    }

    const { data } = await res.json();
    return data[0] || null;
}
