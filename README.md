# @lokative/messaging

A transport-agnostic messaging module for NestJS. Ships with built-in NATS JetStream, Kafka, and Redis transports. Swap transports with a single config change — your handlers and publishers stay the same.

## Installation

```bash
npm install @lokative/messaging
```

Install the peer dependency for your chosen transport:

```bash
# NATS JetStream
npm install nats

# Kafka
npm install kafkajs

# Redis
npm install redis
```

---

## Quick Start

### NATS JetStream

```typescript
import { Module } from '@nestjs/common';
import { MessagingModule, NatsTransport } from '@lokative/messaging';

@Module({
  imports: [
    MessagingModule.register({
      transport: NatsTransport,
      transportOptions: {
        servers: ['nats://localhost:4222'],
      },
      streams: [
        { name: 'ORDERS', subjects: ['order.created', 'order.updated'] },
      ],
      consumers: {
        group: 'order-service',
      },
    }),
  ],
})
export class AppModule {}
```

### Kafka

```typescript
import { Module } from '@nestjs/common';
import { MessagingModule, KafkaTransport } from '@lokative/messaging';

@Module({
  imports: [
    MessagingModule.register({
      transport: KafkaTransport,
      transportOptions: {
        brokers: ['localhost:9092'],
        clientId: 'order-service',
      },
      consumers: {
        group: 'order-service-group',
      },
    }),
  ],
})
export class AppModule {}
```

### Redis

```typescript
import { Module } from '@nestjs/common';
import { MessagingModule, RedisTransport } from '@lokative/messaging';

@Module({
  imports: [
    MessagingModule.register({
      transport: RedisTransport,
      transportOptions: {
        url: 'redis://localhost:6379',
      },
    }),
  ],
})
export class AppModule {}
```

Redis can also be configured with `host` and `port` instead of `url`:

```typescript
transportOptions: {
  host: '10.0.0.5',
  port: 6380,
}
```

---

## Configuration

`MessagingModule.register()` accepts a `MessagingConfig` object:

| Property           | Type                        | Required | Description                                      |
| ------------------ | --------------------------- | -------- | ------------------------------------------------ |
| `transport`        | `Type<MessagingTransport>`  | Yes      | The transport class to use                       |
| `transportOptions` | `Record<string, any>`       | No       | Transport-specific connection options             |
| `streams`          | `{ name, subjects[] }[]`    | No       | Stream/topic definitions (used by NATS transport) |
| `consumers`        | `ConsumerOptions`           | No       | Consumer group configuration                      |

### Consumer Options

| Property | Type      | Description                                  |
| -------- | --------- | -------------------------------------------- |
| `group`  | `string`  | Consumer group / durable name                |
| `retry`  | `number`  | Number of retry attempts on failure          |
| `dlq`    | `boolean` | Enable dead-letter queue for failed messages |

### Transport Options

#### `NatsTransportOptions`

| Property  | Type                        | Required | Description                          |
| --------- | --------------------------- | -------- | ------------------------------------ |
| `servers` | `string[]`                  | Yes      | NATS server URLs                     |
| `streams` | `{ name, subjects[] }[]`    | No       | Overrides top-level `streams` config |

#### `KafkaTransportOptions`

| Property   | Type       | Required | Description                        |
| ---------- | ---------- | -------- | ---------------------------------- |
| `brokers`  | `string[]` | Yes      | Kafka broker addresses             |
| `clientId` | `string`   | No       | Client identifier (default: `nestjs-app`) |

#### `RedisTransportOptions`

| Property | Type     | Required | Description                                  |
| -------- | -------- | -------- | -------------------------------------------- |
| `url`    | `string` | No       | Redis connection URL (e.g. `redis://localhost:6379`) |
| `host`   | `string` | No       | Redis host (default: `localhost`)            |
| `port`   | `number` | No       | Redis port (default: `6379`)                 |

Provide either `url` or `host`/`port`. If both are given, `url` takes precedence.

---

## Decorators

### `@Incoming(subject: string)`

Marks a method as a message handler. The module auto-discovers decorated methods at startup and subscribes them to the given subject.

```typescript
import { Injectable } from '@nestjs/common';
import { Incoming } from '@lokative/messaging';

@Injectable()
export class OrderHandler {

  @Incoming('order.created')
  async handleOrderCreated(data: any) {
    console.log('New order:', data);
    // Auto-acked on success, nak'd on thrown error
  }

}
```

### `@Outgoing(subject: string)`

Wraps a method so its return value is automatically published to the given subject. The decorated class must have a `publisher` property (typically injected).

```typescript
import { Injectable } from '@nestjs/common';
import { Outgoing, MessagingPublisher } from '@lokative/messaging';

@Injectable()
export class OrderService {

  constructor(public publisher: MessagingPublisher) {}

  @Outgoing('order.confirmed')
  async confirmOrder(orderId: string) {
    const order = await this.processConfirmation(orderId);
    return order; // automatically published to 'order.confirmed'
  }

}
```

---

## Publishing Messages

Inject `MessagingPublisher` to publish messages manually:

```typescript
import { Injectable } from '@nestjs/common';
import { MessagingPublisher } from '@lokative/messaging';

@Injectable()
export class NotificationService {

  constructor(private publisher: MessagingPublisher) {}

  async notifyUser(userId: string, event: string) {
    await this.publisher.publish('notification.send', {
      userId,
      event,
      timestamp: Date.now(),
    });
  }

}
```

---

## Transport Comparison

| Feature              | NATS JetStream       | Kafka                | Redis Pub/Sub        |
| -------------------- | -------------------- | -------------------- | -------------------- |
| Message persistence  | Yes (streams)        | Yes (log)            | No                   |
| Consumer groups      | Yes (durable)        | Yes (group id)       | No                   |
| Ack/Nak              | Yes                  | Auto-commit          | N/A                  |
| Ordering             | Per-subject          | Per-partition         | Per-channel          |
| Best for             | Microservices, CQRS  | Event streaming, ETL | Real-time, fire-and-forget |

