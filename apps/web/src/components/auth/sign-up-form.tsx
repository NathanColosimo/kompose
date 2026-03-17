import { env } from "@kompose/env";
import { SocialAccountButtons } from "./social-account-buttons";

export default function SignUpForm() {
  const privacyHref =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
      ? `${env.NEXT_PUBLIC_WEB_URL}/privacy`
      : "/privacy";
  const termsHref =
    env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
      ? `${env.NEXT_PUBLIC_WEB_URL}/terms`
      : "/terms";

  return (
    <section className="space-y-6 rounded-3xl border border-border/60 bg-card/60 p-8 shadow-md">
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.35em]">
          Create account
        </p>
        <h2 className="font-serif text-3xl">Create your Kompose workspace</h2>
        <p className="text-muted-foreground text-sm">
          Connect Google or Apple to get calendar sync, tasks, and AI
          orchestration in minutes.
        </p>
      </div>
      <SocialAccountButtons mode="sign-up" />
      <p className="text-center text-muted-foreground text-xs">
        No passwords to manage. Review the{" "}
        <a className="underline underline-offset-4" href={privacyHref}>
          Privacy Policy
        </a>{" "}
        and{" "}
        <a className="underline underline-offset-4" href={termsHref}>
          Terms of Service
        </a>
        , and you can revoke access anytime from your linked provider settings.
      </p>
    </section>
  );
}
