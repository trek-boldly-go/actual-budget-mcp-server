import { type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { type EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * In-memory EventStore implementation for resumable SSE streams.
 * Keep it simple; swap for a persistent store in production.
 */
export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, { streamId: string, message: JSONRPCMessage }>();

  private generateEventId (streamId: string): string {
    return `${streamId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private getStreamIdFromEventId (eventId: string): string {
    const parts = eventId.split('_');
    return parts.length > 0 ? parts[0] : '';
  }

  async storeEvent (streamId: string, message: JSONRPCMessage): Promise<string> {
    const eventId = this.generateEventId(streamId);
    this.events.set(eventId, { streamId, message });
    return eventId;
  }

  async replayEventsAfter (
    lastEventId: string,
    { send }: { send: (eventId: string, message: JSONRPCMessage) => Promise<void> }
  ): Promise<string> {
    if (lastEventId.trim() === '' || !this.events.has(lastEventId)) {
      return '';
    }

    const streamId = this.getStreamIdFromEventId(lastEventId);
    if (streamId === '') {
      return '';
    }

    let foundLastEvent = false;
    const sortedEvents = [...this.events.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [eventId, { streamId: eventStreamId, message }] of sortedEvents) {
      if (eventStreamId !== streamId) {
        continue;
      }

      if (eventId === lastEventId) {
        foundLastEvent = true;
        continue;
      }

      if (foundLastEvent) {
        await send(eventId, message);
      }
    }
    return streamId;
  }
}
