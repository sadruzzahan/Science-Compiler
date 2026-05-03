import { Link, useLocation } from "wouter";
import { BookOpen, FileText, FlaskConical, LayoutDashboard, Search, Settings } from "lucide-react";
import { Show } from "@clerk/react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/user-menu";
import { BudgetBanner } from "@/components/usage-status";
import { useCurrentUser } from "@/hooks/use-current-user";

interface LayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: user } = useCurrentUser();

  const navigation = [
    { name: "Query", href: "/", icon: Search },
    { name: "Topics", href: "/topics", icon: LayoutDashboard },
    { name: "Papers", href: "/papers", icon: FileText },
    { name: "Claims", href: "/claims", icon: FlaskConical },
  ];

  const adminNavigation = [
    { name: "Ingestion", href: "/admin/ingestion", icon: Settings },
  ];

  const isAdmin = user?.role === "admin";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r bg-sidebar flex-shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b">
          <BookOpen className="h-6 w-6 text-primary mr-2" />
          <span className="font-bold text-lg text-sidebar-foreground tracking-tight">ScienceCompiler</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.name} href={item.href} className="block" data-testid={`nav-${item.name.toLowerCase()}`}>
                <div
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon
                    className={cn(
                      "mr-3 flex-shrink-0 h-5 w-5",
                      isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/50"
                    )}
                    aria-hidden="true"
                  />
                  {item.name}
                </div>
              </Link>
            );
          })}
          <Show when="signed-in">
            {isAdmin && (
              <div className="pt-4 mt-4 border-t border-sidebar-border">
                <p className="px-3 mb-1 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">Admin</p>
                {adminNavigation.map((item) => {
                  const isActive = location.startsWith(item.href);
                  return (
                    <Link key={item.name} href={item.href} className="block" data-testid={`nav-admin-${item.name.toLowerCase()}`}>
                      <div
                        className={cn(
                          "flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <item.icon
                          className={cn(
                            "mr-3 flex-shrink-0 h-5 w-5",
                            isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/50"
                          )}
                          aria-hidden="true"
                        />
                        {item.name}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Show>
        </nav>
        <div className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/50">
          Knowledge Base v1.0
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b bg-background/80 backdrop-blur flex items-center justify-end px-6 flex-shrink-0">
          <UserMenu />
        </header>
        <BudgetBanner />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
