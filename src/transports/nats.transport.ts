import { Inject, Injectable } from '@nestjs/common';
import type { MessagingTransport, MessageEnvelope, Subscription, SubscribeOptions } from '../transport.interface';
import type { MessagingConfig } from '../messaging.config';
import { JetStreamClient, JetStreamManager, NatsConnection, connect, consumerOpts } from 'nats';

export interface NatsTransportOptions {
    servers: string[]
    streams?: {
        name: string
        subjects: string[]
    }[]
}

@Injectable()
export class NatsTransport implements MessagingTransport {

    private nc: NatsConnection;
    private js: JetStreamClient;
    private jsm: JetStreamManager;

    constructor(@Inject('MSG_CONFIG') private config: MessagingConfig) { }

    async connect() {
        const opts = this.config.transportOptions as NatsTransportOptions;

        this.nc = await connect({ servers: opts.servers });
        this.js = this.nc.jetstream();
        this.jsm = await this.nc.jetstreamManager();

        await this.ensureStreams(opts.streams ?? this.config.streams ?? []);
    }

    async publish(subject: string, payload: any): Promise<void> {
        await this.js.publish(subject, Buffer.from(JSON.stringify(payload)));
    }

    async subscribe(subject: string, options?: SubscribeOptions): Promise<Subscription> {
        const durable = options?.group ?? 'nest-consumer';
        const opts = consumerOpts();
        opts.durable(durable);
        opts.ackExplicit();
        opts.deliverTo(durable);

        const sub = await this.js.subscribe(subject, opts);
        const iter = (sub as any)[Symbol.asyncIterator]();

        const iterator: AsyncIterator<MessageEnvelope> = {
            async next() {
                const result = await iter.next();
                if (result.done) return { done: true, value: undefined };
                const msg = result.value;
                return {
                    done: false,
                    value: {
                        subject: msg.subject,
                        data: JSON.parse(msg.data.toString()),
                        ack: () => msg.ack(),
                        nak: () => msg.nak(),
                    },
                };
            },
        };

        return { [Symbol.asyncIterator]: () => iterator };
    }

    private async ensureStreams(streams: { name: string; subjects: string[] }[]) {
        for (const stream of streams) {
            try {
                const info = await this.jsm.streams.info(stream.name);
                const existing = info.config.subjects ?? [];
                const missing = stream.subjects.filter(s => !existing.includes(s));
                if (missing.length > 0) {
                    info.config.subjects = [...existing, ...missing];
                    await this.jsm.streams.update(stream.name, info.config);
                }
            } catch {
                try {
                    await this.jsm.streams.add({ name: stream.name, subjects: stream.subjects });
                } catch (addErr: any) {
                    if (addErr?.api_error?.err_code !== 10065) throw addErr;
                }
            }
        }
    }
}
