import { env } from "@kompose/env";
import { RedisClient } from "bun";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type Publisher,
  type Subscriber,
} from "resumable-stream/generic";

/**
 * Dedicated Redis clients for resumable chat streams.
 * Publisher/subscriber are split so pubsub listeners do not block KV calls.
 */
const redisPublisher = new RedisClient(env.REDIS_URL);
const redisSubscriber = new RedisClient(env.REDIS_URL);

const publisher: Publisher = {
  connect: async () => {
    // Bun Redis connects lazily; explicit connect is not required.
  },
  get: async (key) => await redisPublisher.get(key),
  incr: async (key) => await redisPublisher.incr(key),
  publish: async (channel, message) =>
    await redisPublisher.publish(channel, message),
  set: async (key, value, options) => {
    await redisPublisher.set(key, value);
    if (options?.EX !== undefined) {
      await redisPublisher.expire(key, options.EX);
    }
  },
};

const subscriber: Subscriber = {
  connect: async () => {
    // Bun Redis connects lazily; explicit connect is not required.
  },
  subscribe: async (channel, callback) => {
    await redisSubscriber.subscribe(channel, callback);
  },
  unsubscribe: async (channel) => {
    await redisSubscriber.unsubscribe(channel);
  },
};

export const chatResumableStreamContext = createResumableStreamContext({
  waitUntil: after,
  keyPrefix: "kompose:chat:stream",
  publisher,
  subscriber,
});
