export interface MessageEnvelope {
    subject: string
    data: any
    ack(): void
    nak(): void
}

export interface Subscription {
    [Symbol.asyncIterator](): AsyncIterator<MessageEnvelope>
}

export interface MessagingTransport {
    connect(): Promise<void>
    publish(subject: string, payload: any): Promise<void>
    subscribe(subject: string, options?: SubscribeOptions): Promise<Subscription>
}

export interface SubscribeOptions {
    group?: string
}

export const MESSAGING_TRANSPORT = 'MESSAGING_TRANSPORT';
