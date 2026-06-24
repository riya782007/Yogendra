import { loginAction } from "@/app/actions/auth";
import { PasscodeInput } from "@/components/PasscodeInput";

export const metadata = { title: "Owner Login", robots: { index: false } };

export default function Login({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-b from-cream to-ivory px-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="font-display text-4xl text-ink">Blythe Diva</p>
          <p className="text-[10px] tracking-[0.3em] uppercase text-gold-dark mt-1">Owner Console</p>
        </div>
        <form action={loginAction} className="bg-white rounded-2xl shadow-luxe p-7">
          <h1 className="font-medium text-ink mb-1">Sign in</h1>
          <p className="text-xs text-muted mb-5">Enter your passcode. The owner passcode unlocks everything; a staff passcode opens only that role's permitted sections.</p>
          <input type="hidden" name="next" value={searchParams.next ?? "/admin/dashboard"} />
          <PasscodeInput autoFocus placeholder="Owner or staff passcode"
            className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald transition-colors" />
          {searchParams.error && <p className="text-sm text-rose mt-2">Incorrect passcode. Try again.</p>}
          <button className="btn-primary w-full mt-4 py-3 text-sm font-medium">Sign in</button>
          <p className="text-[11px] text-muted/70 mt-4 text-center">Owner demo passcode: <span className="font-mono">blythe2026</span> · staff passcodes are on the Roles page</p>
        </form>
      </div>
    </main>
  );
}
