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
} from "./connectorRevocation";

type ConnectorProvider = typeof userConnectorAccounts.$inferInsert.provider;
type Revoker = (
  provider: OAuthConnectorProvider,
  accessToken: string
) => Promise<ConnectorRevocationResult>;

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
      await Promise.all(
        affectedProviders.map(async affectedProvider => {
          await deleteConnectorAuthorization(userId, affectedProvider);
          if (affectedProvider !== provider) {
            await disconnectUserConnectorAccount(userId, affectedProvider);
          }
        })
      );
    } catch {
      providerRevocation = {
        status: "failed",
        detail:
          "Provider revocation failed. Hire.AI access is disabled, but the encrypted grant was retained so revocation can be retried.",
      };
    }
  }

  return { account, providerRevocation };
}
