"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });
    setSubmitting(false);

    if (result?.error) {
      setError("Incorrect email or password.");
      return;
    }
    router.push("/collections/misfitz");
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-title mb-4 text-xl font-semibold">Log in</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-md border border-page-border bg-card-bg px-3 py-2 text-title"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-md border border-page-border bg-card-bg px-3 py-2 text-title"
        />
        {error && <p className="text-bad text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-card-border bg-card-bg px-3 py-2 text-title disabled:opacity-50"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="text-subtle mt-4 text-sm">
        No account?{" "}
        <Link href="/signup" className="text-title underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
