import { redirect } from "next/navigation";

// Root route redirects straight to Mission Control.
export default function RootPage() {
  redirect("/mission-control");
}
