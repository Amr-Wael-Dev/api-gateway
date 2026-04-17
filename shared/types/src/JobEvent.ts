export const Q_AUTH_USER_REGISTERED = "auth:user:registered";

export interface UserRegisteredPayload {
  id: string;
  email: string;
}

export interface BaseJobData<T = unknown> {
  timestamp: Date;
  payload: T;
  correlationId?: string;
}
