import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Layer } from "effect";
import { TestClock } from "effect/testing";

import { runProcess } from "../../processRunner.ts";
import { RepositoryIdentityResolver } from "../Services/RepositoryIdentityResolver.ts";
import {
  makeRepositoryIdentityResolver,
  RepositoryIdentityResolverLive,
} from "./RepositoryIdentityResolver.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.promise(() => runProcess("git", ["-C", cwd, ...args]));

const makeRepositoryIdentityResolverTestLayer = (options: {
  readonly positiveCacheTtl?: Duration.Input;
  readonly negativeCacheTtl?: Duration.Input;
}) =>
  Layer.effect(
    RepositoryIdentityResolver,
    makeRepositoryIdentityResolver({
      cacheCapacity: 16,
      ...options,
    }),
  );

it.layer(NodeServices.layer)("RepositoryIdentityResolverLive", (it) => {
  it.effect("normalizes equivalent GitHub remotes into a stable repository identity", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-repository-identity-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:weberki/wobex.git"]);

      const resolver = yield* RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("github.com/weberki/wobex");
      expect(identity?.displayName).toBe("weberki/wobex");
      expect(identity?.provider).toBe("github");
      expect(identity?.owner).toBe("weberki");
      expect(identity?.name).toBe("wobex");
    }).pipe(Effect.provide(RepositoryIdentityResolverLive)),
  );

  it.effect("returns null for non-git folders and repos without remotes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const nonGitDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-repository-identity-non-git-",
      });
      const gitDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-repository-identity-no-remote-",
      });

      yield* git(gitDir, ["init"]);

      const resolver = yield* RepositoryIdentityResolver;
      const nonGitIdentity = yield* resolver.resolve(nonGitDir);
      const noRemoteIdentity = yield* resolver.resolve(gitDir);

      expect(nonGitIdentity).toBeNull();
      expect(noRemoteIdentity).toBeNull();
    }).pipe(Effect.provide(RepositoryIdentityResolverLive)),
  );

  it.effect("prefers upstream over origin when both remotes are configured", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-repository-identity-upstream-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:octocat/other.git"]);
      yield* git(cwd, ["remote", "add", "upstream", "git@github.com:weberki/wobex.git"]);

      const resolver = yield* RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.locator.remoteName).toBe("upstream");
      expect(identity?.canonicalKey).toBe("github.com/weberki/wobex");
      expect(identity?.displayName).toBe("weberki/wobex");
    }).pipe(Effect.provide(RepositoryIdentityResolverLive)),
  );

  it.effect("uses the last remote path segment as the repository name for nested groups", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-repository-identity-nested-group-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@gitlab.com:weberki/platform/wobex.git"]);

      const resolver = yield* RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("gitlab.com/weberki/platform/wobex");
      expect(identity?.displayName).toBe("weberki/platform/wobex");
      expect(identity?.owner).toBe("weberki");
      expect(identity?.name).toBe("wobex");
    }).pipe(Effect.provide(RepositoryIdentityResolverLive)),
  );

  it.effect(
    "refreshes cached null identities after the negative TTL when a remote is configured later",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "wobex-repository-identity-late-remote-test-",
        });

        yield* git(cwd, ["init"]);

        const resolver = yield* RepositoryIdentityResolver;
        const initialIdentity = yield* resolver.resolve(cwd);
        expect(initialIdentity).toBeNull();

        yield* git(cwd, ["remote", "add", "origin", "git@github.com:weberki/wobex.git"]);

        const cachedIdentity = yield* resolver.resolve(cwd);
        expect(cachedIdentity).toBeNull();

        yield* TestClock.adjust(Duration.millis(120));

        const refreshedIdentity = yield* resolver.resolve(cwd);
        expect(refreshedIdentity).not.toBeNull();
        expect(refreshedIdentity?.canonicalKey).toBe("github.com/weberki/wobex");
        expect(refreshedIdentity?.name).toBe("wobex");
      }).pipe(
        Effect.provide(
          Layer.merge(
            TestClock.layer(),
            makeRepositoryIdentityResolverTestLayer({
              negativeCacheTtl: Duration.millis(50),
              positiveCacheTtl: Duration.seconds(1),
            }),
          ),
        ),
      ),
  );

  it.effect("refreshes cached identities after the positive TTL when a remote changes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-repository-identity-remote-change-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:weberki/wobex.git"]);

      const resolver = yield* RepositoryIdentityResolver;
      const initialIdentity = yield* resolver.resolve(cwd);
      expect(initialIdentity).not.toBeNull();
      expect(initialIdentity?.canonicalKey).toBe("github.com/weberki/wobex");

      yield* git(cwd, ["remote", "set-url", "origin", "git@github.com:weberki/wobex-next.git"]);

      const cachedIdentity = yield* resolver.resolve(cwd);
      expect(cachedIdentity).not.toBeNull();
      expect(cachedIdentity?.canonicalKey).toBe("github.com/weberki/wobex");

      yield* TestClock.adjust(Duration.millis(180));

      const refreshedIdentity = yield* resolver.resolve(cwd);
      expect(refreshedIdentity).not.toBeNull();
      expect(refreshedIdentity?.canonicalKey).toBe("github.com/weberki/wobex-next");
      expect(refreshedIdentity?.displayName).toBe("weberki/wobex-next");
      expect(refreshedIdentity?.name).toBe("wobex-next");
    }).pipe(
      Effect.provide(
        Layer.merge(
          TestClock.layer(),
          makeRepositoryIdentityResolverTestLayer({
            negativeCacheTtl: Duration.millis(50),
            positiveCacheTtl: Duration.millis(100),
          }),
        ),
      ),
    ),
  );
});
