"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { AuthCard, Field, FormError, SubmitButton } from "../ui";

type ApiError = { message?: string; issues?: Array<{ path: string[]; message: string }> };

const FIELD_LABELS: Record<string, string> = {
  organizationName: "Organization name",
  organizationSlug: "Organization ID",
  ownerEmail: "Email",
  password: "Password",
};

function describe(err: ApiError, status: number): string {
  if (status === 409) return "That organization ID is taken. Choose another.";
  const issue = err.issues?.[0];
  if (issue) return `${FIELD_LABELS[issue.path[0]] ?? issue.path[0]}: ${issue.message}`;
  return err.message ?? "Something went wrong. Try again.";
}

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setError(describe(await res.json().catch(() => ({})), res.status));
      setPending(false);
      return;
    }

    const login = await signIn("credentials", {
      organizationSlug: form.organizationSlug,
      email: form.ownerEmail,
      password: form.password,
      redirect: false,
    });
    setPending(false);
    router.push(login?.error ? "/login" : "/dashboard");
    router.refresh();
  }

  return (
    <AuthCard title="Create an organization" subtitle="You'll be its owner. You can invite others later.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Organization name" name="organizationName" required minLength={2} placeholder="Acme Inc." />
        <Field
          label="Organization ID"
          name="organizationSlug"
          required
          pattern="[a-z0-9][a-z0-9\-]{1,46}[a-z0-9]"
          placeholder="acme"
          hint="Used to sign in. Lowercase letters, numbers and hyphens."
        />
        <Field label="Your name" name="ownerName" autoComplete="name" />
        <Field label="Email" name="ownerEmail" type="email" required autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          hint="At least 10 characters."
        />
        <FormError message={error} />
        <SubmitButton pending={pending}>Create organization</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
