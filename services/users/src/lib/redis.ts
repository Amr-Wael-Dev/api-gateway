import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 0 });

export default redis;
