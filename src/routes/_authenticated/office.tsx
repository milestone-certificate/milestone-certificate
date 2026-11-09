import { createFileRoute, redirect } from "@tanstack/react-router";
import { homeForRoles } from "@/lib/roles";

// Keep old bookmarks working without exposing the removed office information.
export const Route = createFileRoute("/_authenticated/office")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: homeForRoles(context.roles), replace: true });
  },
});
