import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { MessagingConsumerRegistry } from '../src/messaging.registry';
import { Incoming } from '../src/messaging.decorator';
import type { MessagingTransport, MessageEnvelope } from '../src/transport.interface';
import type { MessagingConfig } from '../src/messaging.config';

function createMockEnvelope(data: any): MessageEnvelope {
    return {
        subject: 'test',
        data,
        ack: vi.fn(),
        nak: vi.fn(),
    };
}

function oneMessageSubscription(envelope: MessageEnvelope) {
    let consumed = false;
    return {
        [Symbol.asyncIterator]: () => ({
            async next() {
                if (consumed) return { done: true as const, value: undefined };
                consumed = true;
                return { done: false as const, value: envelope };
            },
        }),
    };
}

describe('MessagingConsumerRegistry', () => {

    it('connects transport and discovers @Incoming handlers', async () => {
        class TestHandler {
            @Incoming('order.created')
            async handle(data: any) { }
        }

        const instance = new TestHandler();
        const envelope = createMockEnvelope({ id: 1 });

        const transport: MessagingTransport = {
            connect: vi.fn(),
            publish: vi.fn(),
            subscribe: vi.fn().mockResolvedValue(oneMessageSubscription(envelope)),
        };

        const discovery = {
            getProviders: () => [{ instance }],
        };

        const config: MessagingConfig = {
            transport: class {} as any,
            consumers: { group: 'test-group' },
        };

        const registry = new MessagingConsumerRegistry(
            transport,
            discovery as any,
            config,
        );

        await registry.onModuleInit();

        expect(transport.connect).toHaveBeenCalled();
        expect(transport.subscribe).toHaveBeenCalledWith('order.created', { group: 'test-group' });
    });

    it('acks message on successful handler execution', async () => {
        class TestHandler {
            @Incoming('events')
            async handle(data: any) { }
        }

        const instance = new TestHandler();
        const envelope = createMockEnvelope({ ok: true });

        const transport: MessagingTransport = {
            connect: vi.fn(),
            publish: vi.fn(),
            subscribe: vi.fn().mockResolvedValue(oneMessageSubscription(envelope)),
        };

        const discovery = { getProviders: () => [{ instance }] };
        const config: MessagingConfig = { transport: class {} as any };

        const registry = new MessagingConsumerRegistry(transport, discovery as any, config);
        await registry.onModuleInit();

        // Give the async iterator a tick to process
        await new Promise(r => setTimeout(r, 10));

        expect(envelope.ack).toHaveBeenCalled();
        expect(envelope.nak).not.toHaveBeenCalled();
    });

    it('naks message when handler throws', async () => {
        class TestHandler {
            @Incoming('events')
            async handle() {
                throw new Error('boom');
            }
        }

        const instance = new TestHandler();
        const envelope = createMockEnvelope({ fail: true });

        const transport: MessagingTransport = {
            connect: vi.fn(),
            publish: vi.fn(),
            subscribe: vi.fn().mockResolvedValue(oneMessageSubscription(envelope)),
        };

        const discovery = { getProviders: () => [{ instance }] };
        const config: MessagingConfig = { transport: class {} as any };

        const registry = new MessagingConsumerRegistry(transport, discovery as any, config);
        await registry.onModuleInit();

        await new Promise(r => setTimeout(r, 10));

        expect(envelope.nak).toHaveBeenCalled();
        expect(envelope.ack).not.toHaveBeenCalled();
    });

    it('skips providers without instances', async () => {
        const transport: MessagingTransport = {
            connect: vi.fn(),
            publish: vi.fn(),
            subscribe: vi.fn(),
        };

        const discovery = { getProviders: () => [{ instance: null }, { instance: undefined }] };
        const config: MessagingConfig = { transport: class {} as any };

        const registry = new MessagingConsumerRegistry(transport, discovery as any, config);
        await registry.onModuleInit();

        expect(transport.subscribe).not.toHaveBeenCalled();
    });

    it('skips methods without @Incoming metadata', async () => {
        class PlainService {
            async doStuff() { }
        }

        const transport: MessagingTransport = {
            connect: vi.fn(),
            publish: vi.fn(),
            subscribe: vi.fn(),
        };

        const discovery = { getProviders: () => [{ instance: new PlainService() }] };
        const config: MessagingConfig = { transport: class {} as any };

        const registry = new MessagingConsumerRegistry(transport, discovery as any, config);
        await registry.onModuleInit();

        expect(transport.subscribe).not.toHaveBeenCalled();
    });

});
