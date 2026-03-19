import { DynamicModule, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { MessagingConfig } from "./messaging.config";
import { MESSAGING_TRANSPORT } from "./transport.interface";
import { MessagingPublisher } from "./messaging.publisher";
import { MessagingConsumerRegistry } from "./messaging.registry";

@Module({})
export class MessagingModule {

    static register<TOptions extends Record<string, any> = Record<string, any>>(
        config: MessagingConfig<TOptions>,
    ): DynamicModule {

        return {
            module: MessagingModule,
            imports: [DiscoveryModule],
            providers: [
                { provide: "MSG_CONFIG", useValue: config },
                { provide: MESSAGING_TRANSPORT, useClass: config.transport },
                MessagingPublisher,
                MessagingConsumerRegistry,
            ],
            exports: [MessagingPublisher],
        }

    }

}
