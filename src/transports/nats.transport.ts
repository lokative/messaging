import { Inject, Injectable } from '@nestjs/common';
import type { MessagingTransport, MessageEnvelope, Subscription, SubscribeOptions } from '../transport.interface';
import type { MessagingConfig } from '../messaging.config';
import { JetStreamClient, JetStreamManager, NatsConnection, connect, consumerOpts, DeliverPolicy } from 'nats';

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

    constructor(@Inject('MSG_CONFIG') private config: MessagingConfig<NatsTransportOptions>) { }

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
        const group = options?.group ?? 'nest-consumer';
        const isDurable = options?.durable !== false;          // default: durable
        const startFrom = options?.startFrom ?? 'new';         // default: new messages only

        const safeSuffix = subject.replace(/[.*>]/g, '-');
        const opts = consumerOpts();

        if (isDurable) {
            const durableName = `${group}-${safeSuffix}`;
            opts.durable(durableName);
            opts.deliverTo(`${durableName}-inbox`);
        } else {
            opts.deliverTo(`_INBOX.${group}.${safeSuffix}`);
        }

        opts.ackExplicit();

        if (startFrom === 'first') {
            opts.deliverAll();
        } else {
            opts.deliverNew();
        }

        const sub = await this.js.subscribe(subject, opts);
        const iter = (sub as any)[Symbol.asyncIterator]();

        const iterator: AsyncIterableIterator<MessageEnvelope> = {
            async next() {
                const result = await iter.next();
                if (result.done) return { done: true, value: undefined };
                const msg = result.value;
                const raw = msg.data.toString();
                let data: any;
                try {
                    data = JSON.parse(raw);
                } catch {
                    data = raw;
                }
                return {
                    done: false,
                    value: {
                        subject: msg.subject,
                        data,
                        ack: () => msg.ack(),
                        nak: () => msg.nak(),
                    },
                };
            },
            [Symbol.asyncIterator]() { return this; },
        };

        return iterator;
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
