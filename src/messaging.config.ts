import type { Type } from '@nestjs/common';
import type { MessagingTransport } from './transport.interface';

export interface MessagingConfig {

    transport: Type<MessagingTransport>

    transportOptions?: Record<string, any>

    streams?: {
        name: string
        subjects: string[]
    }[]

    consumers?: {
        group?: string
        retry?: number
        dlq?: boolean
    }

}