---

## Custom Transports

Implement the `MessagingTransport` interface to add support for any broker:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import type {
  MessagingTransport,
  MessageEnvelope,
  Subscription,
  SubscribeOptions,
  MessagingConfig,
} from '@lokative/messaging';

@Injectable()
export class MyCustomTransport implements MessagingTransport {

  constructor(@Inject('MSG_CONFIG') private config: MessagingConfig) {}

  async connect(): Promise<void> {
    // establish connection using this.config.transportOptions
  }

  async publish(subject: string, payload: any): Promise<void> {
    // publish serialized payload to subject/topic
  }

  async subscribe(subject: string, options?: SubscribeOptions): Promise<Subscription> {
    // return an async-iterable of MessageEnvelope
  }

}
```

Then register it:

```typescript
MessagingModule.register({
  transport: MyCustomTransport,
  transportOptions: { /* ... */ },
})
```

### Interface Reference

```typescript
interface MessagingTransport {
  connect(): Promise<void>;
  publish(subject: string, payload: any): Promise<void>;
  subscribe(subject: string, options?: SubscribeOptions): Promise<Subscription>;
}

interface MessageEnvelope {
  subject: string;
  data: any;
  ack(): void;
  nak(): void;
}

interface Subscription {
  [Symbol.asyncIterator](): AsyncIterator<MessageEnvelope>;
}

interface SubscribeOptions {
  group?: string;
}
```

---

## Full Application Example

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { MessagingModule, NatsTransport } from '@lokative/messaging';
import { OrderModule } from './order/order.module';

@Module({
  imports: [
    MessagingModule.register({
      transport: NatsTransport,
      transportOptions: {
        servers: ['nats://localhost:4222'],
      },
      streams: [
        { name: 'ORDERS', subjects: ['order.*'] },
        { name: 'NOTIFICATIONS', subjects: ['notification.*'] },
      ],
      consumers: { group: 'api-service' },
    }),
    OrderModule,
  ],
})
export class AppModule {}
```

```typescript
// order/order.module.ts
import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderHandler } from './order.handler';

@Module({
  providers: [OrderService, OrderHandler],
  exports: [OrderService],
})
export class OrderModule {}
```

```typescript
// order/order.service.ts
import { Injectable } from '@nestjs/common';
import { MessagingPublisher, Outgoing } from '@lokative/messaging';

@Injectable()
export class OrderService {

  constructor(public publisher: MessagingPublisher) {}

  @Outgoing('order.created')
  async createOrder(dto: any) {
    return { id: '123', ...dto, status: 'created' };
  }

  async cancelOrder(orderId: string) {
    await this.publisher.publish('order.cancelled', { orderId });
  }

}
```

```typescript
// order/order.handler.ts
import { Injectable } from '@nestjs/common';
import { Incoming } from '@lokative/messaging';

@Injectable()
export class OrderHandler {

  @Incoming('order.created')
  async onOrderCreated(data: any) {
    console.log('Processing new order:', data.id);
  }

  @Incoming('order.cancelled')
  async onOrderCancelled(data: any) {
    console.log('Order cancelled:', data.orderId);
  }

}
```

To switch this app to Kafka, change only the module registration:

```typescript
import { KafkaTransport } from '@lokative/messaging';

MessagingModule.register({
  transport: KafkaTransport,
  transportOptions: {
    brokers: ['localhost:9092'],
    clientId: 'api-service',
  },
  consumers: { group: 'api-service' },
})
```

Or to Redis:

```typescript
import { RedisTransport } from '@lokative/messaging';

MessagingModule.register({
  transport: RedisTransport,
  transportOptions: { url: 'redis://localhost:6379' },
})
```

No changes needed in services or handlers.

---

## API Reference

### Exports

| Export                     | Type        | Description                                    |
| -------------------------- | ----------- | ---------------------------------------------- |
| `MessagingModule`          | Module      | NestJS dynamic module                          |
| `MessagingPublisher`       | Injectable  | Service for publishing messages                |
| `MessagingConsumerRegistry`| Injectable  | Auto-discovers and starts `@Incoming` handlers |
| `MessagingConfig`          | Interface   | Configuration shape for `register()`           |
| `MessagingTransport`       | Interface   | Contract for custom transports                 |
| `MessageEnvelope`          | Interface   | Incoming message wrapper                       |
| `Subscription`             | Interface   | Async-iterable subscription                    |
| `SubscribeOptions`         | Interface   | Options passed to `subscribe()`                |
| `MESSAGING_TRANSPORT`      | Token       | DI token for the transport provider            |
| `NatsTransport`            | Injectable  | Built-in NATS JetStream transport              |
| `NatsTransportOptions`     | Interface   | Options for `NatsTransport`                    |
| `KafkaTransport`           | Injectable  | Built-in Kafka transport                       |
| `KafkaTransportOptions`    | Interface   | Options for `KafkaTransport`                   |
| `RedisTransport`           | Injectable  | Built-in Redis Pub/Sub transport               |
| `RedisTransportOptions`    | Interface   | Options for `RedisTransport`                   |
| `Incoming`                 | Decorator   | Subscribe a method to a subject                |
| `Outgoing`                 | Decorator   | Auto-publish a method's return value           |

### Injection

```typescript
// Inject the publisher
constructor(private publisher: MessagingPublisher) {}

// Inject the raw transport (advanced)
constructor(@Inject(MESSAGING_TRANSPORT) private transport: MessagingTransport) {}
```

---

## License

MIT — Made with care by [Lokative](https://lokative.com)
