import { useClerk } from "@clerk/react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AccountPage() {
  const { signOut } = useClerk();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!user) return <div className="p-8">No account loaded.</div>;

  const initials = (user.firstName?.[0] ?? user.email[0] ?? "?").toUpperCase();

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-muted-foreground mt-1">Manage your profile and session.</p>
      </div>
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold">
            {user.imageUrl ? (
              <img src={user.imageUrl} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">
              {user.firstName || user.lastName ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "User"}
            </div>
            <div className="text-sm text-muted-foreground truncate">{user.email}</div>
            <div className="mt-2 flex gap-2">
              <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
              <Badge variant={user.status === "active" ? "outline" : "destructive"}>{user.status}</Badge>
            </div>
          </div>
        </div>
        <div className="pt-4 border-t flex gap-2">
          <Button
            variant="outline"
            onClick={() => signOut({ redirectUrl: `${basePath}/` })}
            data-testid="button-sign-out"
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
