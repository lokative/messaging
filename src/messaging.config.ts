import type { Type } from '@nestjs/common';
import type { MessagingTransport, SubscribeOptions } from './transport.interface';

export interface MessagingConfig<TOptions extends Record<string, any> = Record<string, any>> {

    transport: Type<MessagingTransport>

    transportOptions?: TOptions

    streams?: {
        name: string
        subjects: string[]
    }[]

    consumers?: SubscribeOptions & {
        retry?: number
        dlq?: boolean
    }

}
