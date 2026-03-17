import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { Incoming, Outgoing } from '../src/messaging.decorator';

describe('Incoming decorator', () => {

    it('stores subject metadata on the method', () => {
        class TestHandler {
            @Incoming('order.created')
            handle() { }
        }

        const instance = new TestHandler();
        const meta = Reflect.getMetadata('msg:incoming', instance.handle);

        expect(meta).toEqual({ subject: 'order.created' });
    });

    it('stores different metadata for different methods', () => {
        class TestHandler {
            @Incoming('order.created')
            handleCreate() { }

            @Incoming('order.deleted')
            handleDelete() { }
        }

        const instance = new TestHandler();

        expect(Reflect.getMetadata('msg:incoming', instance.handleCreate)).toEqual({ subject: 'order.created' });
        expect(Reflect.getMetadata('msg:incoming', instance.handleDelete)).toEqual({ subject: 'order.deleted' });
    });

});

describe('Outgoing decorator', () => {

    it('publishes the return value to the subject', async () => {
        const mockPublish = vi.fn();

        class TestService {
            publisher = { publish: mockPublish };

            @Outgoing('order.confirmed')
            async confirm() {
                return { id: 1, status: 'confirmed' };
            }
        }

        const service = new TestService();
        const result = await service.confirm();

        expect(result).toEqual({ id: 1, status: 'confirmed' });
        expect(mockPublish).toHaveBeenCalledWith('order.confirmed', { id: 1, status: 'confirmed' });
    });

    it('passes arguments through to the original method', async () => {
        const mockPublish = vi.fn();

        class TestService {
            publisher = { publish: mockPublish };

            @Outgoing('user.updated')
            async update(id: string, name: string) {
                return { id, name };
            }
        }

        const service = new TestService();
        const result = await service.update('42', 'Alice');

        expect(result).toEqual({ id: '42', name: 'Alice' });
        expect(mockPublish).toHaveBeenCalledWith('user.updated', { id: '42', name: 'Alice' });
    });

    it('still publishes even if return value is null', async () => {
        const mockPublish = vi.fn();

        class TestService {
            publisher = { publish: mockPublish };

            @Outgoing('event.fired')
            async fire() {
                return null;
            }
        }

        const service = new TestService();
        await service.fire();

        expect(mockPublish).toHaveBeenCalledWith('event.fired', null);
    });

});
