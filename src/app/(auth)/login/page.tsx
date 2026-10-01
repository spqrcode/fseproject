import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Sign in" };
export default function Login() {
  return <section className="auth-panel"><h1>Welcome back.</h1><p className="intro">Sign in to your portfolio.</p><AuthForm mode="login" /><p className="auth-switch">New here? <Link href="/register">Create an account</Link></p></section>;
}
