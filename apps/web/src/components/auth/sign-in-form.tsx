import { SocialAccountButtons } from "./social-account-buttons";

export default function SignInForm() {
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
        By continuing you agree to the Kompose Terms and Privacy Policy.
      </p>
    </section>
  );
}
