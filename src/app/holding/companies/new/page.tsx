import { passwordLoginEnabled } from "@/lib/oidc";
import { NewSectionForm } from "./NewSectionForm";

export const dynamic = "force-dynamic";

/** With Keycloak sign-in only, no password is asked: the new admin gets an email to set one. */
export default function NewSectionPage() {
  return <NewSectionForm askPassword={passwordLoginEnabled()} />;
}
