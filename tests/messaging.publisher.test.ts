import { describe, it, expect, vi } from 'vitest';
import { MessagingPublisher } from '../src/messaging.publisher';
import type { MessagingTransport } from '../src/transport.interface';

function mockTransport(): MessagingTransport {
    return {
        connect: vi.fn(),
        publish: vi.fn(),
        subscribe: vi.fn(),
    };
}

describe('MessagingPublisher', () => {

    it('delegates publish to the transport', async () => {
        const transport = mockTransport();
        const publisher = new MessagingPublisher(transport);

        await publisher.publish('order.created', { id: 1 });

        expect(transport.publish).toHaveBeenCalledWith('order.created', { id: 1 });
    });

    it('publishes different subjects independently', async () => {
        const transport = mockTransport();
        const publisher = new MessagingPublisher(transport);

        await publisher.publish('order.created', { id: 1 });
        await publisher.publish('order.updated', { id: 1, status: 'done' });

        expect(transport.publish).toHaveBeenCalledTimes(2);
        expect(transport.publish).toHaveBeenNthCalledWith(1, 'order.created', { id: 1 });
        expect(transport.publish).toHaveBeenNthCalledWith(2, 'order.updated', { id: 1, status: 'done' });
    });

    it('propagates transport errors', async () => {
        const transport = mockTransport();
        (transport.publish as any).mockRejectedValue(new Error('connection lost'));
        const publisher = new MessagingPublisher(transport);

        await expect(publisher.publish('fail', {})).rejects.toThrow('connection lost');
    });

});
