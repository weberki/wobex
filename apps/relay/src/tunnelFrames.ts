import { Schema } from "effect";

import {
  RelayHostTunnelFrame,
  type RelayHostTunnelFrame as RelayHostTunnelFrameType,
} from "@wobex/contracts";

const decodeTunnelFrame = Schema.decodeUnknownSync(RelayHostTunnelFrame);

export type TunnelFrame = RelayHostTunnelFrameType;

export function isTunnelFrame(value: unknown): value is TunnelFrame {
  try {
    decodeTunnelFrame(value);
    return true;
  } catch {
    return false;
  }
}

export function validateTunnelFrame(
  frame: unknown,
): { ok: true; frame: TunnelFrame } | { ok: false; error: string } {
  try {
    return { ok: true, frame: decodeTunnelFrame(frame) };
  } catch {
    return { ok: false, error: "Invalid tunnel frame" };
  }
}
