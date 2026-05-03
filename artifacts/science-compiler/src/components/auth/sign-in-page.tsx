import { SignIn } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function getRedirectTarget(): string {
  if (typeof window === "undefined") return `${basePath}/`;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("redirect");
  if (!raw) return `${basePath}/`;
  try {
    const decoded = decodeURIComponent(raw);
    // Only allow same-origin internal paths to prevent open-redirects.
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return `${basePath}/`;
    return `${basePath}${decoded}`.replace(/\/{2,}/g, "/");
  } catch {
    return `${basePath}/`;
  }
}

export default function SignInPage() {
  const target = getRedirectTarget();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={target}
        forceRedirectUrl={target}
      />
    </div>
  );
}
