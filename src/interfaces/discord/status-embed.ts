import { EmbedBuilder } from 'discord.js';
import type { TranslationSession } from '../../domain/translation-session';

/** "1h 2m" from an hour on, "2m 5s" below it. */
export function formatUptime(uptimeMs: number): string {
  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m ${seconds % 60}s`;
}

/** The status of a running session, as /translate-status shows it. */
export function statusEmbed(session: TranslationSession, uptimeMs: number, now: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('📊 Translation Status')
    .addFields(
      { name: 'Status', value: '✅ Active', inline: true },
      { name: 'Target Language', value: session.languages.displayName, inline: true },
      { name: 'Uptime', value: formatUptime(uptimeMs), inline: true },
      { name: 'Active Users', value: String(session.activeSpeakers.length), inline: true },
      { name: 'Voice Channel', value: `<#${session.voiceChannelId.value}>`, inline: true },
      { name: 'Text Channel', value: `<#${session.textChannelId.value}>`, inline: true }
    )
    .setTimestamp(now);
}
