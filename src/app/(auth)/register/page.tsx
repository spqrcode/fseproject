import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create account" };
export default function Register() {
  return <section className="auth-panel"><h1>Create your account.</h1><p className="intro">Start with a workspace of your own.</p><AuthForm mode="register" /><p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p></section>;
}
