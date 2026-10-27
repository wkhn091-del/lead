import { motion } from 'motion/react';
import { LoaderCircle, RotateCcw, WifiOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { appConfig } from '../config';
import { cn } from '../lib/cn';
import { EASE_OUT } from '../lib/motion';
import { useAuth } from '../store/auth';
import { BrandMark } from './BrandMark';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from './ui/ResponsiveDialog';
import { inputBase, inputSize } from './ui/styles';

const card = 'glass w-full max-w-[400px] rounded-[28px] px-6 py-8 sm:px-8 sm:py-9';
const enter = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: EASE_OUT },
};

/** Shown instead of the dashboard until the server confirms a session. */
export function AuthScreen() {
  const status = useAuth((s) => s.status);
  return (
    <main className="flex min-h-dvh items-center justify-center py-10">
      {status === 'checking' ? (
        <div role="status" aria-label="בודקים את החיבור שלך">
          <BrandMark className="size-12 animate-pulse" />
        </div>
      ) : status === 'unreachable' ? (
        <Unreachable />
      ) : (
        <SignInForm />
      )}
    </main>
  );
}

function Unreachable() {
  const check = useAuth((s) => s.check);
  return (
    <motion.div {...enter} className={card}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-field ring-1 ring-line ring-inset">
        <WifiOff className="size-5 text-fg-muted" aria-hidden />
      </span>
      <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">אין חיבור לשרת</h1>
      <p className="mt-1.5 text-[14px] text-fg-muted">בדקו את החיבור לאינטרנט, או שהשרת פועל, ונסו שוב.</p>
      <Button variant="primary" className="mt-6 w-full" onClick={() => void check()}>
        <RotateCcw className="size-4" aria-hidden />
        לנסות שוב
      </Button>
    </motion.div>
  );
}

/** Email and password, and what went wrong; shared by the sign-in screen and the sign-in-again dialog */
function useSignIn(initialEmail = '') {
  const signIn = useAuth((s) => s.signIn);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('נא להזין אימייל וסיסמה.');
      return;
    }
    setBusy(true);
    const problem = await signIn(email.trim(), password);
    setBusy(false);
    if (problem) {
      setError(problem);
      setPassword('');
    }
  };
  return { email, setEmail, password, setPassword, error, busy, submit };
}

function SignInForm() {
  const form = useSignIn();
  return (
    <motion.form {...enter} noValidate onSubmit={form.submit} className={card}>
      <BrandMark className="size-11" />
      <h1 className="mt-6 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-balance">
        כניסה ל{appConfig.brand.name} {appConfig.brand.product}
      </h1>
      <p className="mt-1.5 text-[14px] text-fg-muted">האימייל והסיסמה שהוגדרו בשרת שלך.</p>
      <SignInFields {...form} autoFocus />
      <Button type="submit" variant="primary" className="mt-6 w-full" disabled={form.busy}>
        {form.busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {form.busy ? 'נכנסים…' : 'כניסה'}
      </Button>
    </motion.form>
  );
}

/**
 * Signing in again over the app, when the session ended by itself: the leads stay on screen, and what was written
 * meanwhile is sent as soon as it's done.
 */
export function SignInDialog() {
  const open = useAuth((s) => s.prompt);
  const setPrompt = useAuth((s) => s.setPrompt);
  return (
    <ResponsiveDialog open={open} onOpenChange={setPrompt} initialFocus="sign-in-again-password" className="sm:w-[440px]">
      <SignInAgain />
    </ResponsiveDialog>
  );
}

function SignInAgain() {
  const knownEmail = useAuth((s) => s.email);
  const form = useSignIn(knownEmail ?? '');
  return (
    <form noValidate onSubmit={form.submit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title="כניסה מחדש"
        description="החיבור לחשבון הסתיים. הלידים נשארים כאן, ומה שכתבת בינתיים יישלח לשרת מיד אחרי הכניסה."
      />
      <DialogBody>
        <SignInFields {...form} idPrefix="sign-in-again" />
      </DialogBody>
      <DialogFooter>
        <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={form.busy}>
          {form.busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {form.busy ? 'נכנסים…' : 'כניסה'}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface SignInFieldsProps {
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  error: string | null;
  idPrefix?: string;
  autoFocus?: boolean;
}

function SignInFields({ email, setEmail, password, setPassword, error, idPrefix = 'sign-in', autoFocus }: SignInFieldsProps) {
  return (
    <>
      <div className="mt-7 space-y-4 first:mt-0">
        <Field label="אימייל" htmlFor={`${idPrefix}-email`}>
          <input
            id={`${idPrefix}-email`}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus={autoFocus}
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={cn(inputBase, inputSize, 'text-right')}
          />
        </Field>
        <Field label="סיסמה" htmlFor={`${idPrefix}-password`}>
          <input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={cn(inputBase, inputSize, 'text-right')}
          />
        </Field>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3.5 py-2.5 text-[13.5px] text-danger"
        >
          {error}
        </p>
      )}
    </>
  );
}
