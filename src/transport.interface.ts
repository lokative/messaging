export interface MessageEnvelope {
    subject: string
    data: any
    ack(): void
    nak(): void
}

export interface Subscription extends AsyncIterableIterator<MessageEnvelope> {}

export interface MessagingTransport {
    connect(): Promise<void>
    publish(subject: string, payload: any): Promise<void>
    subscribe(subject: string, options?: SubscribeOptions): Promise<Subscription>
}

export interface SubscribeOptions {
    group?: string
    durable?: boolean
    startFrom?: 'first' | 'new'
}

export const MESSAGING_TRANSPORT = 'MESSAGING_TRANSPORT';
