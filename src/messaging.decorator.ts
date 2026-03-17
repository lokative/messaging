import { MessagingPublisher } from "./messaging.publisher";

export function Incoming(subject: string): MethodDecorator {

    return (target: any, key) => {

        Reflect.defineMetadata(
            "msg:incoming",
            { subject },
            target[key]
        )
    }
}
export function Outgoing(subject: string): MethodDecorator {

    return (target, key, descriptor: any) => {

        const original = descriptor.value

        descriptor.value = async function (...args: any[]) {

            const result = await original.apply(this, args)

            const publisher: MessagingPublisher = this.publisher

            await publisher.publish(subject, result)

            return result

        }

    }

}