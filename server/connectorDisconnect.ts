import { userConnectorAccounts } from "../drizzle/schema";
import {
  deleteConnectorAuthorization,
  disconnectUserConnectorAccount,
  getConnectorAuthorization,
} from "./db";
import {
  decryptConnectorToken,
  isOAuthConnectorProvider,
  type OAuthConnectorProvider,
} from "./connectorOAuth";
import {
  revokeConnectorGrant,
  type ConnectorRevocationResult,
  getConnectorRevocationInstruction,
} from "./connectorRevocation";
import {
  completeConnectorRevocationObligation,
  getOpenConnectorRevocationObligation,
  recordConnectorRevocationObligation,
} from "./connectorRevocationObligations";

type ConnectorProvider = typeof userConnectorAccounts.$inferInsert.provider;
type Revoker = (
  provider: OAuthConnectorProvider,
  accessToken: string
) => Promise<ConnectorRevocationResult>;

function safeRevocationFailureCode(error: unknown) {
  if (error instanceof TypeError) return "network_failure" as const;
  if (error instanceof Error && /decrypt|encryption|credential|configured/i.test(error.message)) {
    return "credential_unavailable" as const;
  }
  return "provider_rejected" as const;
}

export async function disconnectConnectorAccess(
  userId: number,
  provider: ConnectorProvider,
  revoker: Revoker = revokeConnectorGrant
) {
  const account = await disconnectUserConnectorAccount(userId, provider);
  let providerRevocation = {
    status: "not_needed" as
      "not_needed" | "revoked" | "manual_required" | "failed",
    detail: "No stored OAuth grant was present.",
  };
  const authorization = isOAuthConnectorProvider(provider)
    ? await getConnectorAuthorization(userId, provider)
    : null;

  if (!authorization && isOAuthConnectorProvider(provider)) {
    const obligation = await getOpenConnectorRevocationObligation(userId, provider);
    if (obligation) {
      providerRevocation = {
        status: obligation.status === "manual_required" ? "manual_required" : "failed",
        detail: getConnectorRevocationInstruction(provider),
      };
    }
    return { account, providerRevocation };
  }

  if (authorization && isOAuthConnectorProvider(provider)) {
    try {
      providerRevocation = await revoker(
        provider,
        decryptConnectorToken(authorization.encryptedAccessToken)
      );
      const affectedProviders =
        provider === "gmail" || provider === "google_drive"
          ? (["gmail", "google_drive"] as const)
          : ([provider] as const);

      if (providerRevocation.status === "manual_required") {
        await recordConnectorRevocationObligation({
          userId,
          provider,
          status: "manual_required",
        });
      } else {
        for (const affectedProvider of affectedProviders) {
          await completeConnectorRevocationObligation(
            userId,
            affectedProvider,
            "provider_api_confirmed"
          );
        }
      }

      await Promise.all(
        affectedProviders.map(async affectedProvider => {
          await deleteConnectorAuthorization(userId, affectedProvider);
          if (affectedProvider !== provider) {
            await disconnectUserConnectorAccount(userId, affectedProvider);
          }
        })
      );
    } catch (error) {
      providerRevocation = {
        status: "failed",
        detail: "Provider revocation could not be confirmed. Hire.AI access is disabled and the encrypted grant was retained for retry.",
      };
      await recordConnectorRevocationObligation({
        userId,
        provider,
        status: "retry_required",
        lastErrorCode: safeRevocationFailureCode(error),
      });
    }
  }

  return { account, providerRevocation };
}
