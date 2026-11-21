import type { Client, Room } from '@colyseus/core';

import { type MuteBook, type RateLimiter, moderateText } from './moderation.js';

/**
 * Chat moderado de uma sala (bairro ou interior): limite de 1 mensagem por
 * segundo, link recusado, palavrão mascarado, silêncio depois de 3 violações e
 * denúncia por 3 jogadores diferentes (doc 10).
 */
export function registerChat(
  room: Room,
  opts: {
    mutes: MuteBook;
    log: (event: string, data: Record<string, unknown>) => void;
    chats: RateLimiter;
    accounts: Map<string, string>;
    nameOf: (sessionId: string) => string | undefined;
  },
) {
  const { mutes, log, chats, accounts, nameOf } = opts;
  room.onMessage('chat', (client: Client, msg: { text?: unknown }) => {
    const name = nameOf(client.sessionId);
    const account = accounts.get(client.sessionId);
    if (name === undefined || !account) return;
    const muted = mutes.isMuted(account);
    if (muted) return client.send('chat_error', { reason: 'muted', until: new Date(muted).toISOString() });
    if (!chats.take(client.sessionId)) return client.send('chat_error', { reason: 'too_fast' });

    const r = moderateText(typeof msg?.text === 'string' ? msg.text : '');
    if (!r.ok) {
      const until = r.reason === 'link' ? mutes.violation(account) : 0;
      log('chat.blocked', { account, reason: r.reason, room: room.roomId, muted: until > 0 });
      return client.send('chat_error', { reason: r.reason, ...(until ? { muted_until: new Date(until).toISOString() } : {}) });
    }
    if (r.masked) {
      const until = mutes.violation(account);
      log('chat.masked', { account, room: room.roomId, muted: until > 0 });
    }
    room.broadcast('chat', { from: client.sessionId, name, text: r.text, at: new Date().toISOString() });
  });

  room.onMessage('report', (client: Client, msg: { sessionId?: unknown; reason?: unknown }) => {
    const by = accounts.get(client.sessionId);
    const target = typeof msg?.sessionId === 'string' ? accounts.get(msg.sessionId) : undefined;
    if (!by || !target) return;
    const until = mutes.report(target, by);
    log('chat.report', { by, target, room: room.roomId, reason: String(msg?.reason ?? '').slice(0, 100), muted: until > 0 });
    client.send('report_ok', {});
  });
}
