import { Schema } from "effect";

import {
  RelayHostTunnelFrame,
  type RelayHostTunnelFrame as RelayHostTunnelFrameType,
} from "@wobex/contracts";

import { type Clock, isoNow, systemClock } from "./time";

export interface RelayHostTunnelConnection {
  id: string;
  hostId: string;
  connectedAt: string;
  lastSeenAt: string;
  send(frame: RelayHostTunnelFrameType): void | Promise<void>;
}

export interface RelayTunnelFrameMetadata {
  hostId: string;
  deviceId?: string;
  requestId?: string;
  streamId?: string;
  statusCode?: number;
  byteCount?: number;
  type: RelayHostTunnelFrameType["type"];
  timestamp: string;
}

const decodeFrame = Schema.decodeUnknownSync(RelayHostTunnelFrame);

export class RelayTunnelRegistry {
  #clock: Clock;
  #connectionsByHostId = new Map<string, RelayHostTunnelConnection>();
  #frameMetadata: RelayTunnelFrameMetadata[] = [];

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  connect(input: {
    connectionId: string;
    hostId: string;
    send: RelayHostTunnelConnection["send"];
  }): RelayHostTunnelConnection {
    const now = isoNow(this.#clock);
    const connection: RelayHostTunnelConnection = {
      id: input.connectionId,
      hostId: input.hostId,
      connectedAt: now,
      lastSeenAt: now,
      send: input.send,
    };
    this.#connectionsByHostId.set(input.hostId, connection);
    return connection;
  }

  disconnect(hostId: string, connectionId?: string): boolean {
    const existing = this.#connectionsByHostId.get(hostId);
    if (!existing) {
      return false;
    }
    if (connectionId && existing.id !== connectionId) {
      return false;
    }
    this.#connectionsByHostId.delete(hostId);
    return true;
  }

  get(hostId: string): RelayHostTunnelConnection | undefined {
    return this.#connectionsByHostId.get(hostId);
  }

  require(hostId: string): RelayHostTunnelConnection {
    const connection = this.get(hostId);
    if (!connection) {
      throw new Error("host is offline");
    }
    return connection;
  }

  getHostState(hostId: string): "online" | "offline" {
    return this.#connectionsByHostId.has(hostId) ? "online" : "offline";
  }

  listOnlineHostIds(): readonly string[] {
    return [...this.#connectionsByHostId.keys()];
  }

  recordFrame(frameInput: unknown): RelayTunnelFrameMetadata {
    const frame = decodeFrame(frameInput);
    const metadata: RelayTunnelFrameMetadata = {
      hostId: frame.hostId,
      type: frame.type,
      timestamp: frame.timestamp.toString(),
    };
    if (frame.deviceId) {
      metadata.deviceId = frame.deviceId;
    }
    if (frame.requestId) {
      metadata.requestId = frame.requestId;
    }
    if (frame.streamId) {
      metadata.streamId = frame.streamId;
    }
    if (frame.type === "http.response") {
      metadata.statusCode = frame.payload.statusCode;
      if (frame.payload.byteCount !== undefined) {
        metadata.byteCount = frame.payload.byteCount;
      }
    }
    if (frame.type === "ws.message") {
      if (frame.payload.byteCount !== undefined) {
        metadata.byteCount = frame.payload.byteCount;
      }
    }
    this.#frameMetadata.push(metadata);
    return metadata;
  }

  listFrameMetadata(): readonly RelayTunnelFrameMetadata[] {
    return [...this.#frameMetadata];
  }
}
