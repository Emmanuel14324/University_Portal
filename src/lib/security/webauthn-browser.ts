"use client";

import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "WebAuthn request failed.";
    throw new Error(message);
  }
  return payload as T;
}

export async function registerPasskey(deviceName?: string) {
  const options = await postJson<PublicKeyCredentialCreationOptionsJSON>(
    "/api/webauthn/register/options",
  );
  const response = await startRegistration({ optionsJSON: options });
  return postJson<{ verified: true; nextStep: string }>(
    "/api/webauthn/register/verify",
    { response, deviceName },
  );
}

export async function authenticateWithPasskey() {
  const options = await postJson<PublicKeyCredentialRequestOptionsJSON>(
    "/api/webauthn/authenticate/options",
  );
  const response = await startAuthentication({ optionsJSON: options });
  return postJson<{ verified: true; nextStep: string }>(
    "/api/webauthn/authenticate/verify",
    { response },
  );
}
