import { Inject, Injectable } from "@nestjs/common";
import { MessagingTransport, MESSAGING_TRANSPORT } from "./transport.interface";

@Injectable()
export class MessagingPublisher {

    constructor(@Inject(MESSAGING_TRANSPORT) private transport: MessagingTransport) { }

    async publish(subject: string, payload: any) {
        await this.transport.publish(subject, payload);
    }

}
