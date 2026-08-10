import type { MailAccount, MailProvider } from "@subzero/mail";

import { MailRouteError } from "./_shared";

/** A provider is always bound to the same account resolved by trusted server auth. */
export type AccountBoundMailProvider = MailProvider & {
  readonly account: MailAccount;
};

export interface MailRouteContext {
  account: MailAccount;
  provider: AccountBoundMailProvider;
}

export type MailRouteContextResolver = (
  request: Request,
) => MailRouteContext | null | Promise<MailRouteContext | null>;

const noAuthenticatedMailContext: MailRouteContextResolver = () => null;
let resolveMailRouteContext: MailRouteContextResolver =
  noAuthenticatedMailContext;

/**
 * OAuth/session wiring supplies this resolver. The default rejects requests so
 * no client-controlled account ID can select another user's mailbox.
 */
export function configureMailRouteContextResolver(
  resolver: MailRouteContextResolver,
): void {
  resolveMailRouteContext = resolver;
}

/** Test-only reset point; production starts with no authenticated mail context. */
export function resetMailRouteContextResolverForTests(): void {
  resolveMailRouteContext = noAuthenticatedMailContext;
}

export async function requireMailRouteContext(
  request: Request,
): Promise<MailRouteContext> {
  // Routes can be invoked in a fresh server worker before an OAuth callback
  // module has executed. Lazily load the trusted resolver in that case rather
  // than treating a valid HttpOnly session as client-controlled state.
  const context = await (resolveMailRouteContext === noAuthenticatedMailContext
    ? import("../auth/google/oauth").then(
        ({ resolveAuthenticatedMailRouteContext }) =>
          resolveAuthenticatedMailRouteContext(request),
      )
    : resolveMailRouteContext(request));
  if (!context) {
    throw new MailRouteError(
      "ACCOUNT_REQUIRED",
      "Connect Gmail before using mail actions.",
      401,
    );
  }

  if (
    context.provider.account.id !== context.account.id ||
    context.provider.account.googleSubject !== context.account.googleSubject
  ) {
    throw new MailRouteError(
      "ACCOUNT_MISMATCH",
      "Mail account authorization is invalid.",
      403,
    );
  }

  return context;
}
