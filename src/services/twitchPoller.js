// twitchPoller.js
// À appeler depuis src/app.js -> setupCronJobs(), voir INTEGRATION.md

import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { getAllStreamNotifies, upsertStreamNotify } from './streamNotifyService.js';
import { getStreamsStatus } from './twitchService.js';

function fillTemplate(template, stream, username, displayName) {
    return (template || '')
        .replaceAll('{{username}}', username)
        .replaceAll('{{display_name}}', displayName || username)
        .replaceAll('{{url}}', `https://twitch.tv/${username}`)
        .replaceAll('{{title}}', stream?.title || '')
        .replaceAll('{{game}}', stream?.game_name || '');
}

/** Parcourt tous les serveurs connus du bot et notifie les nouveaux lives Twitch. */
export async function checkStreamNotifies(client) {
    if (!client.db) {
        logger.warn('Database not available for streamnotify check');
        return;
    }

    for (const [guildId] of client.guilds.cache) {
        let entries;
        try {
            entries = await getAllStreamNotifies(client, guildId);
        } catch (error) {
            logger.error(`Error fetching streamnotify entries for guild ${guildId}:`, error);
            continue;
        }

        if (entries.length === 0) continue;

        const usernames = entries.map((e) => e.twitchUsername);
        let statusMap;
        try {
            statusMap = await getStreamsStatus(usernames);
        } catch (error) {
            logger.error('Error fetching Twitch stream status:', error);
            return; // rate-limit friendly : on retentera au prochain tick pour tout le monde
        }

        for (const entry of entries) {
            const stream = statusMap.get(entry.twitchUsername.toLowerCase());
            const isLiveNow = Boolean(stream);

            if (isLiveNow && !entry.isLive) {
                const channel = await client.channels.fetch(entry.channelId).catch(() => null);

                if (channel) {
                    const content = fillTemplate(entry.messageContent, stream, entry.twitchUsername, entry.displayName);
                    const hasEmbedContent = entry.embedTitle || entry.embedDescription || entry.embedThumbnail;

                    const embed = hasEmbedContent
                        ? createEmbed({
                              title: entry.embedTitle ? fillTemplate(entry.embedTitle, stream, entry.twitchUsername, entry.displayName) : undefined,
                              description: entry.embedDescription
                                  ? fillTemplate(entry.embedDescription, stream, entry.twitchUsername, entry.displayName)
                                  : undefined,
                              image: entry.embedThumbnail || undefined,
                              footer: entry.embedFooterText ? { text: entry.embedFooterText, iconURL: entry.embedFooterIcon || undefined } : undefined,
                              color: entry.embedColor || '#9146FF',
                              url: `https://twitch.tv/${entry.twitchUsername}`,
                          })
                        : null;

                    await channel
                        .send({ content, embeds: embed ? [embed] : [] })
                        .catch((error) => logger.error(`Error sending streamnotify message in guild ${guildId}:`, error));
                }

                await upsertStreamNotify(client, guildId, entry.twitchUsername, {
                    isLive: true,
                    lastStreamId: stream.id,
                });
            }

            if (!isLiveNow && entry.isLive) {
                await upsertStreamNotify(client, guildId, entry.twitchUsername, { isLive: false });
            }
        }
    }
}
