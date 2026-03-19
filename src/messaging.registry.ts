import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core/discovery";
import { MessagingTransport, MESSAGING_TRANSPORT } from "./transport.interface";
import type { MessagingConfig } from "./messaging.config";

@Injectable()
export class MessagingConsumerRegistry implements OnModuleInit {

    constructor(
        @Inject(MESSAGING_TRANSPORT) private transport: MessagingTransport,
        private discovery: DiscoveryService,
        @Inject("MSG_CONFIG") private config: MessagingConfig,
    ) { }

    async onModuleInit() {
        await this.transport.connect();

        const providers = this.discovery.getProviders();

        for (const provider of providers) {
            const instance = provider.instance;
            if (!instance) continue;

            const proto = Object.getPrototypeOf(instance);

            for (const key of Object.getOwnPropertyNames(proto)) {
                const handler = instance[key];
                if (typeof handler !== 'function') continue;

                const meta = Reflect.getMetadata("msg:incoming", handler);
                if (!meta) continue;

                this.startConsumer(instance, handler, meta);
            }
        }
    }

    private async startConsumer(instance: any, handler: any, meta: any) {
        const { retry, dlq, ...subscribeOpts } = this.config.consumers ?? {};
        const sub = await this.transport.subscribe(meta.subject, subscribeOpts);

        for await (const msg of sub) {
            try {
                await handler.call(instance, msg.data);
                msg.ack();
            } catch {
                msg.nak();
            }
        }
    }

}
