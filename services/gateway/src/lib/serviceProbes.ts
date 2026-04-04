interface Service {
  name: string;
  url: string;
}

interface ServiceCheckResult {
  name: string;
  status: "ok" | "error" | "unreachable";
}

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
        return { name, status: response.ok ? "ok" : "error", ...body };
      } catch {
        return { name, status: "unreachable" };
      }
    }),
  );
}
