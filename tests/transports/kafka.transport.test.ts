import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessagingConfig } from '../../src/messaging.config';

const mockProducerConnect = vi.fn();
const mockProducerSend = vi.fn();
const mockConsumerConnect = vi.fn();
const mockConsumerSubscribe = vi.fn();
const mockConsumerRun = vi.fn();

const mockProducer = vi.fn(() => ({
    connect: mockProducerConnect,
    send: mockProducerSend,
}));
const mockConsumer = vi.fn(() => ({
    connect: mockConsumerConnect,
    subscribe: mockConsumerSubscribe,
    run: mockConsumerRun,
}));

vi.mock('kafkajs', () => ({
    Kafka: vi.fn(() => ({
        producer: mockProducer,
        consumer: mockConsumer,
    })),
}));

import { KafkaTransport } from '../../src/transports/kafka.transport';
import { Kafka } from 'kafkajs';

function makeConfig(overrides?: Partial<MessagingConfig>): MessagingConfig {
    return {
        transport: KafkaTransport,
        transportOptions: { brokers: ['localhost:9092'] },
        ...overrides,
    };
}

describe('KafkaTransport', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('connects with provided brokers and clientId', async () => {
        const config = makeConfig({
            transportOptions: { brokers: ['broker1:9092', 'broker2:9092'], clientId: 'my-app' },
        });
        const transport = new KafkaTransport(config);
        await transport.connect();

        expect(Kafka).toHaveBeenCalledWith({ clientId: 'my-app', brokers: ['broker1:9092', 'broker2:9092'] });
        expect(mockProducerConnect).toHaveBeenCalled();
    });

    it('defaults clientId to nestjs-app', async () => {
        const transport = new KafkaTransport(makeConfig());
        await transport.connect();

        expect(Kafka).toHaveBeenCalledWith({ clientId: 'nestjs-app', brokers: ['localhost:9092'] });
    });

    it('publishes JSON message to topic', async () => {
        const transport = new KafkaTransport(makeConfig());
        await transport.connect();

        await transport.publish('order.created', { id: 42 });

        expect(mockProducerSend).toHaveBeenCalledWith({
            topic: 'order.created',
            messages: [{ value: JSON.stringify({ id: 42 }) }],
        });
    });

    it('subscribe creates consumer with group id', async () => {
        mockConsumerRun.mockResolvedValue(undefined);

        const transport = new KafkaTransport(makeConfig());
        await transport.connect();
        await transport.subscribe('events', { group: 'my-group' });

        expect(mockConsumer).toHaveBeenCalledWith({ groupId: 'my-group' });
        expect(mockConsumerConnect).toHaveBeenCalled();
        expect(mockConsumerSubscribe).toHaveBeenCalledWith({ topic: 'events', fromBeginning: false });
        expect(mockConsumerRun).toHaveBeenCalled();
    });

    it('defaults consumer group to nest-consumer', async () => {
        mockConsumerRun.mockResolvedValue(undefined);

        const transport = new KafkaTransport(makeConfig());
        await transport.connect();
        await transport.subscribe('events');

        expect(mockConsumer).toHaveBeenCalledWith({ groupId: 'nest-consumer' });
    });

    it('subscription yields messages from eachMessage callback', async () => {
        let eachMessageHandler: any;
        mockConsumerRun.mockImplementation(async ({ eachMessage }: any) => {
            eachMessageHandler = eachMessage;
        });

        const transport = new KafkaTransport(makeConfig());
        await transport.connect();
        const sub = await transport.subscribe('events');

        // Simulate a message arriving
        await eachMessageHandler({
            topic: 'events',
            partition: 0,
            message: { value: Buffer.from(JSON.stringify({ hello: 'world' })) },
        });

        const iterator = sub[Symbol.asyncIterator]();
        const { value } = await iterator.next();

        expect(value.subject).toBe('events');
        expect(value.data).toEqual({ hello: 'world' });
    });

});
