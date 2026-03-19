import { Inject, Injectable } from '@nestjs/common';
import type { MessagingTransport, MessageEnvelope, Subscription, SubscribeOptions } from '../transport.interface';
import type { MessagingConfig } from '../messaging.config';
import { Kafka, Producer, type EachMessagePayload } from 'kafkajs';

export interface KafkaTransportOptions {
    brokers: string[]
    clientId?: string
}

@Injectable()
export class KafkaTransport implements MessagingTransport {

    private kafka: Kafka;
    private producer: Producer;

    constructor(@Inject('MSG_CONFIG') private config: MessagingConfig<KafkaTransportOptions>) { }

    async connect() {
        const opts = this.config.transportOptions as KafkaTransportOptions;

        this.kafka = new Kafka({
            clientId: opts.clientId ?? 'nestjs-app',
            brokers: opts.brokers,
        });

        this.producer = this.kafka.producer();
        await this.producer.connect();
    }

    async publish(subject: string, payload: any): Promise<void> {
        await this.producer.send({
            topic: subject,
            messages: [{ value: JSON.stringify(payload) }],
        });
    }

    async subscribe(subject: string, options?: SubscribeOptions): Promise<Subscription> {
        const consumer = this.kafka.consumer({
            groupId: options?.group ?? 'nest-consumer',
        });

        await consumer.connect();
        await consumer.subscribe({
            topic: subject,
            fromBeginning: options?.startFrom === 'first',
        });

        const buffer: MessageEnvelope[] = [];
        let waiting: ((value: IteratorResult<MessageEnvelope>) => void) | null = null;

        await consumer.run({
            eachMessage: async ({ topic, message }: EachMessagePayload) => {
                const raw = message.value?.toString() ?? '';
                let data: any;
                try {
                    data = JSON.parse(raw);
                } catch {
                    data = raw;
                }
                const envelope: MessageEnvelope = {
                    subject: topic,
                    data,
                    ack: () => { },   // kafkajs auto-commits offsets
                    nak: () => { },
                };

                if (waiting) {
                    const resolve = waiting;
                    waiting = null;
                    resolve({ done: false, value: envelope });
                } else {
                    buffer.push(envelope);
                }
            },
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
