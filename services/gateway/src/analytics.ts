import { z } from "zod";
import { subgraphServiceType } from "./constant";

export interface AnalyticsEngine {
  writeDataPoint(input: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

export type Analytics = ReturnType<typeof createAnalytics>;

type Event = {
  type: "key-usage";
  value: {
    type: "cache-hit" | "cache-write";
    version: "v1";
    key: string;
    operationName: string;
    service: z.infer<typeof subgraphServiceType>;
    name: string;
    identifier: string;
    country: string | null;
    city: string | null;
    latitude: string | null;
    longitude: string | null;
  };
};

export function createAnalytics(engines: { keyUsage: AnalyticsEngine }) {
  return {
    track(event: Event) {
      if (!engines) {
        return;
      }

      const latitude = event.value.latitude || "unknownLatitude";
      const longitude = event.value.longitude || "unknownLongitude";
      const country = event.value.country || "unknownCountry";
      const city = event.value.city || "unknownCity";

      switch (event.type) {
        case "key-usage":
          switch (event.value.type) {
            case "cache-hit":
              return engines.keyUsage.writeDataPoint({
                blobs: [
                  "cache-hit",
                  event.value.version,
                  event.value.key,
                  event.value.operationName,
                  event.value.service,
                  event.value.name,
                  event.value.identifier,
                  latitude,
                  longitude,
                  country,
                  city,
                ],
                indexes: [event.value.key],
              });
            case "cache-write":
              return engines.keyUsage.writeDataPoint({
                blobs: [
                  "cache-write",
                  event.value.version,
                  event.value.key,
                  event.value.operationName,
                  event.value.service,
                  event.value.name,
                  event.value.identifier,
                  latitude,
                  longitude,
                  country,
                  city,
                ],
                indexes: [event.value.key],
              });
          }
      }
    },
  };
}
