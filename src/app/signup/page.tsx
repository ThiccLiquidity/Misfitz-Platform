"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong creating your account.");
      setSubmitting(false);
      return;
    }

    await signIn("credentials", { email, password, redirect: false });
    setSubmitting(false);
    router.push("/collections/misfitz");
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-title mb-4 text-xl font-semibold">Create your account</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="rounded-md border border-page-border bg-card-bg px-3 py-2 text-title"
        />
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
          minLength={8}
          className="rounded-md border border-page-border bg-card-bg px-3 py-2 text-title"
        />
        {error && <p className="text-bad text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-card-border bg-card-bg px-3 py-2 text-title disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="text-subtle mt-4 text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-title underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
