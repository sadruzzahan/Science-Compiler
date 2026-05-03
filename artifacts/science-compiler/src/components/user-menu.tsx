import { Link } from "wouter";
import { Show, useClerk } from "@clerk/react";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/use-current-user";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function UserMenu() {
  const { signOut } = useClerk();
  const { data: user } = useCurrentUser();

  return (
    <>
      <Show when="signed-out">
        <div className="flex items-center gap-2">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="button-sign-in">
              <LogIn className="h-4 w-4" /> Sign in
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm" data-testid="button-sign-up">Sign up</Button>
          </Link>
        </div>
      </Show>
      <Show when="signed-in">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 max-w-[180px]" data-testid="button-user-menu">
              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  (user?.firstName?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()
                )}
              </div>
              <span className="truncate text-sm">{user?.email ?? "Account"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium truncate">{user?.email}</span>
                <span className="text-xs text-muted-foreground">{user?.role}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/account">
              <DropdownMenuItem data-testid="menu-item-account">
                <UserIcon className="mr-2 h-4 w-4" /> Account
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ redirectUrl: `${basePath}/` })}
              data-testid="menu-item-sign-out"
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Show>
    </>
  );
}
