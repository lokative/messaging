import { describe, it, expect, vi } from 'vitest';
import { MessagingModule } from '../src/messaging.module';
import { MESSAGING_TRANSPORT } from '../src/transport.interface';
import { MessagingPublisher } from '../src/messaging.publisher';
import { MessagingConsumerRegistry } from '../src/messaging.registry';
import type { MessagingTransport } from '../src/transport.interface';
import { Injectable } from '@nestjs/common';

@Injectable()
class FakeTransport implements MessagingTransport {
    connect = vi.fn();
    publish = vi.fn();
    subscribe = vi.fn();
}

describe('MessagingModule', () => {

    it('returns a DynamicModule with correct providers', () => {
        const config = {
            transport: FakeTransport,
            transportOptions: { url: 'fake://localhost' },
        };

        const result = MessagingModule.register(config);

        expect(result.module).toBe(MessagingModule);
        expect(result.imports).toBeDefined();

        const providers = result.providers as any[];
        const configProvider = providers.find((p: any) => p.provide === 'MSG_CONFIG');
        expect(configProvider.useValue).toBe(config);

        const transportProvider = providers.find((p: any) => p.provide === MESSAGING_TRANSPORT);
        expect(transportProvider.useClass).toBe(FakeTransport);

        expect(providers).toContain(MessagingPublisher);
        expect(providers).toContain(MessagingConsumerRegistry);
    });

    it('exports MessagingPublisher', () => {
        const result = MessagingModule.register({
            transport: FakeTransport,
        });

        expect(result.exports).toContain(MessagingPublisher);
    });

});
