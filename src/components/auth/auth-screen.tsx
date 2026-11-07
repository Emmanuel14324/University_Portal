import Link from "next/link";
import { LoginFlow } from "@/components/auth/login-flow";

type AuthScreenProps = {
  screen: "login" | "recovery" | "otp" | "biometric";
};

const copy = {
  login: {
    title: "Welcome back",
    description: "Sign in to your St Jude student portal.",
  },
  recovery: {
    title: "Account recovery",
    description: "Get help regaining access to your university account.",
  },
  otp: {
    title: "Verify your account",
    description: "This is a preview of the future authenticator verification screen.",
  },
  biometric: {
    title: "Biometric sign-in",
    description: "This is a preview of the future passkey verification screen.",
  },
};

function Brand() {
  return (
    <Link className="brand auth-brand" href="/">
      <span className="brand-mark">SJ</span>
      <span>St Jude <strong>University</strong></span>
    </Link>
  );
}

function PreviewMessage() {
  return (
    <div className="auth-note">
      Preview only: authentication is not connected. Do not enter a real password or verification code.
    </div>
  );
}

export function AuthScreen({ screen }: AuthScreenProps) {
  const { title, description } = copy[screen];

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <Brand />
        {screen === "login" && <>
          <h1>{title}</h1>
          <p>{description}</p>
          <LoginFlow />
          <div className="auth-links"><span>Student account access</span><Link href="/recovery">Forgot password?</Link></div>
        </>}
        {screen === "recovery" && <>
          <h1>{title}</h1>
          <p>{description} Recovery flows will be connected after the account system is implemented.</p>
          <label className="auth-label" htmlFor="recovery-email">University email</label>
          <input className="auth-input" id="recovery-email" type="email" placeholder="name@stjude.ac.ug" autoComplete="off" />
          <button className="button button-primary auth-button" type="button" disabled>Continue with recovery</button>
          <div className="auth-links"><Link href="/login">← Back to sign in</Link><span>Contact the IT help desk</span></div>
          <PreviewMessage />
        </>}
        {screen === "otp" && <>
          <div className="factor-steps"><span className="factor-step">1 · Password</span><span className="factor-step active">2 · Authenticator</span><span className="factor-step">3 · Passkey</span></div>
          <span className="auth-symbol" aria-hidden="true">⌁</span>
          <h1>{title}</h1>
          <p>{description} No one-time codes are being generated or verified.</p>
          <label className="auth-label" htmlFor="otp-code">Six-digit code</label>
          <input className="auth-input code-input" id="otp-code" inputMode="numeric" placeholder="000 000" autoComplete="off" disabled />
          <button className="button button-primary auth-button" type="button" disabled>Verify code</button>
          <div className="auth-links"><Link href="/login">← Back to sign in</Link><span>Need help?</span></div>
          <PreviewMessage />
        </>}
        {screen === "biometric" && <>
          <div className="factor-steps"><span className="factor-step">1 · Password</span><span className="factor-step">2 · Authenticator</span><span className="factor-step active">3 · Passkey</span></div>
          <span className="auth-symbol biometric-symbol" aria-hidden="true">⌑</span>
          <h1>{title}</h1>
          <p>{description} Your device will not be prompted for a biometric in this prototype.</p>
          <div className="passkey-box"><span className="setting-icon">◉</span><span><b>Use a passkey</b><small>Face, fingerprint, or device PIN</small></span></div>
          <button className="button button-primary auth-button" type="button" disabled>Continue with passkey</button>
          <div className="auth-links"><Link href="/login">← Back to sign in</Link><span>Try another way</span></div>
          <PreviewMessage />
        </>}
      </section>
      <div className="auth-footer"><Link href="/">St Jude University</Link><span>Student portal · Preview</span></div>
    </main>
  );
}
