export const Q_AUTH_USER_REGISTERED = "auth:user:registered";

export interface UserRegisteredPayload {
  userId: string;
  email: string;
}

export interface BaseJobData<T = unknown> {
  id: string;
  timestamp: Date;
  payload: T;
  correlationId?: string;
}
