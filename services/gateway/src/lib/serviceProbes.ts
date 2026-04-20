import { Service, ServiceCheckResult } from "@shared/types";

export async function probeServices(
  services: Service[],
  endpoint: "health" | "ready",
  interServiceToken: string,
): Promise<ServiceCheckResult[]> {
  return Promise.all(
    services.map(async ({ name, url }) => {
      try {
        const response = await fetch(`${url}/${endpoint}`, {
          headers: { "x-inter-service-token": interServiceToken },
        });
        const body = await response.json();
        const status = response.ok ? "ok" : "error";
        if (Array.isArray(body)) {
          return { name, status, checks: body };
        }
        return { name, status };
      } catch {
        return { name, status: "error" };
      }
    }),
  );
}
