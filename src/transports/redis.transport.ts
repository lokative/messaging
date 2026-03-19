import { Inject, Injectable } from '@nestjs/common';
import type { MessagingTransport, MessageEnvelope, Subscription, SubscribeOptions } from '../transport.interface';
import type { MessagingConfig } from '../messaging.config';
import { createClient, type RedisClientType } from 'redis';

export interface RedisTransportOptions {
    url?: string
    host?: string
    port?: number
}

@Injectable()
export class RedisTransport implements MessagingTransport {

    private pub: RedisClientType;
    private sub: RedisClientType;

    constructor(@Inject('MSG_CONFIG') private config: MessagingConfig<RedisTransportOptions>) { }

    async connect() {
        const opts = this.config.transportOptions as RedisTransportOptions;
        const url = opts.url ?? `redis://${opts.host ?? 'localhost'}:${opts.port ?? 6379}`;

        this.pub = createClient({ url }) as RedisClientType;
        this.sub = this.pub.duplicate() as RedisClientType;

        await this.pub.connect();
        await this.sub.connect();
    }

    async publish(subject: string, payload: any): Promise<void> {
        await this.pub.publish(subject, JSON.stringify(payload));
    }

    async subscribe(subject: string, _options?: SubscribeOptions): Promise<Subscription> {
        const buffer: MessageEnvelope[] = [];
        let waiting: ((value: IteratorResult<MessageEnvelope>) => void) | null = null;

        await this.sub.subscribe(subject, (message, channel) => {
            let data: any;
            try {
                data = JSON.parse(message);
            } catch {
                data = message;
            }
            const envelope: MessageEnvelope = {
                subject: channel,
                data,
                ack: () => { },   // redis pub/sub has no ack mechanism
                nak: () => { },
            };

            if (waiting) {
                const resolve = waiting;
                waiting = null;
                resolve({ done: false, value: envelope });
            } else {
                buffer.push(envelope);
            }
        });

        const iterator: AsyncIterableIterator<MessageEnvelope> = {
            next() {
                if (buffer.length > 0) {
                    return Promise.resolve({ done: false as const, value: buffer.shift()! });
                }
                return new Promise(r => { waiting = r; });
            },
            [Symbol.asyncIterator]() { return this; },
        };

        return iterator;
    }

}
