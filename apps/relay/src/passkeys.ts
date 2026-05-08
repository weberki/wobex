import { TextEncoder } from "node:util";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

export interface RelayPasskeyProvider {
  beginRegistration(input: {
    readonly rpId: string;
    readonly rpName: string;
    readonly userId: string;
    readonly email: string;
    readonly displayName: string;
    readonly excludeCredentialIds: readonly string[];
  }): Promise<{
    readonly challenge: string;
    readonly options: PublicKeyCredentialCreationOptionsJSON | Record<string, unknown>;
  }>;
  verifyRegistration(input: {
    readonly rpId: string;
    readonly expectedOrigin: string | readonly string[];
    readonly expectedChallenge: string;
    readonly response: RegistrationResponseJSON | Record<string, unknown>;
  }): Promise<{
    readonly credentialId: string;
    readonly publicKey: string;
    readonly counter: number;
    readonly transports: string[];
    readonly backedUp: boolean;
  }>;
  beginAuthentication(input: {
    readonly rpId: string;
    readonly allowCredentialIds: readonly string[];
  }): Promise<{
    readonly challenge: string;
    readonly options: PublicKeyCredentialRequestOptionsJSON | Record<string, unknown>;
  }>;
  verifyAuthentication(input: {
    readonly rpId: string;
    readonly expectedOrigin: string | readonly string[];
    readonly expectedChallenge: string;
    readonly response: AuthenticationResponseJSON | Record<string, unknown>;
    readonly credential: {
      readonly credentialId: string;
      readonly publicKey: string;
      readonly counter: number;
      readonly transports: readonly string[];
    };
  }): Promise<{
    readonly credentialId: string;
    readonly newCounter: number;
    readonly backedUp: boolean;
  }>;
}

const DEFAULT_RP_NAME = "Wobex Relay";

function normalizeExpectedOrigins(expectedOrigin: string | readonly string[]): string[] {
  if (typeof expectedOrigin === "string") {
    return [expectedOrigin];
  }
  return [...new Set(expectedOrigin)];
}

export class SimpleWebAuthnPasskeyProvider implements RelayPasskeyProvider {
  async beginRegistration(input: {
    readonly rpId: string;
    readonly rpName: string;
    readonly userId: string;
    readonly email: string;
    readonly displayName: string;
    readonly excludeCredentialIds: readonly string[];
  }) {
    const options = await generateRegistrationOptions({
      rpID: input.rpId,
      rpName: input.rpName || DEFAULT_RP_NAME,
      userID: new TextEncoder().encode(input.userId),
      userName: input.email,
      userDisplayName: input.displayName,
      excludeCredentials: input.excludeCredentialIds.map((id) => ({
        id,
        transports: ["internal"] satisfies AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      preferredAuthenticatorType: "localDevice",
    });

    return {
      challenge: options.challenge,
      options,
    };
  }

  async verifyRegistration(input: {
    readonly rpId: string;
    readonly expectedOrigin: string | readonly string[];
    readonly expectedChallenge: string;
    readonly response: RegistrationResponseJSON | Record<string, unknown>;
  }) {
    const verified = await verifyRegistrationResponse({
      response: input.response as RegistrationResponseJSON,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: normalizeExpectedOrigins(input.expectedOrigin),
      expectedRPID: input.rpId,
      requireUserVerification: true,
    });
    if (!verified.verified) {
      throw new Error("Passkey registration could not be verified");
    }
    return {
      credentialId: verified.registrationInfo.credential.id,
      publicKey: Buffer.from(verified.registrationInfo.credential.publicKey).toString("base64url"),
      counter: verified.registrationInfo.credential.counter,
      transports: verified.registrationInfo.credential.transports ?? [],
      backedUp: verified.registrationInfo.credentialBackedUp,
    };
  }

  async beginAuthentication(input: {
    readonly rpId: string;
    readonly allowCredentialIds: readonly string[];
  }) {
    const options = await generateAuthenticationOptions({
      rpID: input.rpId,
      ...(input.allowCredentialIds.length > 0
        ? {
            allowCredentials: input.allowCredentialIds.map((id) => ({
              id,
              transports: ["internal"] as AuthenticatorTransportFuture[],
            })),
          }
        : {}),
      userVerification: "required",
    });
    return {
      challenge: options.challenge,
      options,
    };
  }

  async verifyAuthentication(input: {
    readonly rpId: string;
    readonly expectedOrigin: string | readonly string[];
    readonly expectedChallenge: string;
    readonly response: AuthenticationResponseJSON | Record<string, unknown>;
    readonly credential: {
      readonly credentialId: string;
      readonly publicKey: string;
      readonly counter: number;
      readonly transports: readonly string[];
    };
  }) {
    const verified = await verifyAuthenticationResponse({
      response: input.response as AuthenticationResponseJSON,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: normalizeExpectedOrigins(input.expectedOrigin),
      expectedRPID: input.rpId,
      credential: {
        id: input.credential.credentialId,
        publicKey: Buffer.from(input.credential.publicKey, "base64url"),
        counter: input.credential.counter,
        transports: input.credential.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
    if (!verified.verified) {
      throw new Error("Passkey authentication could not be verified");
    }
    return {
      credentialId: verified.authenticationInfo.credentialID,
      newCounter: verified.authenticationInfo.newCounter,
      backedUp: verified.authenticationInfo.credentialBackedUp,
    };
  }
}

export function createRelayPasskeyProvider(): RelayPasskeyProvider {
  return new SimpleWebAuthnPasskeyProvider();
}
