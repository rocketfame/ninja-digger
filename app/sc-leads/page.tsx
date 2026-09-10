import { redirect } from "next/navigation";

/** Two engines, two tabs; the bare URL lands on the original one. */
export default function ScLeadsIndex() {
  redirect("/sc-leads/reex");
}
