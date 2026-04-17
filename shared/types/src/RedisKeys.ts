export const getBlocklistRedisName = (jti: string) => `auth:blocklist:${jti}`;
export const getRefreshTokenRedisName = (token: string) =>
  `auth:refresh-token:${token}`;
