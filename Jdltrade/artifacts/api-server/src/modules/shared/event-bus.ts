/**
 * JDL Intelligence Module Event Bus
 * Lightweight async pub/sub built on Node's EventEmitter.
 * Supports typed events, priority queuing, and delivery metrics.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { JDLEvent, EventType, EventPriority } from "./types.js";

type EventHandler<P = unknown> = (event: JDLEvent<P>) => void | Promise<void>;

interface Metrics {
  published: number;
  delivered: number;
  errors: number;
  byType: Record<string, number>;
}

class JDLEventBus {
  private readonly emitter = new EventEmitter();
  private readonly metrics: Metrics = { published: 0, delivered: 0, errors: 0, byType: {} };

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish<P>(
    source: string,
    type: EventType,
    payload: P,
    opts: { priority?: EventPriority; correlationId?: string; agentId?: string } = {}
  ): string {
    const event: JDLEvent<P> = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source,
      type,
      payload,
      priority: opts.priority ?? "normal",
      correlationId: opts.correlationId,
      agentId: opts.agentId,
    };

    this.metrics.published++;
    this.metrics.byType[type] = (this.metrics.byType[type] ?? 0) + 1;

    setImmediate(() => {
      try {
        this.emitter.emit(type, event);
        this.emitter.emit("*", event);
        this.metrics.delivered++;
      } catch (err: any) {
        this.metrics.errors++;
        console.error(`[EventBus] Delivery error on ${type}:`, err?.message);
      }
    });

    return event.id;
  }

  subscribe<P>(type: EventType | "*", handler: EventHandler<P>): () => void {
    const wrapped = async (event: JDLEvent<P>) => {
      try {
        await handler(event);
      } catch (err: any) {
        this.metrics.errors++;
        console.error(`[EventBus] Handler error on ${type}:`, err?.message);
      }
    };

    this.emitter.on(type, wrapped as EventHandler);
    return () => this.emitter.off(type, wrapped as EventHandler);
  }

  subscribeOnce<P>(type: EventType, handler: EventHandler<P>): void {
    const wrapped = async (event: JDLEvent<P>) => {
      try {
        await handler(event);
      } catch (err: any) {
        this.metrics.errors++;
      }
    };
    this.emitter.once(type, wrapped as EventHandler);
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }
}

export const eventBus = new JDLEventBus();
export type { EventHandler };
