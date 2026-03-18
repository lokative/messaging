import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { connect, NatsConnection, JetStreamManager } from 'nats';
import { NatsTransport } from '../src/transports/nats.transport';
import { MessagingPublisher } from '../src/messaging.publisher';
import { Incoming, Outgoing } from '../src/messaging.decorator';
import type { MessagingConfig } from '../src/messaging.config';

const NATS_URL = 'nats://nats:4222';

// Unique stream/subject names per run to avoid collisions
const RUN_ID = Date.now();
const STREAM = `TEST_STREAM_${RUN_ID}`;
const SUBJECT_PUB = `test.pub.${RUN_ID}`;
const SUBJECT_INCOMING = `test.incoming.${RUN_ID}`;
const SUBJECT_OUTGOING = `test.outgoing.${RUN_ID}`;
const SUBJECT_RAW = `test.raw.${RUN_ID}`;
const SUBJECT_MULTI = `test.multi.${RUN_ID}`;

function makeConfig(streams: { name: string; subjects: string[] }[], group?: string): MessagingConfig {
    return {
        transport: NatsTransport,
        transportOptions: { servers: [NATS_URL] },
        streams,
        consumers: { group: group ?? `test-group-${RUN_ID}` },
    };
}

// Cleanup helper
let cleanupNc: NatsConnection;
let cleanupJsm: JetStreamManager;

beforeAll(async () => {
    cleanupNc = await connect({ servers: NATS_URL });
    cleanupJsm = await cleanupNc.jetstreamManager();
});

afterAll(async () => {
    // Clean up test stream
    try { await cleanupJsm.streams.delete(STREAM); } catch { }
    await cleanupNc.close();
});

