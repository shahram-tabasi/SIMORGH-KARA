import { passwordLoginEnabled } from "@/lib/oidc";
import { NewHoldingForm } from "./NewHoldingForm";

export const dynamic = "force-dynamic";

/** With Keycloak sign-in only, no password is asked: the new admin gets an email to set one. */
export default function NewHoldingPage() {
  return <NewHoldingForm askPassword={passwordLoginEnabled()} />;
}
