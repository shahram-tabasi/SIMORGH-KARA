import { passwordLoginEnabled } from "@/lib/oidc";
import { NewCompanyForm } from "./NewCompanyForm";

export const dynamic = "force-dynamic";

/** With Keycloak sign-in only, no password is asked: the new admin gets an email to set one. */
export default function NewCompanyPage() {
  return <NewCompanyForm askPassword={passwordLoginEnabled()} />;
}
