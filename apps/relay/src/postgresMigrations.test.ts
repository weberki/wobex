import { describe, expect, it } from "vitest";

import {
  assertRelayMigrationsAreMetadataOnly,
  relayPostgresMigrations,
} from "./postgresMigrations";

describe("relayPostgresMigrations", () => {
  it("defines the V2 metadata tables and no content tables", () => {
    const sql = relayPostgresMigrations.map((migration) => migration.sql).join("\n");

    expect(sql).toContain("create table if not exists users");
    expect(sql).toContain("create table if not exists login_challenges");
    expect(sql).toContain("create table if not exists user_sessions");
    expect(sql).toContain("create table if not exists devices");
    expect(sql).toContain("create table if not exists hosts");
    expect(sql).toContain("create table if not exists host_pairing_intents");
    expect(sql).toContain("create table if not exists host_grants");
    expect(sql).toContain("create table if not exists host_registration_tokens");
    expect(sql).toContain("create table if not exists host_statuses");
    expect(sql).toContain("create table if not exists audit_events");
    expect(sql).not.toContain("registration_token text");
    expect(() => assertRelayMigrationsAreMetadataOnly()).not.toThrow();
  });
});