describe('NATS Integration', () => {

    describe('NatsTransport.publish + subscribe', () => {

        it('publishes and receives a JSON message', async () => {
            const config = makeConfig([{ name: STREAM, subjects: [`test.pub.${RUN_ID}`] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            const payload = { orderId: 'abc-123', amount: 99.99 };
            await transport.publish(SUBJECT_PUB, payload);

            const sub = await transport.subscribe(SUBJECT_PUB, { group: `pub-test-${RUN_ID}` });
            const iter = sub[Symbol.asyncIterator]();

            const { value: msg } = await iter.next();
            expect(msg.subject).toBe(SUBJECT_PUB);
            expect(msg.data).toEqual(payload);
            msg.ack();
        });

        it('handles non-JSON payload gracefully', async () => {
            // Update stream to include raw subject
            try {
                const info = await cleanupJsm.streams.info(STREAM);
                if (!info.config.subjects!.includes(SUBJECT_RAW)) {
                    info.config.subjects!.push(SUBJECT_RAW);
                    await cleanupJsm.streams.update(STREAM, info.config);
                }
            } catch {
                await cleanupJsm.streams.add({ name: STREAM, subjects: [SUBJECT_RAW] });
            }

            const js = cleanupNc.jetstream();
            await js.publish(SUBJECT_RAW, Buffer.from('not-json-content'));

            const config = makeConfig([{ name: STREAM, subjects: [SUBJECT_RAW] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            const sub = await transport.subscribe(SUBJECT_RAW, { group: `raw-test-${RUN_ID}` });
            const iter = sub[Symbol.asyncIterator]();

            const { value: msg } = await iter.next();
            expect(msg.data).toBe('not-json-content');
            msg.ack();
        });

        it('receives multiple messages in order', async () => {
            try {
                const info = await cleanupJsm.streams.info(STREAM);
                if (!info.config.subjects!.includes(SUBJECT_MULTI)) {
                    info.config.subjects!.push(SUBJECT_MULTI);
                    await cleanupJsm.streams.update(STREAM, info.config);
                }
            } catch { }

            const config = makeConfig([{ name: STREAM, subjects: [SUBJECT_MULTI] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            for (let i = 0; i < 5; i++) {
                await transport.publish(SUBJECT_MULTI, { seq: i });
            }

            const sub = await transport.subscribe(SUBJECT_MULTI, { group: `multi-test-${RUN_ID}` });
            const iter = sub[Symbol.asyncIterator]();

            const received: number[] = [];
            for (let i = 0; i < 5; i++) {
                const { value: msg } = await iter.next();
                received.push(msg.data.seq);
                msg.ack();
            }

            expect(received).toEqual([0, 1, 2, 3, 4]);
        });
    });

    describe('MessagingPublisher', () => {

        it('publishes through the transport abstraction', async () => {
            const config = makeConfig([{ name: STREAM, subjects: [SUBJECT_PUB] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            const publisher = new MessagingPublisher(transport);
            await publisher.publish(SUBJECT_PUB, { via: 'publisher', ts: RUN_ID });

            const sub = await transport.subscribe(SUBJECT_PUB, { group: `publisher-test-${RUN_ID}` });
            const iter = sub[Symbol.asyncIterator]();

            // Drain any earlier messages from previous tests, find ours
            let found = false;
            for (let i = 0; i < 10; i++) {
                const { value: msg } = await iter.next();
                msg.ack();
                if (msg.data?.via === 'publisher' && msg.data?.ts === RUN_ID) {
                    found = true;
                    break;
                }
            }
            expect(found).toBe(true);
        });
    });

    describe('@Incoming decorator', () => {

        it('stores metadata that the registry would use to subscribe', async () => {
            class OrderHandler {
                @Incoming('order.created')
                async handle(data: any) { return data; }
            }

            const instance = new OrderHandler();
            const meta = Reflect.getMetadata('msg:incoming', instance.handle);
            expect(meta).toEqual({ subject: 'order.created' });
        });

        it('handler receives real NATS messages when wired manually', async () => {
            try {
                const info = await cleanupJsm.streams.info(STREAM);
                if (!info.config.subjects!.includes(SUBJECT_INCOMING)) {
                    info.config.subjects!.push(SUBJECT_INCOMING);
                    await cleanupJsm.streams.update(STREAM, info.config);
                }
            } catch { }

            const config = makeConfig([{ name: STREAM, subjects: [SUBJECT_INCOMING] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            // Simulate what the registry does: subscribe and call handler
            const received: any[] = [];

            class TestHandler {
                @Incoming(SUBJECT_INCOMING)
                async onMessage(data: any) {
                    received.push(data);
                }
            }

            const handler = new TestHandler();
            const meta = Reflect.getMetadata('msg:incoming', handler.onMessage);

            await transport.publish(meta.subject, { event: 'test-incoming', id: 1 });
            await transport.publish(meta.subject, { event: 'test-incoming', id: 2 });

            const sub = await transport.subscribe(meta.subject, { group: `incoming-test-${RUN_ID}` });

            // Process 2 messages like the registry would
            let count = 0;
            for await (const msg of sub) {
                await handler.onMessage(msg.data);
                msg.ack();
                count++;
                if (count >= 2) break;
            }

            expect(received).toHaveLength(2);
            expect(received[0]).toEqual({ event: 'test-incoming', id: 1 });
            expect(received[1]).toEqual({ event: 'test-incoming', id: 2 });
        });
    });

    describe('@Outgoing decorator', () => {

        it('publishes return value to NATS after method execution', async () => {
            try {
                const info = await cleanupJsm.streams.info(STREAM);
                if (!info.config.subjects!.includes(SUBJECT_OUTGOING)) {
                    info.config.subjects!.push(SUBJECT_OUTGOING);
                    await cleanupJsm.streams.update(STREAM, info.config);
                }
            } catch { }

            const config = makeConfig([{ name: STREAM, subjects: [SUBJECT_OUTGOING] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            const realPublisher = new MessagingPublisher(transport);

            class OrderService {
                publisher = realPublisher;

                @Outgoing(SUBJECT_OUTGOING)
                async createOrder(name: string) {
                    return { name, status: 'created', run: RUN_ID };
                }
            }

            const service = new OrderService();

            // Call the decorated method — should publish the return value
            const result = await service.createOrder('test-order');
            expect(result).toEqual({ name: 'test-order', status: 'created', run: RUN_ID });

            // Verify the message arrived in NATS
            const sub = await transport.subscribe(SUBJECT_OUTGOING, { group: `outgoing-test-${RUN_ID}` });
            const iter = sub[Symbol.asyncIterator]();

            const { value: msg } = await iter.next();
            expect(msg.subject).toBe(SUBJECT_OUTGOING);
            expect(msg.data).toEqual({ name: 'test-order', status: 'created', run: RUN_ID });
            msg.ack();
        });

        it('publishes even when return value is null', async () => {
            const SUBJECT_NULL = `test.outgoing.null.${RUN_ID}`;
            try {
                const info = await cleanupJsm.streams.info(STREAM);
                if (!info.config.subjects!.includes(SUBJECT_NULL)) {
                    info.config.subjects!.push(SUBJECT_NULL);
                    await cleanupJsm.streams.update(STREAM, info.config);
                }
            } catch { }

            const config = makeConfig([{ name: STREAM, subjects: [SUBJECT_NULL] }]);
            const transport = new NatsTransport(config);
            await transport.connect();

            const realPublisher = new MessagingPublisher(transport);

            class NullService {
                publisher = realPublisher;

                @Outgoing(SUBJECT_NULL)
                async doNothing() {
                    return null;
                }
            }

            const service = new NullService();
            await service.doNothing();

            const sub = await transport.subscribe(SUBJECT_NULL, { group: `outgoing-null-${RUN_ID}` });
            const iter = sub[Symbol.asyncIterator]();

            const { value: msg } = await iter.next();
            expect(msg.data).toBeNull();
            msg.ack();
        });
    });

}, { timeout: 30000 });
