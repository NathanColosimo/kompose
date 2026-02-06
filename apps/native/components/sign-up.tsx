import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function SignUp() {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Create Account</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        <SocialAuthButtons mode="sign-up" />
      </CardContent>
    </Card>
  );
}

export { SignUp };
