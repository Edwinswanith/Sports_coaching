import { redirect } from "next/navigation";

// Bare /login has no role context — send users to the role chooser at "/".
export default function LoginIndexPage() {
  redirect("/");
}
