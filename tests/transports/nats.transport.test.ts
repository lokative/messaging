import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessagingConfig } from '../../src/messaging.config';

// Use vi.hoisted to declare mocks that are referenced inside vi.mock factories
const mocks = vi.hoisted(() => {
    const mockPublish = vi.fn();
    const mockSubscribe = vi.fn();
    const mockStreamsInfo = vi.fn();
    const mockStreamsAdd = vi.fn();
    const mockStreamsUpdate = vi.fn();

    const mockJetstream = vi.fn(() => ({ publish: mockPublish, subscribe: mockSubscribe }));
    const mockJetstreamManager = vi.fn(() => ({
        streams: { info: mockStreamsInfo, add: mockStreamsAdd, update: mockStreamsUpdate },
    }));
    const mockConnect = vi.fn(() => ({
        jetstream: mockJetstream,
        jetstreamManager: mockJetstreamManager,
    }));
    const mockConsumerOpts = vi.fn(() => ({
        durable: vi.fn(),
        ackExplicit: vi.fn(),
        deliverTo: vi.fn(),
    }));

    return {
        mockPublish, mockSubscribe, mockStreamsInfo, mockStreamsAdd, mockStreamsUpdate,
        mockJetstream, mockJetstreamManager, mockConnect, mockConsumerOpts,
    };
});

vi.mock('nats', () => ({
    connect: mocks.mockConnect,
    consumerOpts: mocks.mockConsumerOpts,
}));

import { NatsTransport } from '../../src/transports/nats.transport';

function makeConfig(overrides?: Partial<MessagingConfig>): MessagingConfig {
    return {
        transport: NatsTransport,
        transportOptions: { servers: ['nats://localhost:4222'] },
        streams: [],
        ...overrides,
    };
}

describe('NatsTransport', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('connects to NATS and initializes jetstream', async () => {
        const transport = new NatsTransport(makeConfig());
        await transport.connect();

        expect(mocks.mockConnect).toHaveBeenCalledWith({ servers: ['nats://localhost:4222'] });
        expect(mocks.mockJetstream).toHaveBeenCalled();
        expect(mocks.mockJetstreamManager).toHaveBeenCalled();
    });

    it('publishes JSON-encoded payload', async () => {
        const transport = new NatsTransport(makeConfig());
        await transport.connect();

        await transport.publish('order.created', { id: 1 });

        expect(mocks.mockPublish).toHaveBeenCalledWith(
            'order.created',
            Buffer.from(JSON.stringify({ id: 1 })),
        );
    });

    it('creates missing streams on connect', async () => {
        mocks.mockStreamsInfo.mockRejectedValue(new Error('not found'));
        mocks.mockStreamsAdd.mockResolvedValue({});

        const config = makeConfig({
            streams: [{ name: 'ORDERS', subjects: ['order.*'] }],
        });
        const transport = new NatsTransport(config);
        await transport.connect();

        expect(mocks.mockStreamsAdd).toHaveBeenCalledWith({ name: 'ORDERS', subjects: ['order.*'] });
    });

    it('updates existing stream with missing subjects', async () => {
        mocks.mockStreamsInfo.mockResolvedValue({
            config: { subjects: ['order.created'] },
        });
        mocks.mockStreamsUpdate.mockResolvedValue({});

        const config = makeConfig({
            streams: [{ name: 'ORDERS', subjects: ['order.created', 'order.updated'] }],
        });
        const transport = new NatsTransport(config);
        await transport.connect();

        expect(mocks.mockStreamsUpdate).toHaveBeenCalledWith('ORDERS', {
            subjects: ['order.created', 'order.updated'],
        });
    });

    it('skips stream update when all subjects exist', async () => {
        mocks.mockStreamsInfo.mockResolvedValue({
            config: { subjects: ['order.created', 'order.updated'] },
        });

        const config = makeConfig({
            streams: [{ name: 'ORDERS', subjects: ['order.created'] }],
        });
        const transport = new NatsTransport(config);
        await transport.connect();

        expect(mocks.mockStreamsUpdate).not.toHaveBeenCalled();
    });

    it('ignores subject overlap error (10065) on stream add', async () => {
        mocks.mockStreamsInfo.mockRejectedValue(new Error('not found'));
        mocks.mockStreamsAdd.mockRejectedValue({ api_error: { err_code: 10065 } });

        const config = makeConfig({
            streams: [{ name: 'ORDERS', subjects: ['order.*'] }],
        });
        const transport = new NatsTransport(config);

        await expect(transport.connect()).resolves.toBeUndefined();
    });

    it('rethrows non-overlap errors on stream add', async () => {
        mocks.mockStreamsInfo.mockRejectedValue(new Error('not found'));
        mocks.mockStreamsAdd.mockRejectedValue({ api_error: { err_code: 9999 } });

        const config = makeConfig({
            streams: [{ name: 'ORDERS', subjects: ['order.*'] }],
        });
        const transport = new NatsTransport(config);

        await expect(transport.connect()).rejects.toEqual({ api_error: { err_code: 9999 } });
    });

    it('uses transportOptions.streams over config.streams', async () => {
        mocks.mockStreamsInfo.mockRejectedValue(new Error('not found'));
        mocks.mockStreamsAdd.mockResolvedValue({});

        const config = makeConfig({
            transportOptions: {
                servers: ['nats://localhost:4222'],
                streams: [{ name: 'CUSTOM', subjects: ['custom.*'] }],
            },
            streams: [{ name: 'IGNORED', subjects: ['ignored.*'] }],
        });
        const transport = new NatsTransport(config);
        await transport.connect();

        expect(mocks.mockStreamsAdd).toHaveBeenCalledWith({ name: 'CUSTOM', subjects: ['custom.*'] });
    });

    it('subscribe creates a durable consumer with group name', async () => {
        const mockSub = {
            [Symbol.asyncIterator]: () => ({
                next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
            }),
        };
        mocks.mockSubscribe.mockResolvedValue(mockSub);

        const transport = new NatsTransport(makeConfig());
        await transport.connect();
        await transport.subscribe('order.created', { group: 'my-group' });

        const opts = mocks.mockConsumerOpts.mock.results[0].value;
        expect(opts.durable).toHaveBeenCalledWith('my-group');
        expect(opts.ackExplicit).toHaveBeenCalled();
    });

});
