import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessagingConfig } from '../../src/messaging.config';

const mockPubConnect = vi.fn();
const mockPubPublish = vi.fn();
const mockSubConnect = vi.fn();
const mockSubSubscribe = vi.fn();

const mockDuplicate = vi.fn(() => ({
    connect: mockSubConnect,
    subscribe: mockSubSubscribe,
}));

vi.mock('redis', () => ({
    createClient: vi.fn(() => ({
        connect: mockPubConnect,
        publish: mockPubPublish,
        duplicate: mockDuplicate,
    })),
}));

import { RedisTransport } from '../../src/transports/redis.transport';
import { createClient } from 'redis';

function makeConfig(overrides?: Partial<MessagingConfig>): MessagingConfig {
    return {
        transport: RedisTransport,
        transportOptions: { url: 'redis://localhost:6379' },
        ...overrides,
    };
}

describe('RedisTransport', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('connects with provided url', async () => {
        const transport = new RedisTransport(makeConfig());
        await transport.connect();

        expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
        expect(mockPubConnect).toHaveBeenCalled();
        expect(mockSubConnect).toHaveBeenCalled();
    });

    it('builds url from host and port when url is not provided', async () => {
        const config = makeConfig({
            transportOptions: { host: '10.0.0.1', port: 6380 },
        });
        const transport = new RedisTransport(config);
        await transport.connect();

        expect(createClient).toHaveBeenCalledWith({ url: 'redis://10.0.0.1:6380' });
    });

    it('defaults to localhost:6379 when no options given', async () => {
        const config = makeConfig({ transportOptions: {} });
        const transport = new RedisTransport(config);
        await transport.connect();

        expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
    });

    it('creates a duplicate client for subscriptions', async () => {
        const transport = new RedisTransport(makeConfig());
        await transport.connect();

        expect(mockDuplicate).toHaveBeenCalled();
    });

    it('publishes JSON-encoded payload', async () => {
        const transport = new RedisTransport(makeConfig());
        await transport.connect();

        await transport.publish('order.created', { id: 1 });

        expect(mockPubPublish).toHaveBeenCalledWith('order.created', JSON.stringify({ id: 1 }));
    });

    it('subscribe registers a channel listener', async () => {
        mockSubSubscribe.mockResolvedValue(undefined);

        const transport = new RedisTransport(makeConfig());
        await transport.connect();
        await transport.subscribe('order.created');

        expect(mockSubSubscribe).toHaveBeenCalledWith('order.created', expect.any(Function));
    });

    it('subscription yields messages from redis callback', async () => {
        let redisCallback: any;
        mockSubSubscribe.mockImplementation(async (_channel: string, cb: any) => {
            redisCallback = cb;
        });

        const transport = new RedisTransport(makeConfig());
        await transport.connect();
        const sub = await transport.subscribe('events');

        // Simulate a message arriving via redis pub/sub
        redisCallback(JSON.stringify({ hello: 'world' }), 'events');

        const iterator = sub[Symbol.asyncIterator]();
        const { value } = await iterator.next();

        expect(value.subject).toBe('events');
        expect(value.data).toEqual({ hello: 'world' });
    });

    it('buffers messages when no consumer is waiting', async () => {
        let redisCallback: any;
        mockSubSubscribe.mockImplementation(async (_channel: string, cb: any) => {
            redisCallback = cb;
        });

        const transport = new RedisTransport(makeConfig());
        await transport.connect();
        const sub = await transport.subscribe('events');

        // Push two messages before consuming
        redisCallback(JSON.stringify({ seq: 1 }), 'events');
        redisCallback(JSON.stringify({ seq: 2 }), 'events');

        const iterator = sub[Symbol.asyncIterator]();
        const first = await iterator.next();
        const second = await iterator.next();

        expect(first.value.data).toEqual({ seq: 1 });
        expect(second.value.data).toEqual({ seq: 2 });
    });

});
