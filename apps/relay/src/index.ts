export * from "./crypto";
export * from "./audit";
export * from "./config";
export * from "./hostRegistration";
export * from "./http";
export * from "./login";
export * from "./metadataStore";
export * from "./pairing";
export * from "./repository";
export * from "./postgresMigrations";
export * from "./security";
export * from "./time";
export * from "./server";
export * from "./tunnelFrames";
export * from "./tunnelRegistry";
export * from "./types";

if (import.meta.main) {
  const { createRelayServer } = await import("./server");
  const relay = createRelayServer();
  const address = await relay.listen();
  console.log(`Relay listening on http://${address.host}:${address.port}`);
}
