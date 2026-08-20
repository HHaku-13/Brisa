// streamNotifyService.js
// Suit les conventions de reactionRoleService.js : lit/écrit via client.db (KV store Postgres/mémoire)

import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { getStreamNotifyKey, getStreamNotifyPrefix } from '../utils/database/keys.js';

function validateGuildId(guildId) {
    if (!guildId || typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) {
        throw createError(
            `Invalid guild ID: ${guildId}`,
            ErrorTypes.VALIDATION,
            'Invalid server ID provided.',
            { guildId },
        );
    }
}

function unwrap(data) {
    if (data && typeof data === 'object' && 'value' in data) {
        return data.value;
    }
    return data;
}

/** Retourne tous les streamers suivis sur un serveur */
export async function getAllStreamNotifies(client, guildId) {
    validateGuildId(guildId);
    const prefix = getStreamNotifyPrefix(guildId);

    let keys;
    try {
        keys = await client.db.list(prefix);
        if (keys && !Array.isArray(keys) && Array.isArray(keys.value)) {
            keys = keys.value;
        }
    } catch (error) {
        logger.error(`Error listing streamnotify keys for guild ${guildId}:`, error);
        throw createError(
            'Database error listing stream notifications',
            ErrorTypes.DATABASE,
            'Failed to retrieve the list of tracked streamers. Please try again.',
            { guildId, originalError: error.message },
        );
    }

    if (!keys || keys.length === 0) return [];

    const entries = [];
    for (const key of keys) {
        try {
            const data = unwrap(await client.db.get(key));
            if (data && data.twitchUsername) entries.push(data);
        } catch (error) {
            logger.warn(`Error reading streamnotify key ${key}:`, error);
        }
    }

    return entries.sort((a, b) => a.twitchUsername.localeCompare(b.twitchUsername));
}

/** Retourne un streamer suivi précis */
export async function getStreamNotify(client, guildId, twitchUsername) {
    validateGuildId(guildId);
    const key = getStreamNotifyKey(guildId, twitchUsername);
    return unwrap(await client.db.get(key));
}

/** Ajoute ou met à jour un streamer suivi */
export async function upsertStreamNotify(client, guildId, twitchUsername, updates = {}) {
    validateGuildId(guildId);
    const key = getStreamNotifyKey(guildId, twitchUsername);
    const existing = (await getStreamNotify(client, guildId, twitchUsername)) || {
        guildId,
        twitchUsername: String(twitchUsername).toLowerCase(),
        messageContent:
            '**[{{display_name}}](https://twitch.tv/{{username}})** est en live sur Twitch ! Go soutenir 🎥',
        embedTitle: null,
        embedDescription: null,
        embedThumbnail: null,
        embedColor: '#9146FF',
        embedFooterText: null,
        embedFooterIcon: null,
        isLive: false,
        lastStreamId: null,
        createdAt: new Date().toISOString(),
    };

    const merged = { ...existing, ...updates };
    await client.db.set(key, merged);
    return merged;
}

/** Retire un streamer suivi */
export async function removeStreamNotify(client, guildId, twitchUsername) {
    validateGuildId(guildId);
    const key = getStreamNotifyKey(guildId, twitchUsername);
    const existing = await getStreamNotify(client, guildId, twitchUsername);
    if (!existing) return false;
    await client.db.delete(key);
    return true;
}
