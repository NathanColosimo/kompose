import { env } from "@kompose/env";
import { SocialAccountButtons } from "./social-account-buttons";

export default function SignInForm() {
  const privacyHref =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
      ? `${env.NEXT_PUBLIC_WEB_URL}/privacy`
      : "/privacy";
  const termsHref =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
      ? `${env.NEXT_PUBLIC_WEB_URL}/terms`
      : "/terms";

  return (
    <section className="space-y-6 rounded-3xl border border-border/60 bg-card/80 p-8 shadow-lg">
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.35em]">
          Sign in
        </p>
        <h2 className="font-serif text-3xl">Welcome back</h2>
        <p className="text-muted-foreground text-sm">
          Your timeline and integrations are ready.
        </p>
      </div>
      <SocialAccountButtons mode="sign-in" />
      <p className="text-center text-muted-foreground text-xs">
        By continuing you agree to the Kompose{" "}
        <a className="underline underline-offset-4" href={termsHref}>
          Terms of Service
        </a>{" "}
        and{" "}
        <a className="underline underline-offset-4" href={privacyHref}>
          Privacy Policy
        </a>
        .
      </p>
    </section>
  );
}
