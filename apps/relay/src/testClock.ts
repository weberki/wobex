import type { Clock } from "./time";

export class TestClock implements Clock {
  #now: Date;

  constructor(initialIso = "2026-01-01T00:00:00.000Z") {
    this.#now = new Date(initialIso);
  }

  now(): Date {
    return new Date(this.#now.getTime());
  }

  advanceMs(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}
